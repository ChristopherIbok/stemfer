import { AutoRouter, json, IRequest } from 'itty-router';
import { requireRole } from '../lib/auth';
import type { Env } from '../types/env';

export const adminRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/admin' });

adminRoutes.get('/stats', async (req, env) => {
  await requireRole(req, env, 'admin');
  const [users, storage, conversions] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 END) as new_7d FROM users`),
    env.DB.prepare(`SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE processing_status != 'deleted'`),
    env.DB.prepare(`SELECT status, COUNT(*) as count FROM conversions GROUP BY status`),
  ]);
  return json({ users: users.results[0], storage: storage.results[0], conversions: conversions.results });
});

adminRoutes.get('/users', async (req, env) => {
  await requireRole(req, env, 'admin');
  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const search = url.searchParams.get('search') ?? '';

  const users = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, s.plan, s.status as sub_status,
            COALESCE(f.total, 0) as storage_used
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN (SELECT uploaded_by, SUM(size_bytes) as total FROM files GROUP BY uploaded_by) f ON f.uploaded_by = u.id
     WHERE u.email LIKE ? OR u.name LIKE ?
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).bind(`%${search}%`, `%${search}%`, limit, offset).all();

  return json(users.results);
});

adminRoutes.patch('/users/:id', async (req, env) => {
  await requireRole(req, env, 'admin');
  const { id }  = req.params;
  const { role } = await req.json<any>();
  if (!['user', 'admin'].includes(role)) throw Object.assign(new Error('Invalid role'), { status: 400 });
  await env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, id).run();
  return json({ ok: true });
});

adminRoutes.get('/audit', async (req, env) => {
  await requireRole(req, env, 'admin');
  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500);
  const logs   = await env.DB.prepare(
    `SELECT al.*, u.name as user_name, u.email FROM activity_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC LIMIT ?`
  ).bind(limit).all();
  return json(logs.results);
});
