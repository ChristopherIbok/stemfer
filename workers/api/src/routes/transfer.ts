import { AutoRouter, json } from 'itty-router';
import { requireAuth }      from '../lib/auth';
import { nanoid }           from '../lib/db';
import type { Env }         from '../types/env';

const CHUNK_SIZE     = 5 * 1024 * 1024;  // 5 MB — R2 multipart minimum
const EXPIRY_DAYS    = 14;
const MAX_DOWNLOADS  = 50;               // default per-link limit

export const transferRoutes = AutoRouter<Request, [Env, ExecutionContext]>({ base: '/transfer' });

/* ─────────────────────────────────────────────────────────────────────────
   POST /transfer/init
   Start a multipart R2 upload for one file in a transfer session.
   Body: { transferId?, filename, mimeType, size, senderEmail }
   Returns: { uploadId, fileKey, fileId, transferId, totalChunks }
───────────────────────────────────────────────────────────────────────── */
transferRoutes.post('/init', async (req, env) => {
  const { transferId: existingId, filename, mimeType, size, senderEmail } =
    await req.json<{
      transferId?: string;
      filename: string;
      mimeType: string;
      size: number;
      senderEmail: string;
    }>();

  if (!filename || !size || !senderEmail)
    throw Object.assign(new Error('Missing required fields'), { status: 400 });

  /* Validate email format cheaply */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail))
    throw Object.assign(new Error('Invalid sender email'), { status: 400 });

  /* Reuse or create transfer session */
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
   Finalize a transfer: set recipient, generate token, trigger ZIP + email.
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

  /* Check all files finished uploading */
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM transfer_files WHERE transfer_id = ? AND status != 'uploaded'`
  ).bind(transferId).first<{ n: number }>();
  if ((pending?.n ?? 0) > 0)
    throw Object.assign(new Error('Not all files have finished uploading'), { status: 400 });

  /* Generate signed download token */
  const downloadToken = nanoid(32);

  await env.DB.prepare(
    `UPDATE transfers
     SET recipient_email = ?, message = ?, download_token = ?,
         download_count = 0, max_downloads = ?,
         status = 'processing', updated_at = datetime('now')
     WHERE id = ?`
  ).bind(recipientEmail, message ?? null, downloadToken, MAX_DOWNLOADS, transferId).run();

  /* Queue the ZIP + email job */
  await env.PROCESSING_QUEUE.send({
    type:           'transfer_send',
    transferId,
    downloadToken,
    recipientEmail,
    senderEmail:    transfer.sender_email,
    message:        message ?? '',
    expiresAt:      transfer.expires_at,
  });

  const downloadUrl = `${env.CORS_ORIGIN}/transfer/download/${downloadToken}`;

  return json({ ok: true, transferId, downloadUrl });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/download/:token
   Serve the ZIP file via signed R2 URL (no login required).
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/download/:token', async (req, env) => {
  const { token } = req.params as { token: string };

  const transfer = await env.DB.prepare(
    `SELECT t.id, t.zip_r2_key, t.zip_size_bytes, t.sender_email, t.expires_at,
            t.download_count, t.max_downloads, t.status,
            COUNT(f.id) as file_count,
            MIN(f.original_name) as first_name
     FROM transfers t
     LEFT JOIN transfer_files f ON f.transfer_id = t.id AND f.status = 'uploaded'
     WHERE t.download_token = ?
     GROUP BY t.id`
  ).bind(token).first<{
    id: string;
    zip_r2_key: string | null;
    zip_size_bytes: number | null;
    sender_email: string;
    expires_at: string;
    download_count: number;
    max_downloads: number;
    status: string;
    file_count: number;
    first_name: string | null;
  }>();

  if (!transfer)
    throw Object.assign(new Error('Transfer not found'), { status: 404 });

  if (new Date(transfer.expires_at) < new Date())
    throw Object.assign(new Error('This transfer has expired'), { status: 410 });

  if (transfer.download_count >= transfer.max_downloads)
    throw Object.assign(new Error('Download limit reached'), { status: 410 });

  if (transfer.status !== 'ready' || !transfer.zip_r2_key)
    return json({ status: transfer.status, message: 'Transfer is still being processed. Please check back in a moment.' });

  /* Increment download count before streaming */
  await env.DB.prepare(
    `UPDATE transfers SET download_count = download_count + 1 WHERE id = ?`
  ).bind(transfer.id).run();

  /* Stream the ZIP directly from R2 */
  const obj = await env.FILES.get(transfer.zip_r2_key);
  if (!obj) throw Object.assign(new Error('Archive not found'), { status: 404 });

  const zipName = transfer.file_count === 1 && transfer.first_name
    ? transfer.first_name.replace(/\.[^.]+$/, '') + '.zip'
    : `stemfer-${transfer.file_count}-files.zip`;

  const headers = new Headers({
    'Content-Type':        'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"`,
    'Cache-Control':       'no-store',
    'X-Expiry':            transfer.expires_at,
    'X-Downloads-Left':    String(transfer.max_downloads - transfer.download_count),
  });
  if (transfer.zip_size_bytes) {
    headers.set('Content-Length', String(transfer.zip_size_bytes));
  }

  return new Response(obj.body, { headers });
});

/* ─────────────────────────────────────────────────────────────────────────
   GET /transfer/status/:transferId
   Poll transfer processing state.
───────────────────────────────────────────────────────────────────────── */
transferRoutes.get('/status/:transferId', async (req, env) => {
  const { transferId } = req.params as { transferId: string };

  const row = await env.DB.prepare(
    `SELECT status, download_token, zip_size_bytes, expires_at FROM transfers WHERE download_token = ? OR id = ?`
  ).bind(transferId, transferId).first<{
    status: string;
    download_token: string | null;
    zip_size_bytes: number | null;
    expires_at: string;
  }>();

  if (!row) throw Object.assign(new Error('Transfer not found'), { status: 404 });

  return json(row);
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
    `SELECT id, recipient_email, status, zip_size_bytes, download_count, max_downloads,
            download_token, created_at, expires_at
     FROM transfers
     WHERE sender_email = ? AND status != 'deleted'
     ORDER BY created_at DESC LIMIT 20`
  ).bind(payload.email).all();

  return json(rows.results);
});

/* helpers */
function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}
