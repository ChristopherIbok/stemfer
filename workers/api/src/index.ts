import { AutoRouter, cors, error, json } from 'itty-router';
import { authRoutes }         from './routes/auth';
import { projectRoutes }      from './routes/projects';
import { fileRoutes }         from './routes/files';
import { uploadRoutes }       from './routes/upload';
import { subscriptionRoutes } from './routes/subscriptions';
import { shareRoutes }        from './routes/share';
import { adminRoutes }        from './routes/admin';
import { presenceRoutes }     from './routes/presence';
import { transferRoutes }     from './routes/transfer';
import { folderRoutes }       from './routes/folders';
import type { Env }           from './types/env';

const { preflight, corsify } = cors({
  origin: (origin) => origin, // reflect origin — tighten in production
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Upload-Id', 'X-Transfer-Upload-Id', 'X-Chunk-Index', 'X-File-Key'],
  maxAge: 86400,
});

const router = AutoRouter<Request, [Env, ExecutionContext]>({
  before: [preflight],
  finally: [corsify],
  catch: (err) => {
    console.error(err);
    const status = (err as any).status ?? 500;
    const message = (err as any).message ?? 'Internal Server Error';
    return json({ error: message }, { status });
  },
});

// Health
router.get('/health', () => json({ ok: true, ts: Date.now() }));

// Mount routes
router.all('/auth/*',    authRoutes.fetch);
router.all('/projects/*', projectRoutes.fetch);
router.all('/files/*',   fileRoutes.fetch);
router.all('/upload/*',  uploadRoutes.fetch);
router.all('/subscriptions/*', subscriptionRoutes.fetch);
router.all('/share/*',   shareRoutes.fetch);
router.all('/admin/*',   adminRoutes.fetch);
router.all('/presence/*',  presenceRoutes.fetch);
router.all('/transfer/*', transferRoutes.fetch);
router.all('/folders/*',  folderRoutes.fetch);

export { PresenceDO } from './durable-objects/presence';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.fetch(req, env, ctx);
  },
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    const { handleQueue } = await import('./queue/processor');
    await handleQueue(batch, env);
  },
};
