# Stemfer — Deployment Guide

## Prerequisites
- [Cloudflare account](https://dash.cloudflare.com) with Workers Paid plan (for D1, R2, Queues, Durable Objects)
- [Vercel account](https://vercel.com) (free tier works for Next.js)
- [Stripe account](https://stripe.com) with products configured
- Node.js ≥ 20, pnpm ≥ 9

---

## 1. Install dependencies

```bash
npm install -g pnpm
pnpm install
```

---

## 2. Cloudflare — Create resources

### D1 Database
```bash
wrangler d1 create stemfer-db
# Copy the database_id into workers/api/wrangler.toml and workers/stem-engine/wrangler.toml
```

### Run migrations
```bash
wrangler d1 execute stemfer-db --file=infra/d1/0001_initial_schema.sql --remote
```

### R2 Bucket
```bash
wrangler r2 bucket create stemfer-files
# Optional: enable public access in Cloudflare dashboard for CDN delivery
```

### Queues
```bash
wrangler queues create stemfer-processing
wrangler queues create stemfer-stem-queue
```

---

## 3. Set Worker secrets

```bash
cd workers/api

wrangler secret put JWT_SECRET
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
```

---

## 4. Deploy Workers

```bash
# API Worker
cd workers/api
wrangler deploy

# Stem Engine Worker
cd ../stem-engine
wrangler deploy
```

---

## 5. Configure Stripe

1. Create products in Stripe Dashboard:
   - **Pro** — $19/mo recurring
   - **Studio** — $79/mo recurring

2. Copy price IDs into `workers/api/src/routes/subscriptions.ts` (or use environment variables).

3. Set up webhook endpoint:
   - URL: `https://api.stemfer.com/subscriptions/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

4. Copy webhook signing secret → `wrangler secret put STRIPE_WEBHOOK_SECRET`

---

## 6. Deploy Next.js to Vercel

```bash
cd apps/web
cp .env.example .env.local
# Fill in .env.local values

# Deploy
vercel --prod
```

Set these environment variables in Vercel dashboard:
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.stemfer.com` (your Worker URL) |
| `NEXT_PUBLIC_STRIPE_PK` | Stripe publishable key |

---

## 7. Custom domains (optional)

- **API**: Add route `api.stemfer.com/*` in Cloudflare Workers dashboard
- **Files CDN**: Add custom domain to R2 bucket → `files.stemfer.com`
- **Web**: Add `stemfer.com` in Vercel project settings

---

## Local Development

```bash
# Terminal 1 — API Worker (with local D1 + R2)
cd workers/api
wrangler dev --local

# Terminal 2 — Next.js
cd apps/web
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8787
pnpm dev
```

---

## Architecture Overview

```
stemfer.com (Vercel / Next.js)
      │
      ▼
api.stemfer.com (Cloudflare Workers)
      │
      ├── D1 (SQLite — database)
      ├── R2 (object storage — audio files)
      ├── Queues (background processing)
      └── Durable Objects (real-time presence)

stemfer-stem-engine (Cloudflare Worker — DAW processing)
      │
      └── Queue consumer for stem extraction jobs
```

---

## Security checklist

- [x] JWT HS256 with 7-day expiry
- [x] PBKDF2 password hashing (100k iterations)
- [x] Stripe webhook signature verification (HMAC-SHA256)
- [x] Per-project RBAC (owner / admin / editor / viewer)
- [x] File ownership checked on every request
- [x] Upload size enforced per subscription plan
- [x] Storage quota checked before each upload
- [x] Soft-delete for files (R2 deletion queued separately)
- [x] Share link expiry + download limits + optional password
- [x] CORS locked to frontend origin
