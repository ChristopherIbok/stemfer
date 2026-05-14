'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Music2, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

function GoogleCallbackInner() {
  const router   = useRouter();
  const setAuth  = useAuthStore(s => s.setAuth);
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    /* Prevent double-fire in React StrictMode */
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      setError(oauthError === 'access_denied'
        ? 'You cancelled the sign-in. Please try again.'
        : `Google error: ${oauthError}`
      );
      return;
    }

    if (!code) {
      setError('No authorization code received from Google. Please try again.');
      return;
    }

    fetch(`${API_URL}/auth/oauth/google`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Server error ${res.status}`);
        }
        return res.json() as Promise<{ token: string; user: any }>;
      })
      .then(({ token, user }) => {
        setAuth(token, user);
        const redirect = localStorage.getItem('auth_redirect') ?? '/projects';
        localStorage.removeItem('auth_redirect');
        router.replace(redirect);
      })
      .catch((err: Error) => {
        console.error('Google OAuth error:', err);
        setError(err.message || 'Sign in failed. Please try again.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={24} className="text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Sign in failed</h2>
          <p className="text-zinc-500 text-sm mb-6">{error}</p>
          <a href="/auth/login" className="btn-primary inline-flex justify-center">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center animate-fade-in">
        <Music2 size={36} className="mx-auto mb-4 text-brand-green-400 animate-pulse" />
        <p className="text-white font-medium">Completing sign in…</p>
        <p className="text-zinc-600 text-sm mt-1">This only takes a moment</p>
      </div>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Music2 size={36} className="text-brand-green-400 animate-pulse" />
      </div>
    }>
      <GoogleCallbackInner />
    </Suspense>
  );
}
