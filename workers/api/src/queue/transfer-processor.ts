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
 * 2. Build a ZIP in-memory (streaming)
 * 3. Upload ZIP to R2
 * 4. Update DB: status=ready, zip_r2_key, zip_size_bytes
 * 5. Send emails via Resend API
 */
export async function handleTransferJob(job: TransferJob, env: Env): Promise<void> {
  const {
    transferId, downloadToken,
    recipientEmail, senderEmail, message, expiresAt,
  } = job;

  try {
    /* 1. Collect files */
    const files = await env.DB.prepare(
      `SELECT original_name, r2_key, size_bytes FROM transfer_files WHERE transfer_id = ? AND status = 'uploaded'`
    ).bind(transferId).all<{ original_name: string; r2_key: string; size_bytes: number }>();

    if (!files.results.length) {
      await markFailed(env, transferId, 'No files found');
      return;
    }

    /* 2. Build ZIP in memory using a minimal ZIP writer */
    const zipBytes = await buildZip(files.results.map(f => ({
      name: f.original_name,
      r2Key: f.r2_key,
    })), env);

    /* 3. Upload ZIP to R2 */
    const zipKey = `transfers/${transferId}/transfer.zip`;
    await env.FILES.put(zipKey, zipBytes, {
      httpMetadata:   { contentType: 'application/zip' },
      customMetadata: { transferId },
    });

    /* 4. Mark ready in DB */
    await env.DB.prepare(
      `UPDATE transfers
       SET status = 'ready', zip_r2_key = ?, zip_size_bytes = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(zipKey, zipBytes.byteLength, transferId).run();

    /* 5. Send emails */
    const downloadUrl  = `${env.CORS_ORIGIN}/transfer/download/${downloadToken}`;
    const expiryDate   = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const zipSizeMB    = (zipBytes.byteLength / 1e6).toFixed(1);
    const fileCount    = files.results.length;
    const fileWord     = fileCount === 1 ? 'file' : 'files';

    await Promise.allSettled([
      sendEmail(env, {
        to:      recipientEmail,
        subject: 'You\'ve received files via Stemfer',
        html:    recipientHtml({ downloadUrl, expiryDate, zipSizeMB, fileCount, fileWord, senderEmail, message }),
      }),
      sendEmail(env, {
        to:      senderEmail,
        subject: 'Your transfer has been sent — Stemfer',
        html:    senderHtml({ downloadUrl, expiryDate, zipSizeMB, fileCount, fileWord, recipientEmail }),
      }),
    ]);

  } catch (err: any) {
    await markFailed(env, transferId, err?.message ?? 'Unknown error');
  }
}

async function markFailed(env: Env, transferId: string, reason: string) {
  await env.DB.prepare(
    `UPDATE transfers SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(reason, transferId).run().catch(() => {});
}

/* ── Minimal ZIP builder ─────────────────────────────────────────────────
   Streams each file from R2, writes local file header + data, then
   constructs the central directory at the end.  Supports files up to
   ~4 GB per file (uses ZIP64 data descriptors for size fields > 0xFFFF).
   This avoids shipping a heavy npm zip library into the Worker bundle.
─────────────────────────────────────────────────────────────────────── */
async function buildZip(
  entries: { name: string; r2Key: string }[],
  env: Env
): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const obj = await env.FILES.get(entry.r2Key);
    if (!obj) continue;

    const data      = new Uint8Array(await obj.arrayBuffer());
    const name      = new TextEncoder().encode(entry.name);
    const crc       = crc32(data);
    const localHeader = makeLocalHeader(name, data.byteLength, crc);
    const cdEntry    = makeCentralDirEntry(name, data.byteLength, crc, offset);

    parts.push(localHeader, data);
    centralDir.push(cdEntry);
    offset += localHeader.byteLength + data.byteLength;
  }

  const cdOffset = offset;
  const cdSize   = centralDir.reduce((s, b) => s + b.byteLength, 0);
  const eocd     = makeEOCD(centralDir.length, cdSize, cdOffset);

  const all      = [...parts, ...centralDir, eocd];
  const total    = all.reduce((s, b) => s + b.byteLength, 0);
  const out      = new Uint8Array(total);
  let pos = 0;
  for (const b of all) { out.set(b, pos); pos += b.byteLength; }

  return out.buffer;
}

