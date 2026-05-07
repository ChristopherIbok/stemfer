import type { Env } from '../types/env';

export function nanoid(size = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, b => chars[b & 63]).join('');
}

export async function getUser(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function getUserByEmail(env: Env, email: string) {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function getSubscription(env: Env, userId: string) {
  return env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first();
}

export async function getProject(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
}

export async function logActivity(
  env: Env,
  params: {
    projectId?: string;
    userId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: object;
    ipAddress?: string;
  }
) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (id, project_id, user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    nanoid(),
    params.projectId ?? null,
    params.userId ?? null,
    params.action,
    params.entityType ?? null,
    params.entityId ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.ipAddress ?? null
  ).run();
}

export async function checkStorageLimit(env: Env, userId: string, fileSize: number): Promise<boolean> {
  const sub = await getSubscription(env, userId) as any;
  if (!sub) return false;
  const used = await env.DB.prepare(
    `SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE uploaded_by = ? AND processing_status != 'deleted'`
  ).bind(userId).first<{ total: number }>();
  return (used?.total ?? 0) + fileSize <= sub.storage_limit_bytes;
}
