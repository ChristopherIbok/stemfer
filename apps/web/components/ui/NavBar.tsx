'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-surface-300 bg-surface/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-green-400 tracking-tight">Stemfer</span>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-4">
          <Link href="/transfer" className="text-sm text-zinc-400 hover:text-white transition-colors">Transfer</Link>
          <Link href="/projects" className="text-sm text-zinc-400 hover:text-white transition-colors">Timeline</Link>
          <Link href="/pricing" className="text-sm text-zinc-400 hover:text-white transition-colors">Pricing</Link>
          <Link href="/auth/login" className="text-sm text-zinc-400 hover:text-white transition-colors">Sign in</Link>
          <Link href="/auth/register" className="btn-primary">Get Started</Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-zinc-400 hover:text-white transition-colors"
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t border-surface-300 bg-surface px-6 py-4 flex flex-col gap-4">
          <Link href="/transfer" className="text-sm text-zinc-400 hover:text-white transition-colors" onClick={() => setOpen(false)}>Transfer</Link>
          <Link href="/projects" className="text-sm text-zinc-400 hover:text-white transition-colors" onClick={() => setOpen(false)}>Timeline</Link>
          <Link href="/pricing" className="text-sm text-zinc-400 hover:text-white transition-colors" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/auth/login" className="text-sm text-zinc-400 hover:text-white transition-colors" onClick={() => setOpen(false)}>Sign in</Link>
          <Link href="/auth/register" className="btn-primary justify-center" onClick={() => setOpen(false)}>Get Started</Link>
        </div>
      )}
    </nav>
  );
}
