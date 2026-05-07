'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { AuthGuard } from './AuthGuard';
import {
  LayoutDashboard, FolderOpen, Upload,
  Music2, LogOut, User, HardDrive, Send,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects',  label: 'Projects',  icon: FolderOpen },
  { href: '/transfer',  label: 'Transfer',  icon: Send },
  { href: '/upload',    label: 'Upload',    icon: Upload },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/auth/login');
  };

  const storageRatio = user
    ? Math.min(1, user.storage_used / user.storage_limit_bytes)
    : 0;

  const storageColor =
    storageRatio > 0.9 ? '#ef4444' :
    storageRatio > 0.7 ? '#f59e0b' :
    '#22c55e';

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-surface">

        {/* ── Desktop sidebar ───────────────────────────────────────────── */}
        <aside className="hidden md:flex w-56 flex-shrink-0 border-r border-surface-300 bg-surface-100 flex-col">
          {/* Logo */}
          <div className="h-14 flex items-center px-5 border-b border-surface-300 flex-shrink-0">
            <Link
              href="/dashboard"
              className="text-lg font-bold text-brand-green-400 tracking-tight flex items-center gap-2 hover:text-brand-green-300 transition-colors"
            >
              <Music2 size={18} />
              Stemfer
            </Link>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  className={`nav-link ${active ? 'nav-link--active' : 'nav-link--inactive'}`}
                >
                  <Icon size={15} className={active ? 'text-brand-green-400' : 'text-zinc-500 group-hover:text-white'} />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-3 border-t border-surface-300 flex-shrink-0 space-y-2">
            <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
              <div className="w-7 h-7 rounded-full bg-brand-green-500/15 border border-brand-green-500/30 flex items-center justify-center flex-shrink-0">
                <User size={13} className="text-brand-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate leading-tight">{user?.name ?? 'User'}</p>
                <p className="text-[10px] text-zinc-500 capitalize leading-tight mt-0.5">{user?.plan ?? 'free'} plan</p>
              </div>
            </div>

            {user && (
              <div className="px-2">
                <div className="flex items-center justify-between text-[10px] text-zinc-600 mb-1.5">
                  <span className="flex items-center gap-1">
                    <HardDrive size={10} />
                    Storage
                  </span>
                  <span className={storageRatio > 0.9 ? 'text-red-400' : storageRatio > 0.7 ? 'text-amber-400' : ''}>
                    {formatBytes(user.storage_used)} / {formatBytes(user.storage_limit_bytes)}
                  </span>
                </div>
                <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${storageRatio * 100}%`, backgroundColor: storageColor, transition: 'width 0.6s' }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-zinc-500 hover:text-red-400 rounded-lg hover:bg-red-500/8 transition-colors"
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto min-w-0 pb-16 md:pb-0">
          {children}
        </main>

        {/* ── Mobile bottom tab bar ─────────────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-100 border-t border-surface-300 flex items-stretch h-16">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors ${
                  active ? 'text-brand-green-400' : 'text-zinc-500'
                }`}
              >
                <Icon size={20} />
                {label}
              </Link>
            );
          })}
        </nav>

      </div>
    </AuthGuard>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
  return `${(bytes / 1e3).toFixed(0)}KB`;
}