function makeLocalHeader(name: Uint8Array, size: number, crc: number): Uint8Array {
  const buf = new ArrayBuffer(30 + name.byteLength);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  dv.setUint32(0,  0x04034b50, true); // signature
  dv.setUint16(4,  20,         true); // version
  dv.setUint16(6,  0,          true); // flags
  dv.setUint16(8,  0,          true); // no compression
  dv.setUint16(10, 0,          true); // mod time
  dv.setUint16(12, 0,          true); // mod date
  dv.setUint32(14, crc,        true);
  dv.setUint32(18, size,       true); // compressed size
  dv.setUint32(22, size,       true); // uncompressed size
  dv.setUint16(26, name.byteLength, true);
  dv.setUint16(28, 0, true);          // extra length
  u8.set(name, 30);
  return u8;
}

function makeCentralDirEntry(name: Uint8Array, size: number, crc: number, localOffset: number): Uint8Array {
  const buf = new ArrayBuffer(46 + name.byteLength);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  dv.setUint32(0,  0x02014b50, true);
  dv.setUint16(4,  20,         true); // version made by
  dv.setUint16(6,  20,         true); // version needed
  dv.setUint16(8,  0,          true); // flags
  dv.setUint16(10, 0,          true); // no compression
  dv.setUint16(12, 0,          true);
  dv.setUint16(14, 0,          true);
  dv.setUint32(16, crc,        true);
  dv.setUint32(20, size,       true);
  dv.setUint32(24, size,       true);
  dv.setUint16(28, name.byteLength, true);
  dv.setUint16(30, 0,          true); // extra
  dv.setUint16(32, 0,          true); // comment
  dv.setUint16(34, 0,          true); // disk start
  dv.setUint16(36, 0,          true); // int attr
  dv.setUint32(38, 0,          true); // ext attr
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

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  const table = getCRCTable();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function getCRCTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crcTable[n] = c;
  }
  return _crcTable;
}

/* ── Email via Resend ────────────────────────────────────────────────────── */
async function sendEmail(env: Env, opts: { to: string; subject: string; html: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Stemfer <onboarding@resend.dev>',
      to:      [opts.to],
      subject: opts.subject,
      html:    opts.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Resend error:', res.status, body);
  }
}

function recipientHtml(p: {
  downloadUrl: string;
  expiryDate: string;
  zipSizeMB: string;
  fileCount: number;
  fileWord: string;
  senderEmail: string;
  message: string;
}) {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;padding:40px 0;margin:0">
<div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #252525;border-radius:16px;overflow:hidden">
  <div style="background:#111;padding:32px 32px 24px;border-bottom:1px solid #1f1f1f">
    <p style="color:#22c55e;font-size:18px;font-weight:700;margin:0 0 4px">Stemfer</p>
    <h1 style="font-size:22px;margin:0 0 8px;color:#fff">You've received ${p.fileCount} ${p.fileWord}</h1>
    <p style="color:#71717a;font-size:14px;margin:0">Sent by ${p.senderEmail}</p>
  </div>
  ${p.message ? `<div style="padding:20px 32px;background:#141414;border-bottom:1px solid #1f1f1f"><p style="color:#a1a1aa;font-size:14px;margin:0;font-style:italic">"${p.message}"</p></div>` : ''}
  <div style="padding:32px">
    <a href="${p.downloadUrl}" style="display:block;text-align:center;background:#22c55e;color:#000;text-decoration:none;font-weight:600;font-size:15px;padding:14px 24px;border-radius:10px;margin-bottom:24px">Download Files (${p.zipSizeMB} MB)</a>
    <p style="color:#52525b;font-size:12px;text-align:center;margin:0">Link expires ${p.expiryDate} · Max ${50} downloads</p>
  </div>
</div>
</body></html>`;
}

function senderHtml(p: {
  downloadUrl: string;
  expiryDate: string;
  zipSizeMB: string;
  fileCount: number;
  fileWord: string;
  recipientEmail: string;
}) {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;padding:40px 0;margin:0">
<div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #252525;border-radius:16px;overflow:hidden">
  <div style="padding:32px 32px 24px;border-bottom:1px solid #1f1f1f">
    <p style="color:#22c55e;font-size:18px;font-weight:700;margin:0 0 4px">Stemfer</p>
    <h1 style="font-size:22px;margin:0 0 8px;color:#fff">Your transfer was sent</h1>
    <p style="color:#71717a;font-size:14px;margin:0">To: ${p.recipientEmail}</p>
  </div>
  <div style="padding:32px">
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 20px">${p.fileCount} ${p.fileWord} (${p.zipSizeMB} MB) · Expires ${p.expiryDate}</p>
    <a href="${p.downloadUrl}" style="display:block;text-align:center;background:#1a1a1a;border:1px solid #252525;color:#22c55e;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-bottom:24px">Copy Download Link</a>
    <p style="color:#52525b;font-size:12px;text-align:center;margin:0">Keep this email as a record of your transfer.</p>
  </div>
</div>
</body></html>`;
}
