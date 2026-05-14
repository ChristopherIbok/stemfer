'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Music2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

function LoginPageInner() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/projects';

  const handleGoogleLogin = () => {
    localStorage.setItem('auth_redirect', redirect);
    window.location.href = `${API_URL}/auth/google`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-brand-green-400 font-bold text-xl mb-6">
            <Music2 size={22} />
            Stemfer
          </Link>
          <h1 className="text-2xl font-bold text-white mt-4">Welcome back</h1>
          <p className="text-zinc-500 text-sm mt-1">Sign in to your studio</p>
        </div>

        <div className="card space-y-4">
          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="btn-secondary w-full justify-center gap-3 h-11"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-surface-300" />
            <span className="text-xs text-zinc-600">or</span>
            <div className="flex-1 h-px bg-surface-300" />
          </div>

          {/* Email/password placeholder — can be wired up later */}
          <p className="text-center text-xs text-zinc-600">
            Email login coming soon. Use Google to get started.
          </p>

          <p className="text-center text-xs text-zinc-700 leading-relaxed">
            By signing in you agree to our{' '}
            <Link href="/terms"   className="text-zinc-500 hover:text-white transition-colors">Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-zinc-500 hover:text-white transition-colors">Privacy Policy</Link>.
          </p>
        </div>

        <p className="text-center text-xs text-zinc-700 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="text-brand-green-400 hover:underline">Get started free</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Music2 size={36} className="text-brand-green-400 animate-pulse" />
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.332 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
      <path d="M6.306 14.691l6.571 4.819C14.655 15.108 19.000 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
      <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.316 0-9.828-3.266-11.573-7.928l-6.527 5.028C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
      <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
    </svg>
  );
}
