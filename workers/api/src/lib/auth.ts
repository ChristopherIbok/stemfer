import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types/env';

export interface JWTPayload {
  sub: string;       // user id
  email: string;
  role: string;
  plan: string;
  iat: number;
  exp: number;
}

function secret(env: Env) {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, env: Env): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret(env));
}

export async function verifyToken(token: string, env: Env): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret(env));
  return payload as unknown as JWTPayload;
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const saltArr = Array.from(salt);
  return `${saltArr.map(b => b.toString(16).padStart(2, '0')).join('')}:${hashArr.map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const computed = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hashHex;
}

export async function requireAuth(req: Request, env: Env): Promise<JWTPayload> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  try {
    return await verifyToken(token, env);
  } catch {
    throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
  }
}

export async function requireRole(req: Request, env: Env, role: string): Promise<JWTPayload> {
  const payload = await requireAuth(req, env);
  if (payload.role !== role) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return payload;
}
