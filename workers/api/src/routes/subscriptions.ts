import { AutoRouter, json, IRequest } from 'itty-router';
import { requireAuth } from '../lib/auth';
import { nanoid } from '../lib/db';
import type { Env } from '../types/env';

const PLANS = {
  free: {
    name: 'Free',
    storage_limit_bytes: 5 * 1024 * 1024 * 1024,   // 5 GB
    upload_limit_bytes:  500 * 1024 * 1024,          // 500 MB
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

// POST /subscriptions/checkout — create Stripe checkout session
subscriptionRoutes.post('/checkout', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { plan, successUrl, cancelUrl } = await req.json<any>();

  const priceIds: Record<string, string> = {
    pro:    env.STRIPE_PRICE_PRO    ?? 'price_pro',
    studio: env.STRIPE_PRICE_STUDIO ?? 'price_studio',
  };

  if (!priceIds[plan])
    throw Object.assign(new Error('Invalid plan'), { status: 400 });

  const user = await env.DB.prepare(
    `SELECT email FROM users WHERE id = ?`
  ).bind(payload.sub).first<{ email: string }>();

  const sub = await env.DB.prepare(
    `SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?`
  ).bind(payload.sub).first<{ stripe_customer_id: string | null }>();

  // Create or reuse Stripe customer
  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const custRes = await stripeRequest(env, 'POST', '/v1/customers', {
      email: user?.email,
      metadata: { userId: payload.sub },
    });
    customerId = custRes.id;
    await env.DB.prepare(
      `UPDATE subscriptions SET stripe_customer_id = ? WHERE user_id = ?`
    ).bind(customerId, payload.sub).run();
  }

  const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', {
    customer:            customerId,
    mode:                'subscription',
    payment_method_types: ['card'],
    line_items:          [{ price: priceIds[plan], quantity: 1 }],
    success_url:         successUrl ?? 'https://stemfer.com/dashboard?upgraded=1',
    cancel_url:          cancelUrl  ?? 'https://stemfer.com/pricing',
    metadata:            { userId: payload.sub, plan },
  });

  return json({ url: session.url, sessionId: session.id });
});

// POST /subscriptions/portal — billing portal session
subscriptionRoutes.post('/portal', async (req, env) => {
  const payload = await requireAuth(req, env);
  const { returnUrl } = await req.json<any>().catch(() => ({}));

  const sub = await env.DB.prepare(
    `SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?`
  ).bind(payload.sub).first<{ stripe_customer_id: string | null }>();

  if (!sub?.stripe_customer_id)
    throw Object.assign(new Error('No billing account found'), { status: 400 });

  const session = await stripeRequest(env, 'POST', '/v1/billing_portal/sessions', {
    customer:   sub.stripe_customer_id,
    return_url: returnUrl ?? 'https://stemfer.com/dashboard',
  });

  return json({ url: session.url });
});

// POST /subscriptions/webhook — Stripe webhook handler
subscriptionRoutes.post('/webhook', async (req, env) => {
  const sig     = req.headers.get('stripe-signature') ?? '';
  const body    = await req.text();
  const event   = await verifyStripeWebhook(body, sig, env.STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session  = event.data.object;
      const userId   = session.metadata?.userId;
      const plan     = session.metadata?.plan;
      if (!userId || !plan) break;

      const limits = PLANS[plan as keyof typeof PLANS] ?? PLANS.free;
      await env.DB.prepare(
        `UPDATE subscriptions SET
           plan = ?, status = 'active',
           stripe_subscription_id = ?,
           storage_limit_bytes = ?, upload_limit_bytes = ?,
           max_projects = ?, team_seats = ?,
           updated_at = datetime('now')
         WHERE user_id = ?`
      ).bind(
        plan, session.subscription,
        limits.storage_limit_bytes, limits.upload_limit_bytes,
        limits.max_projects, limits.team_seats,
        userId
      ).run();
      break;
    }

    case 'customer.subscription.updated': {
      const sub    = event.data.object;
      const status = sub.status;
      await env.DB.prepare(
        `UPDATE subscriptions SET status = ?,
           current_period_start = datetime(?, 'unixepoch'),
           current_period_end   = datetime(?, 'unixepoch'),
           cancel_at_period_end = ?,
           updated_at = datetime('now')
         WHERE stripe_subscription_id = ?`
      ).bind(
        status,
        sub.current_period_start,
        sub.current_period_end,
        sub.cancel_at_period_end ? 1 : 0,
        sub.id
      ).run();
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const limits = PLANS.free;
      await env.DB.prepare(
        `UPDATE subscriptions SET
           plan = 'free', status = 'canceled',
           stripe_subscription_id = NULL,
           storage_limit_bytes = ?, upload_limit_bytes = ?,
           max_projects = ?, team_seats = ?,
           updated_at = datetime('now')
         WHERE stripe_subscription_id = ?`
      ).bind(
        limits.storage_limit_bytes, limits.upload_limit_bytes,
        limits.max_projects, limits.team_seats,
        sub.id
      ).run();
      break;
    }
  }

  return json({ received: true });
});

async function stripeRequest(env: Env, method: string, path: string, body?: Record<string, any>) {
  const params = body ? new URLSearchParams(flattenObject(body)).toString() : undefined;
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = await res.json<any>();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? 'Stripe error'), { status: 400 });
  return data;
}

function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(acc, flattenObject(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          Object.assign(acc, flattenObject(item, `${key}[${i}]`));
        } else {
          acc[`${key}[${i}]`] = String(item);
        }
      });
    } else {
      acc[key] = String(v);
    }
    return acc;
  }, {} as Record<string, string>);
}

async function verifyStripeWebhook(payload: string, sig: string, secret: string): Promise<any> {
  const parts     = sig.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const v1        = parts.find(p => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !v1) throw Object.assign(new Error('Invalid signature'), { status: 400 });

  const signed   = `${timestamp}.${payload}`;
  const key      = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== v1) throw Object.assign(new Error('Webhook signature mismatch'), { status: 400 });

  const age = Date.now() / 1000 - parseInt(timestamp);
  if (age > 300) throw Object.assign(new Error('Webhook too old'), { status: 400 });

  return JSON.parse(payload);
}
