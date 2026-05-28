import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid, logActivity } from '../lib/db';
import type { Env } from '../types/env';

export const folderRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/folders' });

// GET /folders?projectId=&parentId=
folderRoutes.get('/', async (req, env) => {
  const payload   = await requireAuth(req, env);
  const url       = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const parentId  = url.searchParams.get('parentId') ?? null;

  if (!projectId) throw Object.assign(new Error('projectId required'), { status: 400 });

  const access = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).bind(projectId, payload.sub).first();
  if (!access) throw Object.assign(new Error('Access denied'), { status: 403 });

  const folders = parentId
    ? await env.DB.prepare(
        `SELECT f.*, COUNT(c.id) as child_count,
                (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id AND fi.processing_status != 'deleted') as file_count
         FROM folders f
         LEFT JOIN folders c ON c.parent_id = f.id
         WHERE f.project_id = ? AND f.parent_id = ?
         GROUP BY f.id ORDER BY f.name ASC`
      ).bind(projectId, parentId).all()
    : await env.DB.prepare(
        `SELECT f.*, COUNT(c.id) as child_count,
                (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id AND fi.processing_status != 'deleted') as file_count
         FROM folders f
         LEFT JOIN folders c ON c.parent_id = f.id
         WHERE f.project_id = ? AND f.parent_id IS NULL
         GROUP BY f.id ORDER BY f.name ASC`
      ).bind(projectId).all();

  return json(folders.results);
});

// POST /folders
folderRoutes.post('/', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { projectId, parentId, name } = await req.json<any>();

  if (!projectId) throw Object.assign(new Error('projectId required'), { status: 400 });
  if (!name?.trim()) throw Object.assign(new Error('name required'), { status: 400 });

  const access = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).bind(projectId, payload.sub).first<{ role: string }>();
  if (!access || access.role === 'viewer')
    throw Object.assign(new Error('Access denied'), { status: 403 });

  const id = nanoid();
  await env.DB.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, projectId, parentId ?? null, name.trim(), payload.sub).run();

  await logActivity(env, { projectId, userId: payload.sub, action: 'folder_create', entityType: 'folder', entityId: id });

  const folder = await env.DB.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first();
  return json(folder, { status: 201 });
});

// PATCH /folders/:id
folderRoutes.patch('/:id', async (req, env) => {
  const payload  = await requireAuth(req, env);
  const { id }   = req.params;
  const folder   = await getFolderWithAccess(env, id, payload.sub, ['owner', 'admin', 'editor']);

  const { name } = await req.json<any>();
  if (!name?.trim()) throw Object.assign(new Error('name required'), { status: 400 });

  await env.DB.prepare(
    `UPDATE folders SET name = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(name.trim(), id).run();

  await logActivity(env, { projectId: (folder as any).project_id, userId: payload.sub, action: 'folder_update', entityType: 'folder', entityId: id });
  return json(await env.DB.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first());
});

// DELETE /folders/:id
folderRoutes.delete('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  const folder  = await getFolderWithAccess(env, id, payload.sub, ['owner', 'admin', 'editor']) as any;

  // Move files in this folder to root (null) before deleting
  await env.DB.prepare(
    `UPDATE files SET folder_id = NULL WHERE folder_id = ?`
  ).bind(id).run();

  await env.DB.prepare(`DELETE FROM folders WHERE id = ?`).bind(id).run();
  await logActivity(env, { projectId: folder.project_id, userId: payload.sub, action: 'folder_delete', entityType: 'folder', entityId: id });
  return json({ ok: true });
});

// PATCH /folders/:id/move — move files into a folder
folderRoutes.patch('/:id/move-files', async (req, env) => {
  const payload   = await requireAuth(req, env);
  const { id }    = req.params;
  const folder    = await getFolderWithAccess(env, id, payload.sub, ['owner', 'admin', 'editor']) as any;
  const { fileIds } = await req.json<{ fileIds: string[] }>();

  if (!Array.isArray(fileIds) || fileIds.length === 0)
    throw Object.assign(new Error('fileIds required'), { status: 400 });

  const placeholders = fileIds.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE files SET folder_id = ?, updated_at = datetime('now')
     WHERE id IN (${placeholders}) AND project_id = ?`
  ).bind(id, ...fileIds, folder.project_id).run();

  return json({ ok: true, moved: fileIds.length });
});

async function getFolderWithAccess(env: Env, folderId: string, userId: string, roles: string[]) {
  const folder = await env.DB.prepare(`SELECT * FROM folders WHERE id = ?`).bind(folderId).first<any>();
  if (!folder) throw Object.assign(new Error('Folder not found'), { status: 404 });

  const mem = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).bind(folder.project_id, userId).first<{ role: string }>();
  if (!mem || !roles.includes(mem.role))
    throw Object.assign(new Error('Access denied'), { status: 403 });

  return folder;
}
