import type { Env } from '../types/env';

interface TransferJob {
  type:           'transfer_send';
  transferId:     string;
  downloadToken:  string;
  recipientEmail: string;
  senderEmail:    string;
  message:        string;
  expiresAt:      string;
}

/**
 * Handles transfer_send queue jobs:
 * 1. Fetch all uploaded file keys for the transfer
 * 2. Build a ZIP in-memory
 * 3. Upload ZIP to R2
 * 4. Update DB: status=ready
 * 5. Send emails via Resend (noreply@stemfer.com)
 */
export async function handleTransferJob(job: TransferJob, env: Env): Promise<void> {
  const {
    transferId, downloadToken,
    recipientEmail, senderEmail, message, expiresAt,
  } = job;

  /* Reset to processing so retries don't get stuck on a prior 'failed' status */
  await env.DB.prepare(
    `UPDATE transfers SET status = 'processing', error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('processing', 'failed')`
  ).bind(transferId).run().catch(() => {});

  try {
    /* 1. Collect files */
    const files = await env.DB.prepare(
      `SELECT original_name, r2_key, size_bytes FROM transfer_files
       WHERE transfer_id = ? AND status = 'uploaded'`
    ).bind(transferId).all<{ original_name: string; r2_key: string; size_bytes: number }>();

    if (!files.results.length) {
      await markFailed(env, transferId, 'No uploaded files found');
      return;
    }

    /* 2. Build ZIP */
    const { stream: zipStream } = await buildZip(
      files.results.map(f => ({ name: f.original_name, r2Key: f.r2_key })),
      env
    );

    /* 3. Upload ZIP to R2 — collect into buffer then put */
    const zipKey = `transfers/${transferId}/transfer.zip`;
    const zipBytes = await streamToArrayBuffer(zipStream);
    await env.FILES.put(zipKey, zipBytes, {
      httpMetadata:   { contentType: 'application/zip' },
      customMetadata: { transferId },
    });

    /* 4. Mark ready */
    await env.DB.prepare(
      `UPDATE transfers
       SET status = 'ready', zip_r2_key = ?, zip_size_bytes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(zipKey, zipBytes.byteLength, transferId).run();

    /* 5. Send both emails — each throws on failure so the queue message retries */
    const downloadUrl = `${env.CORS_ORIGIN}/transfer/download/${downloadToken}`;
    const expiryDate  = new Date(expiresAt).toLocaleDateString('en-US', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const zipSizeMB = (zipBytes.byteLength / 1_000_000).toFixed(1);
    const fileCount = files.results.length;
    const fileWord  = fileCount === 1 ? 'file' : 'files';

    /* Send to recipient first (most important), then sender confirmation */
    const emailResults = await Promise.allSettled([
      sendEmail(env, {
        to:      recipientEmail,
        subject: `${senderEmail} sent you ${fileCount} ${fileWord} via Stemfer`,
        html:    recipientHtml({ downloadUrl, expiryDate, zipSizeMB, fileCount, fileWord, senderEmail, message }),
      }),
      sendEmail(env, {
        to:      senderEmail,
        subject: `Your Stemfer transfer to ${recipientEmail} was sent`,
        html:    senderHtml({ downloadUrl, expiryDate, zipSizeMB, fileCount, fileWord, recipientEmail }),
      }),
    ]);

    /* Log any email failures without failing the whole job */
    const emailLabels = ['recipient', 'sender'];
    for (let i = 0; i < emailResults.length; i++) {
      const result = emailResults[i];
      if (result.status === 'rejected') {
        console.error(`[transfer-processor] ${emailLabels[i]} email failed:`, result.reason);
        await env.DB.prepare(
          `UPDATE transfers SET error = ? WHERE id = ?`
        ).bind(`Email delivery warning (${emailLabels[i]}): ${result.reason}`, transferId).run().catch(() => {});
      } else {
        console.log(`[transfer-processor] ${emailLabels[i]} email sent ok`);
      }
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transfer-processor] job failed:', msg);
    await markFailed(env, transferId, msg);
    throw err; /* re-throw so the queue retries */
  }
}

async function markFailed(env: Env, transferId: string, reason: string) {
  await env.DB.prepare(
    `UPDATE transfers SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(reason, transferId).run().catch(() => {});
}

/* ── Email via Resend ─────────────────────────────────────────────────────
   Required secret (wrangler secret put RESEND_API_KEY):
     RESEND_API_KEY — from resend.com dashboard
   Sends from: Stemfer <noreply@stemfer.com>
   (Domain must be verified in your Resend account.)
─────────────────────────────────────────────────────────────────────── */

/** Send one email via the Resend API. Throws on any failure. */
async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

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

/* ─────────────────────────────────────────────────────────────────────────
   Email HTML templates
   Rules: table-based layout, inline styles only, no flexbox/grid (Gmail
   strips <style> blocks and doesn't support modern CSS layout).
─────────────────────────────────────────────────────────────────────── */

function recipientHtml(p: {
  downloadUrl: string;
  expiryDate:  string;
  zipSizeMB:   string;
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
    <!-- Header -->
    <tr>
      <td style="padding:0 0 24px 0;border-bottom:1px solid #1f1f1f;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:2px;color:#22c55e;text-transform:uppercase;">Stemfer</p>
        <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">
          You&rsquo;ve received ${p.fileCount} ${p.fileWord}
        </h1>
        <p style="margin:0;font-size:14px;color:#71717a;">From ${escHtml(p.senderEmail)}</p>
      </td>
    </tr>

    <!-- Spacer -->
    <tr><td style="height:24px;"></td></tr>

    <!-- Message block (conditional) -->
    ${msgBlock}

    <!-- File info pill -->
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
                    <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${p.zipSizeMB}</p>
                    <p style="margin:4px 0 0 0;font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:1px;">MB</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA button -->
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

    <!-- Expiry note -->
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
  zipSizeMB:      string;
  fileCount:      number;
  fileWord:       string;
  recipientEmail: string;
}): string {
  return baseLayout(`
    <!-- Header -->
    <tr>
      <td style="padding:0 0 24px 0;border-bottom:1px solid #1f1f1f;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:2px;color:#22c55e;text-transform:uppercase;">Stemfer</p>
        <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">
          Transfer sent
        </h1>
        <p style="margin:0;font-size:14px;color:#71717a;">To: ${escHtml(p.recipientEmail)}</p>
      </td>
    </tr>

    <!-- Spacer -->
    <tr><td style="height:24px;"></td></tr>

    <!-- Summary row -->
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
                    <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#fff;">${p.zipSizeMB} MB</p>
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

    <!-- Download link box -->
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

    <!-- Copy link button -->
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

    <!-- Footer note -->
    <tr>
      <td style="text-align:center;">
        <p style="margin:0;font-size:12px;color:#52525b;">
          Keep this email as a record of your transfer.
        </p>
      </td>
    </tr>
  `);
}

/* ── Shared base layout ───────────────────────────────────────────────────
   Outer dark wrapper → centred 540px card → content rows injected above.
   Table-based, 100% inline styles — renders in Gmail, Outlook, Apple Mail.
─────────────────────────────────────────────────────────────────────── */
function baseLayout(rows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>Stemfer</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:540px;background:#111111;border-radius:16px;
                      border:1px solid #252525;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${rows}
              </table>
            </td>
          </tr>

          <!-- Card footer -->
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

/* Minimal HTML escaping — prevents XSS in email content */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── ZIP builder ──────────────────────────────────────────────────────────
   True streaming ZIP — uses data descriptor records (flag 0x08) so CRC
   and sizes are written *after* each file's data. Only one chunk is in
   memory at a time; the full ZIP streams from R2 → TransformStream → R2.
   Stores without compression (method 0). Supports files up to 4 GB.
─────────────────────────────────────────────────────────────────────── */
async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
  return out.buffer;
}

async function buildZip(
  entries: { name: string; r2Key: string }[],
  env: Env,
): Promise<{ stream: ReadableStream }> {
  /* Resolve which entries exist */
  const resolved: { name: Uint8Array; r2Key: string; size: number }[] = [];
  for (const entry of entries) {
    const head = await env.FILES.head(entry.r2Key);
    if (!head) continue;
    resolved.push({ name: new TextEncoder().encode(entry.name), r2Key: entry.r2Key, size: head.size });
  }

  /* Track local-header offsets for the central directory */
  let offset = 0;
  const offsets: number[] = [];
  for (const e of resolved) {
    offsets.push(offset);
    offset += 30 + e.name.byteLength + e.size + 16;
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const crcs: number[]    = [];
    const sizes: number[]   = [];

    for (let i = 0; i < resolved.length; i++) {
      const e = resolved[i];
      /* Local file header — sizes/crc are 0; data descriptor follows */
      await writer.write(makeLocalHeaderStreaming(e.name));

      const obj = await env.FILES.get(e.r2Key);
      if (!obj) {
        crcs.push(0); sizes.push(0);
        continue;
      }

      let fileCrc = 0xFFFFFFFF;
      let fileSize = 0;
      const reader = obj.body.getReader();
      const crcTable = getCRCTable();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let b = 0; b < value.length; b++) {
          fileCrc = (fileCrc >>> 8) ^ crcTable[(fileCrc ^ value[b]) & 0xFF];
        }
        fileSize += value.length;
        await writer.write(value);
      }
      fileCrc = (fileCrc ^ 0xFFFFFFFF) >>> 0;
      crcs.push(fileCrc);
      sizes.push(fileSize);

      /* Data descriptor: signature + crc32 + compressed size + uncompressed size */
      await writer.write(makeDataDescriptor(fileCrc, fileSize));
    }

    /* Central directory */
    for (let i = 0; i < resolved.length; i++) {
      await writer.write(makeCentralDirEntry(resolved[i].name, sizes[i], crcs[i], offsets[i]));
    }

    /* End of central directory */
    const cdSize = resolved.reduce((s, e) => s + 46 + e.name.byteLength, 0);
    await writer.write(makeEOCD(resolved.length, cdSize, offset));
    await writer.close();
  })().catch(err => writer.abort(err));

  return { stream: readable };
}

