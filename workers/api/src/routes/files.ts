import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid, logActivity } from '../lib/db';
import type { Env } from '../types/env';

export const fileRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/files' });

// GET /files?projectId=&sessionId=
fileRoutes.get('/', async (req, env) => {
  const payload   = await requireAuth(req, env);
  const url       = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const sessionId = url.searchParams.get('sessionId');

  if (!projectId) throw Object.assign(new Error('projectId required'), { status: 400 });

  // Verify access
  const access = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).bind(projectId, payload.sub).first();
  if (!access) throw Object.assign(new Error('Access denied'), { status: 403 });

  const folderId = url.searchParams.get('folderId');

  let query = `SELECT f.*, u.name as uploader_name FROM files f
               LEFT JOIN users u ON u.id = f.uploaded_by
               WHERE f.project_id = ? AND f.processing_status != 'deleted'`;
  const params: any[] = [projectId];

  if (sessionId) { query += ' AND f.session_id = ?'; params.push(sessionId); }

  if (folderId === 'root') {
    query += ' AND f.folder_id IS NULL';
  } else if (folderId) {
    query += ' AND f.folder_id = ?';
    params.push(folderId);
  }

  query += ' ORDER BY f.timeline_track ASC, f.offset_ms ASC';

  const files = await env.DB.prepare(query).bind(...params).all();
  return json(files.results);
});

// GET /files/:id
fileRoutes.get('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub);
  return json(file);
});

// GET /files/:id/download — generate signed URL
fileRoutes.get('/:id/download', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub) as any;

  if (file.expires_at && new Date(file.expires_at) < new Date())
    throw Object.assign(new Error('File has expired'), { status: 410 });
  if (file.download_limit !== null && file.download_count >= file.download_limit)
    throw Object.assign(new Error('Download limit reached'), { status: 403 });

  const obj = await env.FILES.get(file.r2_key);
  if (!obj) throw Object.assign(new Error('File not found in storage'), { status: 404 });

  // Increment download count
  await env.DB.prepare(
    `UPDATE files SET download_count = download_count + 1 WHERE id = ?`
  ).bind(file.id).run();

  const headers = new Headers();
  headers.set('Content-Type', file.mime_type ?? 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${file.original_name}"`);
  headers.set('Content-Length', String(file.size_bytes));
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(obj.body, { headers });
});

// PATCH /files/:id — update timecode / metadata
fileRoutes.patch('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub) as any;

  const allowed = [
    'start_timecode', 'offset_ms', 'timeline_track', 'is_locked',
    'is_muted', 'group_id', 'bpm', 'time_signature', 'session_id', 'folder_id',
  ];
  const body    = await req.json<any>();
  const updates = Object.entries(body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return json(file);

  const set  = updates.map(([k]) => `${k} = ?`).join(', ');
  const vals = updates.map(([, v]) => v);
  await env.DB.prepare(
    `UPDATE files SET ${set}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...vals, file.id).run();

  await logActivity(env, {
    projectId: file.project_id,
    userId: payload.sub,
    action: 'file_update',
    entityType: 'file',
    entityId: file.id,
  });

  return json(await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(file.id).first());
});

// DELETE /files/:id
fileRoutes.delete('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub) as any;

  // Soft delete — mark status, keep R2 object (schedule cleanup via queue)
  await env.DB.prepare(
    `UPDATE files SET processing_status = 'deleted', updated_at = datetime('now') WHERE id = ?`
  ).bind(file.id).run();

  // Queue R2 deletion
  await env.PROCESSING_QUEUE.send({ type: 'delete_file', r2Key: file.r2_key, fileId: file.id });

  await logActivity(env, {
    projectId: file.project_id,
    userId: payload.sub,
    action: 'file_delete',
    entityType: 'file',
    entityId: file.id,
    metadata: { filename: file.original_name },
  });

  return json({ ok: true });
});

// POST /files/:id/versions — upload new version
fileRoutes.post('/:id/versions', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub) as any;

  const newId = nanoid();
  const r2Key = `projects/${file.project_id}/${newId}/${file.filename}`;

  await env.DB.prepare(
    `INSERT INTO files (id, project_id, session_id, uploaded_by, r2_key, file_url, filename, original_name,
                        mime_type, size_bytes, parent_file_id, version, processing_status)
     SELECT ?, project_id, session_id, ?, ?, '', filename, original_name,
            mime_type, 0, id, version + 1, 'pending'
     FROM files WHERE id = ?`
  ).bind(newId, payload.sub, r2Key, file.id).run();

  return json({ fileId: newId, r2Key, version: (file.version ?? 1) + 1 }, { status: 201 });
});

// GET /files/:id/versions
fileRoutes.get('/:id/versions', async (req, env) => {
  const payload = await requireAuth(req, env);
  const file    = await getFileWithAccess(env, req.params.id, payload.sub) as any;

  const rootId = file.parent_file_id ?? file.id;
  const versions = await env.DB.prepare(
    `SELECT id, version, size_bytes, created_at, processing_status FROM files
     WHERE (id = ? OR parent_file_id = ?) ORDER BY version ASC`
  ).bind(rootId, rootId).all();

  return json(versions.results);
});

async function getFileWithAccess(env: Env, fileId: string, userId: string) {
  const file = await env.DB.prepare(
    `SELECT f.* FROM files f
     JOIN project_members pm ON pm.project_id = f.project_id AND pm.user_id = ?
     WHERE f.id = ? AND f.processing_status != 'deleted'`
  ).bind(userId, fileId).first();
  if (!file) throw Object.assign(new Error('File not found'), { status: 404 });
  return file;
}
