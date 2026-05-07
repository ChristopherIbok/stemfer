'use client';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { Music2 } from 'lucide-react';

export default function TransferLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <nav className="border-b border-surface-300 bg-surface-100 flex-shrink-0">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-brand-green-400 font-bold text-lg flex items-center gap-2">
            <Music2 size={18} />
            Stemfer
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard" className="btn-ghost text-sm">Dashboard</Link>
            ) : (
              <>
                <Link href="/auth/login" className="text-sm text-zinc-400 hover:text-white transition-colors">Sign in</Link>
                <Link href="/auth/register" className="btn-primary text-sm">Get started free</Link>
              </>
            )}
          </div>
        </div>
      </nav>
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