function makeLocalHeaderStreaming(name: Uint8Array): Uint8Array {
  const buf = new ArrayBuffer(30 + name.byteLength);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  dv.setUint32(0,  0x04034b50, true); /* signature */
  dv.setUint16(4,  20,         true); /* version needed */
  dv.setUint16(6,  0x08,       true); /* general purpose bit flag: data descriptor */
  dv.setUint16(8,  0,          true); /* compression: store */
  dv.setUint16(10, 0,          true); /* mod time */
  dv.setUint16(12, 0,          true); /* mod date */
  dv.setUint32(14, 0,          true); /* crc32 — filled in data descriptor */
  dv.setUint32(18, 0,          true); /* compressed size — filled in data descriptor */
  dv.setUint32(22, 0,          true); /* uncompressed size — filled in data descriptor */
  dv.setUint16(26, name.byteLength, true);
  dv.setUint16(28, 0,          true); /* extra field length */
  u8.set(name, 30);
  return u8;
}

function makeDataDescriptor(crc: number, size: number): Uint8Array {
  const buf = new ArrayBuffer(16);
  const dv  = new DataView(buf);
  dv.setUint32(0, 0x08074b50, true); /* optional signature */
  dv.setUint32(4, crc,        true);
  dv.setUint32(8, size,       true); /* compressed */
  dv.setUint32(12, size,      true); /* uncompressed */
  return new Uint8Array(buf);
}


