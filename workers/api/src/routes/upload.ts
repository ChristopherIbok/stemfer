import { AutoRouter, json } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid, checkStorageLimit, logActivity } from '../lib/db';
import type { Env } from '../types/env';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB minimum for R2 multipart

export const uploadRoutes = AutoRouter<Request, [Env, ExecutionContext]>({ base: '/upload' });

// POST /upload/init — start a multipart upload, get upload ID
uploadRoutes.post('/init', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { filename, mimeType, size, projectId, sessionId } = await req.json<any>();

  if (!filename || !size || !projectId)
    throw Object.assign(new Error('Missing required fields'), { status: 400 });

  // Only check total storage quota — no per-file size limit
  const hasRoom = await checkStorageLimit(env, payload.sub, size);
  if (!hasRoom)
    throw Object.assign(new Error('Storage limit exceeded'), { status: 413 });

  const fileId = nanoid();
  const r2Key  = `projects/${projectId}/${fileId}/${sanitizeFilename(filename)}`;

  // Create multipart upload in R2
  const multipart = await env.FILES.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: mimeType ?? 'application/octet-stream' },
    customMetadata: { fileId, userId: payload.sub, projectId },
  });

  // Pre-create file record with pending status
  await env.DB.prepare(
    `INSERT INTO files (id, project_id, session_id, uploaded_by, r2_key, file_url, filename, original_name,
                        mime_type, size_bytes, processing_status)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'pending')`
  ).bind(
    fileId, projectId, sessionId ?? null, payload.sub,
    r2Key, sanitizeFilename(filename), filename, mimeType ?? 'application/octet-stream', size
  ).run();

  // Store upload session in KV or D1
  await env.DB.prepare(
    `INSERT INTO upload_chunks (id, upload_id, file_id, chunk_index, uploaded)
     VALUES (?, ?, ?, -1, 0)`  // sentinel row for the upload session
  ).bind(nanoid(), multipart.uploadId, fileId, -1).run();

  const totalChunks = Math.ceil(size / CHUNK_SIZE);

  return json({
    uploadId: multipart.uploadId,
    fileId,
    r2Key,
    totalChunks,
    chunkSize: CHUNK_SIZE,
  }, { status: 201 });
});

// POST /upload/chunk — upload a single chunk
uploadRoutes.post('/chunk', async (req, env) => {
  const payload = await requireAuth(req, env);
  const uploadId    = req.headers.get('X-Upload-Id') ?? '';
  const chunkIndex  = parseInt(req.headers.get('X-Chunk-Index') ?? '-1');
  const fileId      = req.headers.get('X-File-Id') ?? '';

  if (!uploadId || chunkIndex < 0 || !fileId)
    throw Object.assign(new Error('Missing upload headers'), { status: 400 });

  // Verify ownership
  const file = await env.DB.prepare(
    'SELECT r2_key FROM files WHERE id = ? AND uploaded_by = ?'
  ).bind(fileId, payload.sub).first<{ r2_key: string }>();
  if (!file) throw Object.assign(new Error('Upload not found'), { status: 404 });

  const body = await req.arrayBuffer();
  if (!body.byteLength) throw Object.assign(new Error('Empty chunk'), { status: 400 });

  const multipart = env.FILES.resumeMultipartUpload(file.r2_key, uploadId);
  const part      = await multipart.uploadPart(chunkIndex + 1, body); // R2 parts are 1-indexed

  await env.DB.prepare(
    `INSERT OR REPLACE INTO upload_chunks (id, upload_id, file_id, chunk_index, etag, size_bytes, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).bind(nanoid(), uploadId, fileId, chunkIndex, part.etag, body.byteLength).run();

  return json({ partNumber: chunkIndex + 1, etag: part.etag });
});

// POST /upload/complete — finalize multipart upload
uploadRoutes.post('/complete', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { uploadId, fileId, parts } = await req.json<{ uploadId: string; fileId: string; parts: { partNumber: number; etag: string }[] }>();

  const file = await env.DB.prepare(
    'SELECT r2_key, filename, project_id FROM files WHERE id = ? AND uploaded_by = ?'
  ).bind(fileId, payload.sub).first<{ r2_key: string; filename: string; project_id: string }>();
  if (!file) throw Object.assign(new Error('Upload not found'), { status: 404 });

  const multipart = env.FILES.resumeMultipartUpload(file.r2_key, uploadId);
  await multipart.complete(parts.map(p => ({ partNumber: p.partNumber, etag: p.etag })));

  // Generate public URL (or use signed URL pattern)
  const fileUrl = `https://files.stemfer.com/${file.r2_key}`;

  await env.DB.prepare(
    `UPDATE files SET file_url = ?, processing_status = 'processing', updated_at = datetime('now') WHERE id = ?`
  ).bind(fileUrl, fileId).run();

  // Queue background processing
  await env.PROCESSING_QUEUE.send({ type: 'process_file', fileId, projectId: file.project_id });

  await logActivity(env, {
    projectId: file.project_id,
    userId: payload.sub,
    action: 'file_upload',
    entityType: 'file',
    entityId: fileId,
    metadata: { filename: file.filename },
  });

  return json({ ok: true, fileId, fileUrl });
});

// POST /upload/abort
uploadRoutes.post('/abort', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { uploadId, fileId } = await req.json<any>();

  const file = await env.DB.prepare(
    'SELECT r2_key FROM files WHERE id = ? AND uploaded_by = ?'
  ).bind(fileId, payload.sub).first<{ r2_key: string }>();
  if (!file) throw Object.assign(new Error('Upload not found'), { status: 404 });

  try {
    const multipart = env.FILES.resumeMultipartUpload(file.r2_key, uploadId);
    await multipart.abort();
  } catch {}

  await env.DB.prepare(`DELETE FROM upload_chunks WHERE file_id = ?`).bind(fileId).run();
  await env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(fileId).run();

  return json({ ok: true });
});

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

