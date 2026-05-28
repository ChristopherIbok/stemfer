import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid } from '../lib/db';
import type { Env } from '../types/env';

export const shareRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/share' });

// POST /share — create share link
shareRoutes.post('/', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { fileId, projectId, expiresIn, downloadLimit, password } = await req.json<any>();

  if (!fileId && !projectId)
    throw Object.assign(new Error('fileId or projectId required'), { status: 400 });

  const token = nanoid(32);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const pwHash = password ? await hashToken(password) : null;

  await env.DB.prepare(
    `INSERT INTO share_links (id, file_id, project_id, created_by, token, password_hash, download_limit, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(nanoid(), fileId ?? null, projectId ?? null, payload.sub, token, pwHash, downloadLimit ?? null, expiresAt).run();

  return json({
    token,
    url: `https://stemfer.com/share/${token}`,
    expiresAt,
  }, { status: 201 });
});

// GET /share/:token — resolve share link (public)
shareRoutes.get('/:token', async (req, env) => {
  const { token }   = req.params;
  const password    = req.headers.get('X-Share-Password') ?? '';

  const link = await env.DB.prepare(
    `SELECT sl.*, f.original_name, f.size_bytes, f.mime_type, f.duration_ms, f.processing_status as file_status
     FROM share_links sl
     LEFT JOIN files f ON f.id = sl.file_id
     WHERE sl.token = ?`
  ).bind(token).first<any>();

  if (!link) throw Object.assign(new Error('Share link not found'), { status: 404 });
  if (link.expires_at && new Date(link.expires_at) < new Date())
    throw Object.assign(new Error('Share link expired'), { status: 410 });
  if (link.download_limit !== null && link.download_count >= link.download_limit)
    throw Object.assign(new Error('Download limit reached'), { status: 403 });
  if (link.password_hash) {
    if (!password || !(await verifyToken(password, link.password_hash)))
      throw Object.assign(new Error('Password required'), { status: 401 });
  }

  return json({
    token,
    fileId:     link.file_id,
    projectId:  link.project_id,
    filename:   link.original_name,
    size:       link.size_bytes,
    mimeType:   link.mime_type,
    expiresAt:  link.expires_at,
    hasPassword: !!link.password_hash,
  });
});

// GET /share/:token/download — download via share link
shareRoutes.get('/:token/download', async (req, env) => {
  const { token } = req.params;
  const password  = req.headers.get('X-Share-Password') ?? '';

  const link = await env.DB.prepare(
    `SELECT sl.*, f.r2_key, f.original_name, f.mime_type, f.size_bytes
     FROM share_links sl JOIN files f ON f.id = sl.file_id
     WHERE sl.token = ?`
  ).bind(token).first<any>();

  if (!link) throw Object.assign(new Error('Not found'), { status: 404 });
  if (link.expires_at && new Date(link.expires_at) < new Date())
    throw Object.assign(new Error('Expired'), { status: 410 });
  if (link.password_hash && !(await verifyToken(password, link.password_hash)))
    throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const obj = await env.FILES.get(link.r2_key);
  if (!obj) throw Object.assign(new Error('File not found'), { status: 404 });

  await env.DB.prepare(
    `UPDATE share_links SET download_count = download_count + 1 WHERE token = ?`
  ).bind(token).run();

  const headers = new Headers({
    'Content-Type':        link.mime_type ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${link.original_name}"`,
    'Content-Length':      String(link.size_bytes),
  });

  return new Response(obj.body, { headers });
});

async function hashToken(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyToken(value: string, stored: string): Promise<boolean> {
  return (await hashToken(value)) === stored;
}
