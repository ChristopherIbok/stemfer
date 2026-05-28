import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import type { Env } from '../types/env';

export const presenceRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/presence' });

// GET /presence/:projectId — WebSocket upgrade for real-time presence
presenceRoutes.get('/:projectId', async (req, env) => {
  const payload = await requireAuth(req, env);

  const upgrade = req.headers.get('Upgrade');
  if (upgrade?.toLowerCase() !== 'websocket')
    throw Object.assign(new Error('WebSocket upgrade required'), { status: 426 });

  const id = env.PRESENCE.idFromName(req.params.projectId);
  const stub = env.PRESENCE.get(id);
  return stub.fetch(req);
});
