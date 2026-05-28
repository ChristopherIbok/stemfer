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
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_CLIENT_ID: string;
  // Resend — transactional email
  RESEND_API_KEY: string;
  // Vars
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_STUDIO?: string;
}
