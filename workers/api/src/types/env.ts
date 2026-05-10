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
  // Gmail API — OAuth2 service account credentials for sending email
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  GMAIL_SENDER: string;  // e.g. "Stemfer <noreply@yourgmail.com>"
  // Vars
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
}
