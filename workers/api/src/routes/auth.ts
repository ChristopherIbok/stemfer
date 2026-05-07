import { AutoRouter, json } from 'itty-router';
import { signToken, requireAuth } from '../lib/auth';
import { nanoid, getUserByEmail, getSubscription, logActivity } from '../lib/db';
import type { Env } from '../types/env';

export const authRoutes = AutoRouter<Request, [Env, ExecutionContext]>({ base: '/auth' });

const GOOGLE_REDIRECT_URI = 'https://stemfer.com/auth/google-callback';
const ADMIN_EMAIL         = 'ibokchris@gmail.com';

// GET /auth/me
authRoutes.get('/me', async (req, env) => {
  const payload = await requireAuth(req, env);
  const user = await env.DB.prepare(
    `SELECT u.*, s.plan, s.status as sub_status, s.storage_limit_bytes, s.upload_limit_bytes,
            s.max_projects, s.team_seats, s.current_period_end,
            COALESCE(SUM(f.size_bytes), 0) as storage_used
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN files f ON f.uploaded_by = u.id AND f.processing_status != 'deleted'
     WHERE u.id = ?
     GROUP BY u.id`
  ).bind(payload.sub).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return json(user);
});

// GET /auth/google — redirect to Google consent page (server-side, avoids clientId exposure)
authRoutes.get('/google', async (req, env) => {
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'email profile',
    access_type:   'offline',
    prompt:        'select_account',
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

// POST /auth/oauth/google — exchange authorization code for session
authRoutes.post('/oauth/google', async (req, env) => {
  const { code } = await req.json() as any;
  if (!code) throw Object.assign(new Error('Missing authorization code'), { status: 400 });

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  const tokens = await tokenRes.json() as any;
  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', JSON.stringify(tokens));
    throw Object.assign(
      new Error(tokens.error_description ?? tokens.error ?? 'Google OAuth failed'),
      { status: 400 }
    );
  }

  // Fetch user profile
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) throw Object.assign(new Error('Failed to fetch Google profile'), { status: 400 });

  const profile = await profileRes.json() as any;
  if (!profile.email) throw Object.assign(new Error('Google did not return an email'), { status: 400 });

  const isAdmin = profile.email.toLowerCase() === ADMIN_EMAIL;
  const role    = isAdmin ? 'admin' : 'user';

  // Upsert user
  let user = await getUserByEmail(env, profile.email) as any;
  if (!user) {
    const userId = nanoid();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_id, verified, role)
         VALUES (?, ?, ?, ?, 'google', ?, 1, ?)`
      ).bind(userId, profile.email, profile.name, profile.picture ?? null, profile.id, role),
      env.DB.prepare(
        `INSERT INTO subscriptions (id, user_id, plan, status, storage_limit_bytes, upload_limit_bytes, max_projects, team_seats)
         VALUES (?, ?, 'free', 'active', 107374182400, 10737418240, 999, 99)`
      ).bind(nanoid(), userId),
    ]);
    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first() as any;
  } else {
    // Keep avatar and role fresh on every login
    await env.DB.prepare(`UPDATE users SET avatar_url = ?, role = ? WHERE id = ?`)
      .bind(profile.picture ?? user.avatar_url, role, user.id).run();
    user.avatar_url = profile.picture ?? user.avatar_url;
    user.role = role;
  }

  const sub  = await getSubscription(env, user.id) as any;
  const plan = isAdmin ? 'studio' : (sub?.plan ?? 'free');

  const token = await signToken({ sub: user.id, email: user.email, role, plan }, env);
  await logActivity(env, { userId: user.id, action: 'user_login_google', ipAddress: req.headers.get('CF-Connecting-IP') ?? undefined });

  return json({
    token,
    user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, role, plan },
  });
});

// POST /auth/logout
authRoutes.post('/logout', async (req, env) => {
  try {
    const payload = await requireAuth(req, env);
    await logActivity(env, { userId: payload.sub, action: 'user_logout' });
  } catch {}
  return json({ ok: true });
});