function makeCentralDirEntry(name: Uint8Array, size: number, crc: number, localOffset: number): Uint8Array {
  const buf = new ArrayBuffer(46 + name.byteLength);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  dv.setUint32(0,  0x02014b50, true);
  dv.setUint16(4,  20,         true);
  dv.setUint16(6,  20,         true);
  dv.setUint16(8,  0,          true);
  dv.setUint16(10, 0,          true);
  dv.setUint16(12, 0,          true);
  dv.setUint16(14, 0,          true);
  dv.setUint32(16, crc,        true);
  dv.setUint32(20, size,       true);
  dv.setUint32(24, size,       true);
  dv.setUint16(28, name.byteLength, true);
  dv.setUint16(30, 0,          true);
  dv.setUint16(32, 0,          true);
  dv.setUint16(34, 0,          true);
  dv.setUint16(36, 0,          true);
  dv.setUint32(38, 0,          true);
  dv.setUint32(42, localOffset, true);
  u8.set(name, 46);
  return u8;
}

function makeEOCD(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const buf = new ArrayBuffer(22);
  const dv  = new DataView(buf);
  dv.setUint32(0,  0x06054b50, true);
  dv.setUint16(4,  0,          true);
  dv.setUint16(6,  0,          true);
  dv.setUint16(8,  count,      true);
  dv.setUint16(10, count,      true);
  dv.setUint32(12, cdSize,     true);
  dv.setUint32(16, cdOffset,   true);
  dv.setUint16(20, 0,          true);
  return new Uint8Array(buf);
}

let _crcTable: Uint32Array | null = null;
function getCRCTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[n] = c;
  }
  return _crcTable;
}
