'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export default function DevLogin() {
  const router  = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);

  useEffect(() => {
    const user = {
      id: 'demo-user-001', email: 'demo@stemfer.com', name: 'Demo Producer',
      role: 'user' as const, plan: 'pro' as any, avatar_url: undefined,
      storage_used: 2_400_000_000, storage_limit_bytes: 107_374_182_400,
      upload_limit_bytes: 5_368_709_120, max_projects: 50,
      created_at: '2025-01-01T00:00:00Z',
    };
    setAuth('demo-token-local', user);
    router.push('/dashboard');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-zinc-400 text-sm">
      Logging in as Demo Producer…
    </div>
  );
}
