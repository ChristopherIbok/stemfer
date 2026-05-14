import { AutoRouter, json } from 'itty-router';
import { requireAuth }      from '../lib/auth';
import { nanoid }           from '../lib/db';
import type { Env }         from '../types/env';

const CHUNK_SIZE     = 5 * 1024 * 1024;  // 5 MB — R2 multipart minimum
const EXPIRY_DAYS    = 14;
const MAX_DOWNLOADS  = 50;

export const transferRoutes = AutoRouter<Request, [Env, ExecutionContext]>({ base: '/transfer' });

/* ─────────────────────────────────────────────────────────────────────────
   POST /transfer/init
   Start a multipart R2 upload for one file in a transfer session.
   Body: { transferId?, filename, mimeType, size, senderEmail }
   Returns: { uploadId, fileKey, fileId, transferId, totalChunks }
───────────────────────────────────────────────────────────────────────── */
transferRoutes.post('/init', async (req, env) => {
  const { transferId: existingId, filename, mimeType, size, senderEmail: rawSender } =
    await req.json<{
      transferId?: string;
      filename: string;
      mimeType: string;
      size: number;
      senderEmail?: string;
    }>();

  if (!filename || !size)
    throw Object.assign(new Error('Missing required fields'), { status: 400 });

  const senderEmail = rawSender?.trim() || 'noreply@stemfer.com';

  if (rawSender?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail))
    throw Object.assign(new Error('Invalid sender email'), { status: 400 });

  const transferId = existingId ?? nanoid();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO transfers (id, sender_email, status, created_at, expires_at)
     VALUES (?, ?, 'uploading', datetime('now'), datetime('now', '+${EXPIRY_DAYS} days'))`
  ).bind(transferId, senderEmail).run();

  const fileId  = nanoid();
  const fileKey = `transfers/${transferId}/${fileId}/${sanitize(filename)}`;

  const multipart = await env.FILES.createMultipartUpload(fileKey, {
    httpMetadata:   { contentType: mimeType ?? 'application/octet-stream' },
    customMetadata: { transferId, fileId },
  });

  await env.DB.prepare(
    `INSERT INTO transfer_files (id, transfer_id, r2_key, upload_id, original_name, mime_type, size_bytes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading')`
  ).bind(fileId, transferId, fileKey, multipart.uploadId, filename, mimeType ?? 'application/octet-stream', size).run();

  return json({
    uploadId:    multipart.uploadId,
    fileKey,
    fileId,
    transferId,
    totalChunks: Math.ceil(size / CHUNK_SIZE),
    chunkSize:   CHUNK_SIZE,
  }, { status: 201 });
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /transfer/chunk
   Upload one chunk. Headers: X-Transfer-Upload-Id, X-Chunk-Index, X-File-Key
───────────────────────────────────────────────────────────────────────── */
transferRoutes.post('/chunk', async (req, env) => {
  const uploadId   = req.headers.get('X-Transfer-Upload-Id') ?? '';
  const chunkIndex = parseInt(req.headers.get('X-Chunk-Index') ?? '-1');
  const fileKey    = req.headers.get('X-File-Key') ?? '';

  if (!uploadId || chunkIndex < 0 || !fileKey)
    throw Object.assign(new Error('Missing chunk headers'), { status: 400 });

  const body = await req.arrayBuffer();
  if (!body.byteLength) throw Object.assign(new Error('Empty chunk'), { status: 400 });

  const multipart = env.FILES.resumeMultipartUpload(fileKey, uploadId);
  const part      = await multipart.uploadPart(chunkIndex + 1, body);

  return json({ partNumber: chunkIndex + 1, etag: part.etag });
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /transfer/complete-file
   Finalize one file's multipart upload.
   Body: { fileId, uploadId, fileKey, parts }
───────────────────────────────────────────────────────────────────────── */
transferRoutes.post('/complete-file', async (req, env) => {
  const { fileId, uploadId, fileKey, parts } = await req.json<{
    fileId:   string;
    uploadId: string;
    fileKey:  string;
    parts:    { partNumber: number; etag: string }[];
  }>();

  const multipart = env.FILES.resumeMultipartUpload(fileKey, uploadId);
  await multipart.complete(parts);

  await env.DB.prepare(
    `UPDATE transfer_files SET status = 'uploaded', updated_at = datetime('now') WHERE id = ?`
  ).bind(fileId).run();

  return json({ ok: true, fileId });
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /transfer/send
   Finalize a transfer: set recipient, mark ready, send emails immediately.
   No queue, no ZIP — recipients download individual files via signed URLs.
   Body: { transferId, recipientEmail, message? }
───────────────────────────────────────────────────────────────────────── */
transferRoutes.post('/send', async (req, env) => {
  const { transferId, recipientEmail, message } = await req.json<{
    transferId:     string;
    recipientEmail: string;
    message?:       string;
  }>();

  if (!transferId || !recipientEmail)
    throw Object.assign(new Error('Missing fields'), { status: 400 });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))
    throw Object.assign(new Error('Invalid recipient email'), { status: 400 });

  const transfer = await env.DB.prepare(
    `SELECT * FROM transfers WHERE id = ? AND status = 'uploading'`
  ).bind(transferId).first<{ id: string; sender_email: string; expires_at: string }>();

  if (!transfer) throw Object.assign(new Error('Transfer not found or already sent'), { status: 404 });

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM transfer_files WHERE transfer_id = ? AND status != 'uploaded'`
  ).bind(transferId).first<{ n: number }>();
  if ((pending?.n ?? 0) > 0)
    throw Object.assign(new Error('Not all files have finished uploading'), { status: 400 });

  const files = await env.DB.prepare(
    `SELECT id, original_name, mime_type, size_bytes FROM transfer_files
     WHERE transfer_id = ? AND status = 'uploaded'`
  ).bind(transferId).all<{ id: string; original_name: string; mime_type: string; size_bytes: number }>();

  if (!files.results.length)
    throw Object.assign(new Error('No uploaded files found'), { status: 400 });

  const downloadToken = nanoid(32);

  await env.DB.prepare(
    `UPDATE transfers
     SET recipient_email = ?, message = ?, download_token = ?,
         download_count = 0, max_downloads = ?,
         status = 'ready', updated_at = datetime('now')
     WHERE id = ?`
  ).bind(recipientEmail, message ?? null, downloadToken, MAX_DOWNLOADS, transferId).run();

  const downloadUrl = `${env.CORS_ORIGIN}/transfer/download/${downloadToken}`;
  const expiryDate  = new Date(transfer.expires_at).toLocaleDateString('en-US', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const fileCount = files.results.length;
  const fileWord  = fileCount === 1 ? 'file' : 'files';
  const totalBytes = files.results.reduce((s, f) => s + f.size_bytes, 0);
  const sizeMB = (totalBytes / 1_000_000).toFixed(1);

  /* Send emails — log failures but don't fail the whole request */
  const emailResults = await Promise.allSettled([
    sendEmail(env, {
      to:      recipientEmail,
      subject: `${transfer.sender_email} sent you ${fileCount} ${fileWord} via Stemfer`,
      html:    recipientHtml({ downloadUrl, expiryDate, sizeMB, fileCount, fileWord, senderEmail: transfer.sender_email, message: message ?? '' }),
    }),
    sendEmail(env, {
      to:      transfer.sender_email,
      subject: `Your Stemfer transfer to ${recipientEmail} was sent`,
      html:    senderHtml({ downloadUrl, expiryDate, sizeMB, fileCount, fileWord, recipientEmail }),
    }),
  ]);

  for (let i = 0; i < emailResults.length; i++) {
    const r = emailResults[i];
    if (r.status === 'rejected') {
      console.error(`[transfer/send] ${i === 0 ? 'recipient' : 'sender'} email failed:`, r.reason);
    }
  }

  return json({ ok: true, transferId, downloadUrl });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/download/:token
   Returns transfer metadata + per-file signed R2 URLs.
   Increments download count on first call.
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/download/:token', async (req, env) => {
  const { token } = req.params as { token: string };

  const transfer = await env.DB.prepare(
    `SELECT t.id, t.sender_email, t.message, t.expires_at,
            t.download_count, t.max_downloads, t.status
     FROM transfers t
     WHERE t.download_token = ?`
  ).bind(token).first<{
    id: string;
    sender_email: string;
    message: string | null;
    expires_at: string;
    download_count: number;
    max_downloads: number;
    status: string;
  }>();

  if (!transfer)
    throw Object.assign(new Error('Transfer not found'), { status: 404 });

  if (new Date(transfer.expires_at) < new Date())
    throw Object.assign(new Error('This transfer has expired'), { status: 410 });

  if (transfer.download_count >= transfer.max_downloads)
    throw Object.assign(new Error('Download limit reached'), { status: 410 });

  if (transfer.status !== 'ready')
    return json({ status: transfer.status, message: 'Transfer is not ready yet.' });

  const files = await env.DB.prepare(
    `SELECT id, original_name, mime_type, size_bytes, r2_key
     FROM transfer_files WHERE transfer_id = ? AND status = 'uploaded'`
  ).bind(transfer.id).all<{
    id: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    r2_key: string;
  }>();

  const fileLinks = files.results.map((f) => ({
    id:        f.id,
    name:      f.original_name,
    mimeType:  f.mime_type,
    sizeBytes: f.size_bytes,
  }));

  /* Record download event */
  const dlId = nanoid();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE transfers SET download_count = download_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(transfer.id),
    env.DB.prepare(
      `INSERT INTO transfer_downloads (id, transfer_id, ip, user_agent) VALUES (?, ?, ?, ?)`
    ).bind(
      dlId, transfer.id,
      req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For') ?? null,
      req.headers.get('User-Agent')?.slice(0, 200) ?? null,
    ),
  ]);

  return json({
    senderEmail:  transfer.sender_email,
    message:      transfer.message,
    expiresAt:    transfer.expires_at,
    downloadsLeft: transfer.max_downloads - transfer.download_count - 1,
    files:        fileLinks,
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/download/:token/file/:fileId
   Stream a single file from R2 for a recipient to download.
   No auth required — gated by the download token.
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/download/:token/file/:fileId', async (req, env) => {
  const { token, fileId } = req.params as { token: string; fileId: string };

  const transfer = await env.DB.prepare(
    `SELECT t.id, t.expires_at, t.download_count, t.max_downloads, t.status
     FROM transfers t WHERE t.download_token = ?`
  ).bind(token).first<{
    id: string;
    expires_at: string;
    download_count: number;
    max_downloads: number;
    status: string;
  }>();

  if (!transfer)
    throw Object.assign(new Error('Transfer not found'), { status: 404 });
  if (new Date(transfer.expires_at) < new Date())
    throw Object.assign(new Error('This transfer has expired'), { status: 410 });
  if (transfer.status !== 'ready')
    throw Object.assign(new Error('Transfer is not ready'), { status: 409 });

  const file = await env.DB.prepare(
    `SELECT original_name, mime_type, size_bytes, r2_key
     FROM transfer_files WHERE id = ? AND transfer_id = ? AND status = 'uploaded'`
  ).bind(fileId, transfer.id).first<{
    original_name: string;
    mime_type: string;
    size_bytes: number;
    r2_key: string;
  }>();

  if (!file)
    throw Object.assign(new Error('File not found'), { status: 404 });

  const obj = await env.FILES.get(file.r2_key);
  if (!obj)
    throw Object.assign(new Error('File data not found'), { status: 404 });

  const headers = new Headers({
    'Content-Type':        file.mime_type,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`,
    'Content-Length':      String(file.size_bytes),
    'Cache-Control':       'no-store',
  });

  return new Response(obj.body, { headers });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/my
   List authenticated user's recent transfers (sender).
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/my', async (req, env) => {
  let payload: { sub: string; email: string } | null = null;
  try {
    payload = await requireAuth(req, env) as any;
  } catch {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  const rows = await env.DB.prepare(
    `SELECT t.id, t.recipient_email, t.message, t.status, t.zip_size_bytes,
            t.download_count, t.max_downloads, t.download_token,
            t.created_at, t.expires_at,
            COUNT(f.id) as file_count,
            GROUP_CONCAT(f.original_name, '||') as file_names
     FROM transfers t
     LEFT JOIN transfer_files f ON f.transfer_id = t.id AND f.status = 'uploaded'
     WHERE t.sender_email = ? AND t.status != 'deleted'
     GROUP BY t.id
     ORDER BY t.created_at DESC LIMIT 20`
  ).bind(payload.email).all();

  return json(rows.results);
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/:id/downloads
   List individual download events for a transfer (sender only).
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/:id/downloads', async (req, env) => {
  let payload: { sub: string; email: string } | null = null;
  try {
    payload = await requireAuth(req, env) as any;
  } catch {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  const { id } = req.params as { id: string };

  const transfer = await env.DB.prepare(
    `SELECT id FROM transfers WHERE id = ? AND sender_email = ? AND status != 'deleted'`
  ).bind(id, payload.email).first<{ id: string }>();

  if (!transfer) throw Object.assign(new Error('Transfer not found'), { status: 404 });

  const rows = await env.DB.prepare(
    `SELECT id, downloaded_at, ip, user_agent
     FROM transfer_downloads
     WHERE transfer_id = ?
     ORDER BY downloaded_at DESC LIMIT 100`
  ).bind(id).all();

  return json(rows.results);
});

/* ── Email via Resend ────────────────────────────────────────────────────── */
async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'Stemfer <noreply@stemfer.com>',
      to:      [opts.to],
      subject: opts.subject,
      html:    opts.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

/* ── Email templates ─────────────────────────────────────────────────────── */
function recipientHtml(p: {
  downloadUrl: string;
  expiryDate:  string;
  sizeMB:      string;
  fileCount:   number;
  fileWord:    string;
  senderEmail: string;
  message:     string;
}): string {
  const msgBlock = p.message
    ? `<tr>
        <td style="padding:0 0 24px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#161616;border-radius:8px;border:1px solid #2a2a2a;">
            <tr>
              <td style="padding:16px 20px;font-size:14px;color:#a1a1aa;font-style:italic;line-height:1.6;">
                &ldquo;${escHtml(p.message)}&rdquo;
              </td>
            </tr>
          </table>
        </td>
       </tr>`
    : '';

  return baseLayout(`
    <tr>
      <td style="padding:0 0 24px 0;border-bottom:1px solid #1f1f1f;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:2px;color:#22c55e;text-transform:uppercase;">Stemfer</p>
        <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">
          You&rsquo;ve received ${p.fileCount} ${p.fileWord}
        </h1>
        <p style="margin:0;font-size:14px;color:#71717a;">From ${escHtml(p.senderEmail)}</p>
      </td>
    </tr>
    <tr><td style="height:24px;"></td></tr>
    ${msgBlock}
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#111;border-radius:8px;border:1px solid #252525;">
          <tr>
            <td style="padding:14px 20px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:24px;text-align:center;">
                    <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${p.fileCount}</p>
                    <p style="margin:4px 0 0 0;font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1px;">${p.fileWord}</p>
                  </td>
                  <td style="width:1px;background:#252525;"></td>
                  <td style="padding-left:24px;text-align:center;">
                    <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${p.sizeMB}</p>
                    <p style="margin:4px 0 0 0;font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1px;">MB</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center">
              <a href="${p.downloadUrl}"
                 style="display:inline-block;background:#22c55e;color:#000000;text-decoration:none;
                        font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;
                        letter-spacing:0.2px;">
                Download Files
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 8px 0;text-align:center;">
        <p style="margin:0;font-size:12px;color:#52525b;">
          Link expires ${p.expiryDate} &middot; Max 50 downloads
        </p>
      </td>
    </tr>
  `);
}

function senderHtml(p: {
  downloadUrl:    string;
  expiryDate:     string;
  sizeMB:         string;
  fileCount:      number;
  fileWord:       string;
  recipientEmail: string;
}): string {
  return baseLayout(`
    <tr>
      <td style="padding:0 0 24px 0;border-bottom:1px solid #1f1f1f;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:2px;color:#22c55e;text-transform:uppercase;">Stemfer</p>
        <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">Transfer sent</h1>
        <p style="margin:0;font-size:14px;color:#71717a;">To: ${escHtml(p.recipientEmail)}</p>
      </td>
    </tr>
    <tr><td style="height:24px;"></td></tr>
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#111;border-radius:8px;border:1px solid #252525;">
          <tr>
            <td style="padding:14px 20px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:24px;">
                    <p style="margin:0;font-size:12px;color:#71717a;">Files</p>
                    <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#fff;">${p.fileCount} ${p.fileWord}</p>
                  </td>
                  <td style="padding-right:24px;">
                    <p style="margin:0;font-size:12px;color:#71717a;">Size</p>
                    <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#fff;">${p.sizeMB} MB</p>
                  </td>
                  <td>
                    <p style="margin:0;font-size:12px;color:#71717a;">Expires</p>
                    <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#fff;">${p.expiryDate}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-radius:8px;border:1px solid #252525;">
          <tr>
            <td style="padding:10px 16px;">
              <p style="margin:0 0 4px 0;font-size:10px;color:#52525b;text-transform:uppercase;letter-spacing:1px;">Download link</p>
              <p style="margin:0;font-size:12px;color:#22c55e;word-break:break-all;font-family:monospace;">
                <a href="${p.downloadUrl}" style="color:#22c55e;text-decoration:none;">${p.downloadUrl}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center">
              <a href="${p.downloadUrl}"
                 style="display:inline-block;background:#1a1a1a;border:1px solid #252525;
                        color:#22c55e;text-decoration:none;font-size:14px;font-weight:600;
                        padding:12px 28px;border-radius:10px;">
                View Transfer
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="text-align:center;">
        <p style="margin:0;font-size:12px;color:#52525b;">Keep this email as a record of your transfer.</p>
      </td>
    </tr>
  `);
}

function baseLayout(rows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Stemfer</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:540px;background:#111111;border-radius:16px;border:1px solid #252525;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#0d0d0d;border-top:1px solid #1a1a1a;text-align:center;">
              <p style="margin:0;font-size:12px;color:#3f3f46;">
                Stemfer &middot; Cloud studio for audio professionals &middot;
                <a href="https://stemfer.com" style="color:#52525b;text-decoration:none;">stemfer.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}
