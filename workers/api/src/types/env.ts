export interface Env {
  // D1
  DB: D1Database;
  // R2
  FILES: R2Bucket;
  // Queues
  PROCESSING_QUEUE: Queue;
  // Durable Objects
  PRESENCE: DurableObjectNamespace;
  // Secrets (set via wrangler secret put)
  JWT_SECRET: string;
  PAYSTACK_SECRET_KEY: string;
  // --- Prices ---
  PAYSTACK_PLAN_PRO?: string;
  PAYSTACK_PLAN_STUDIO?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_CLIENT_ID: string;
  // Resend — transactional email
  RESEND_API_KEY: string;
  // Vars
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
}
