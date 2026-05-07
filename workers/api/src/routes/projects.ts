import { AutoRouter, json } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid, getProject, logActivity } from '../lib/db';
import type { Env } from '../types/env';

export const projectRoutes = AutoRouter<Request, [Env, ExecutionContext]>({ base: '/projects' });

// GET /projects
projectRoutes.get('/', async (req, env) => {
  const payload = await requireAuth(req, env);
  const projects = await env.DB.prepare(
    `SELECT p.*, pm.role as member_role,
            COUNT(DISTINCT f.id) as file_count,
            COUNT(DISTINCT s.id) as session_count
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN files f ON f.project_id = p.id
     LEFT JOIN sessions s ON s.project_id = p.id
     WHERE p.status != 'deleted'
     GROUP BY p.id
     ORDER BY p.updated_at DESC`
  ).bind(payload.sub).all();
  return json(projects.results);
});

// POST /projects
projectRoutes.post('/', async (req, env) => {
  const payload  = await requireAuth(req, env);
  const { name, description, bpm, time_sig, sample_rate, color } = await req.json<any>();
  if (!name?.trim()) throw Object.assign(new Error('Project name required'), { status: 400 });

  // Check project limit
  const sub = await env.DB.prepare(
    'SELECT max_projects FROM subscriptions WHERE user_id = ?'
  ).bind(payload.sub).first<{ max_projects: number }>();
  const count = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE pm.user_id = ? AND p.status = 'active'`
  ).bind(payload.sub).first<{ c: number }>();

  if ((count?.c ?? 0) >= (sub?.max_projects ?? 3))
    throw Object.assign(new Error('Project limit reached for your plan'), { status: 403 });

  const id = nanoid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, description, bpm, time_sig, sample_rate, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, payload.sub, name.trim(), description ?? null, bpm ?? null, time_sig ?? '4/4', sample_rate ?? 48000, color ?? '#22c55e'),
    env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')`
    ).bind(id, payload.sub),
  ]);

  await logActivity(env, { projectId: id, userId: payload.sub, action: 'project_create', entityType: 'project', entityId: id });
  const project = await getProject(env, id);
  return json(project, { status: 201 });
});

// GET /projects/:id
projectRoutes.get('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id } = req.params;

  const project = await env.DB.prepare(
    `SELECT p.*, pm.role as member_role FROM projects p
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? AND p.status != 'deleted'`
  ).bind(payload.sub, id).first();
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  return json(project);
});

// PATCH /projects/:id
projectRoutes.patch('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin']);

  const fields  = await req.json<any>();
  const allowed = ['name', 'description', 'bpm', 'time_sig', 'sample_rate', 'color'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return json({ ok: true });

  const set = updates.map(([k]) => `${k} = ?`).join(', ');
  const vals = updates.map(([, v]) => v);
  await env.DB.prepare(
    `UPDATE projects SET ${set}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...vals, id).run();

  await logActivity(env, { projectId: id, userId: payload.sub, action: 'project_update', entityType: 'project', entityId: id });
  return json(await getProject(env, id));
});

// DELETE /projects/:id
projectRoutes.delete('/:id', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner']);

  await env.DB.prepare(`UPDATE projects SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  await logActivity(env, { projectId: id, userId: payload.sub, action: 'project_delete', entityType: 'project', entityId: id });
  return json({ ok: true });
});

// GET /projects/:id/members
projectRoutes.get('/:id/members', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin', 'editor', 'viewer']);

  const members = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.avatar_url, pm.role, pm.added_at
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?`
  ).bind(id).all();
  return json(members.results);
});

// POST /projects/:id/members
projectRoutes.post('/:id/members', async (req, env) => {
  const payload  = await requireAuth(req, env);
  const { id }   = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin']);

  const { email, role } = await req.json<any>();
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  await env.DB.prepare(
    `INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)`
  ).bind(id, user.id, role ?? 'viewer').run();

  await logActivity(env, { projectId: id, userId: payload.sub, action: 'member_add', entityType: 'member', entityId: user.id });
  return json({ ok: true });
});

// GET /projects/:id/activity
projectRoutes.get('/:id/activity', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin', 'editor', 'viewer']);

  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  const logs = await env.DB.prepare(
    `SELECT al.*, u.name as user_name, u.avatar_url
     FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.project_id = ?
     ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
  ).bind(id, limit, offset).all();
  return json(logs.results);
});

// GET /projects/:id/sessions
projectRoutes.get('/:id/sessions', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { id }  = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin', 'editor', 'viewer']);

  const sessions = await env.DB.prepare(
    `SELECT s.*, COUNT(f.id) as file_count FROM sessions s
     LEFT JOIN files f ON f.session_id = s.id
     WHERE s.project_id = ?
     GROUP BY s.id ORDER BY s.created_at DESC`
  ).bind(id).all();
  return json(sessions.results);
});

// POST /projects/:id/sessions
projectRoutes.post('/:id/sessions', async (req, env) => {
  const payload  = await requireAuth(req, env);
  const { id }   = req.params;
  await assertProjectRole(env, payload.sub, id, ['owner', 'admin', 'editor']);

  const { name, description, bpm, time_sig, sample_rate } = await req.json<any>();
  if (!name?.trim()) throw Object.assign(new Error('Session name required'), { status: 400 });

  const sid = nanoid();
  await env.DB.prepare(
    `INSERT INTO sessions (id, project_id, name, description, bpm, time_sig, sample_rate, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sid, id, name.trim(), description ?? null, bpm ?? null, time_sig ?? null, sample_rate ?? 48000, payload.sub).run();

  await logActivity(env, { projectId: id, userId: payload.sub, action: 'session_create', entityType: 'session', entityId: sid });
  return json(await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(sid).first(), { status: 201 });
});

async function assertProjectRole(env: Env, userId: string, projectId: string, roles: string[]) {
  const mem = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`
  ).bind(projectId, userId).first<{ role: string }>();
  if (!mem || !roles.includes(mem.role))
    throw Object.assign(new Error('Access denied'), { status: 403 });
}
