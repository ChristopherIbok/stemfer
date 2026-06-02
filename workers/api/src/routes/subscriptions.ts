import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import type { Env } from '../types/env';

const PLANS = {
  free: {
    name: 'Free',
    storage_limit_bytes: 5 * 1024 * 1024 * 1024,   // 5 GB
    upload_limit_bytes:  500 * 1024 * 1024,        // 500 MB
    max_projects: 3,
    team_seats: 1,
  },
  pro: {
    name: 'Pro',
    storage_limit_bytes: 100 * 1024 * 1024 * 1024,  // 100 GB
    upload_limit_bytes:  5 * 1024 * 1024 * 1024,    // 5 GB
    max_projects: 50,
    team_seats: 1,
  },
  studio: {
    name: 'Studio',
    storage_limit_bytes: 500 * 1024 * 1024 * 1024,  // 500 GB
    upload_limit_bytes:  25 * 1024 * 1024 * 1024,   // 25 GB
    max_projects: -1,  // unlimited
    team_seats: 10,
  },
};

export const subscriptionRoutes = AutoRouter<IRequest, [Env, ExecutionContext]>({ base: '/subscriptions' });

// GET /subscriptions/me
subscriptionRoutes.get('/me', async (req, env) => {
  const payload = await requireAuth(req, env);
  const sub = await env.DB.prepare(
    `SELECT s.*, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`
  ).bind(payload.sub).first();
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  return json(sub);
});

// POST /subscriptions/checkout — create Paystack checkout session
subscriptionRoutes.post('/checkout', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { plan, successUrl } = await req.json<any>();

  const planCodes: Record<string, string> = {
    pro:    env.PAYSTACK_PLAN_PRO    ?? 'PLN_pro',
    studio: env.PAYSTACK_PLAN_STUDIO ?? 'PLN_studio',
  };

  if (!planCodes[plan])
    throw Object.assign(new Error('Invalid plan'), { status: 400 });

  const user = await env.DB.prepare(
    `SELECT email FROM users WHERE id = ?`
  ).bind(payload.sub).first<{ email: string }>();

  // Paystack transaction initialization
  // Note: amount is required by Paystack even for subscriptions (usually the first month's charge in kobo)
  const amountKobo = plan === 'studio' ? 1500000 : 500000; // e.g. 15,000 NGN or 5,000 NGN

  const session = await paystackRequest(env, 'POST', '/transaction/initialize', {
    email: user?.email,
    amount: amountKobo,
    plan: planCodes[plan],
    callback_url: successUrl ?? 'https://stemfer.com/dashboard?upgraded=1',
    metadata: { userId: payload.sub, plan },
  });

  return json({ url: session.data.authorization_url, reference: session.data.reference });
});

// POST /subscriptions/portal — billing portal session
subscriptionRoutes.post('/portal', async (req, env) => {
  const payload = await requireAuth(req, env);

  const sub = await env.DB.prepare(
    `SELECT paystack_subscription_code FROM subscriptions WHERE user_id = ?`
  ).bind(payload.sub).first<{ paystack_subscription_code: string | null }>();

  if (!sub?.paystack_subscription_code)
    throw Object.assign(new Error('No active Paystack subscription found'), { status: 400 });

  // Generate a manage subscription link
  const linkRes = await paystackRequest(env, 'GET', `/subscription/${sub.paystack_subscription_code}/manage/link`);

  return json({ url: linkRes.data.link });
});

// POST /subscriptions/webhook — Paystack webhook handler
subscriptionRoutes.post('/webhook', async (req, env) => {
  const sig  = req.headers.get('x-paystack-signature') ?? '';
  const body = await req.text();
  
  await verifyPaystackWebhook(body, sig, env.PAYSTACK_SECRET_KEY);
  const event = JSON.parse(body);

  switch (event.event) {
    case 'charge.success': {
      const data   = event.data;
      const userId = data.metadata?.userId;
      const plan   = data.metadata?.plan;
      if (!userId || !plan) break;

      const customerCode = data.customer?.customer_code;
      const limits = PLANS[plan as keyof typeof PLANS] ?? PLANS.free;
      
      await env.DB.prepare(
        `UPDATE subscriptions SET
           plan = ?, status = 'active',
           paystack_customer_code = ?,
           storage_limit_bytes = ?, upload_limit_bytes = ?,
           max_projects = ?, team_seats = ?,
           updated_at = datetime('now')
         WHERE user_id = ?`
      ).bind(
        plan, customerCode,
        limits.storage_limit_bytes, limits.upload_limit_bytes,
        limits.max_projects, limits.team_seats,
        userId
      ).run();
      break;
    }

    case 'subscription.create': {
      const data = event.data;
      const subCode = data.subscription_code;
      const customerCode = data.customer?.customer_code;
      
      await env.DB.prepare(
        `UPDATE subscriptions SET 
           paystack_subscription_code = ?,
           status = 'active',
           current_period_end = datetime(?, 'unixepoch'),
           updated_at = datetime('now')
         WHERE paystack_customer_code = ?`
      ).bind(
        subCode,
        Math.floor(new Date(data.next_payment_date).getTime() / 1000),
        customerCode
      ).run();
      break;
    }

    case 'subscription.disable': {
      const data = event.data;
      const subCode = data.subscription_code;
      const limits = PLANS.free;
      
      await env.DB.prepare(
        `UPDATE subscriptions SET
           plan = 'free', status = 'canceled',
           paystack_subscription_code = NULL,
           storage_limit_bytes = ?, upload_limit_bytes = ?,
           max_projects = ?, team_seats = ?,
           updated_at = datetime('now')
         WHERE paystack_subscription_code = ?`
      ).bind(
        limits.storage_limit_bytes, limits.upload_limit_bytes,
        limits.max_projects, limits.team_seats,
        subCode
      ).run();
      break;
    }
  }

  return json({ received: true });
});

async function paystackRequest(env: Env, method: string, path: string, body?: Record<string, any>) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json<any>();
  if (!res.ok || !data.status) {
    throw Object.assign(new Error(data.message ?? 'Paystack error'), { status: 400 });
  }
  return data;
}

async function verifyPaystackWebhook(payload: string, sig: string, secret: string): Promise<void> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (sig !== expected) {
    throw Object.assign(new Error('Invalid signature'), { status: 400 });
  }
}
