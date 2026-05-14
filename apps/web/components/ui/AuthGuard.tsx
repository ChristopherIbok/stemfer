'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Music2 } from 'lucide-react';

/**
 * Wraps authenticated areas. Redirects to /auth/login if:
 * - token is absent after hydration
 * - refreshUser() returns a 401 (token expired)
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const token       = useAuthStore(s => s.token);
  const user        = useAuthStore(s => s.user);
  const loading     = useAuthStore(s => s.loading);
  const refreshUser = useAuthStore(s => s.refreshUser);

  useEffect(() => {
    if (!token) {
      const redirect = window.location.pathname + window.location.search;
      router.replace(`/auth/login?redirect=${encodeURIComponent(redirect)}`);
      return;
    }
    if (!user) refreshUser();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Token absent — redirect is in flight */
  if (!token) return null;

  /* User data not yet loaded — brief loading state */
  if (!user && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Music2 size={32} className="text-brand-green-400 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
