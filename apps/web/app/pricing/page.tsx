import Link   from 'next/link';
import { Check, Zap } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple, transparent pricing for music producers and studios.',
};

const PLANS = [
  {
    name:     'Free',
    price:    '$0',
    period:   'forever',
    storage:  '5 GB',
    projects: '3',
    features: [
      '5 GB cloud storage',
      'Unlimited file size',
      '3 projects',
      'Timeline editor',
      'File transfer',
      'Email delivery',
    ],
    cta:     'Get started free',
    href:    '/auth/register',
    popular: false,
  },
  {
    name:     'Pro',
    price:    '$19',
    period:   'per month',
    storage:  '100 GB',
    projects: '50',
    features: [
      '100 GB cloud storage',
      'Unlimited file size',
      '50 projects',
      'Timeline editor',
      'File transfer',
      'Priority email delivery',
      'Real-time collaboration',
      'BWF timecode sync',
    ],
    cta:     'Start Pro',
    href:    '/auth/register?plan=pro',
    popular: true,
  },
  {
    name:     'Studio',
    price:    '$79',
    period:   'per month',
    storage:  '500 GB',
    projects: 'Unlimited',
    features: [
      '500 GB cloud storage',
      'Unlimited file size',
      'Unlimited projects',
      'Timeline editor',
      'File transfer',
      'Priority email delivery',
      'Real-time collaboration',
      'BWF timecode sync',
      'Stem extraction',
      'Admin dashboard',
    ],
    cta:     'Start Studio',
    href:    '/auth/register?plan=studio',
    popular: false,
  },
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-surface-300 bg-surface/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-brand-green-400 tracking-tight">Stemfer</Link>
          <div className="flex items-center gap-4">
            <Link href="/auth/login"    className="text-sm text-zinc-400 hover:text-white transition-colors">Sign in</Link>
            <Link href="/auth/register" className="btn-primary text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      <div className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-green-500/10 border border-brand-green-500/30 text-brand-green-400 text-xs mb-6">
              <Zap size={12} />
              Simple, transparent pricing
            </div>
            <h1 className="text-5xl font-bold text-white leading-tight mb-4">
              The right plan for<br />
              <span className="text-brand-green-400">every studio</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto">
              Start free. Upgrade as your projects grow. Cancel any time.
            </p>
          </div>

          {/* Plans */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className={`card relative flex flex-col ${
                  plan.popular
                    ? 'border-brand-green-500 shadow-[0_0_40px_rgba(34,197,94,0.08)]'
                    : ''
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-brand-green-500 text-black text-xs font-bold whitespace-nowrap">
                    Most Popular
                  </div>
                )}

                <div className="mb-6">
                  <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-zinc-500 text-sm mb-1">{plan.period}</span>
                  </div>
                </div>

                <ul className="space-y-2.5 flex-1 mb-8">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-400">
                      <Check size={14} className="text-brand-green-400 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={plan.popular ? 'btn-primary justify-center' : 'btn-ghost justify-center'}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          {/* FAQ row */}
          <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            {[
              { q: 'Can I switch plans?',    a: 'Yes. Upgrade or downgrade any time — changes take effect immediately.' },
              { q: 'What payment methods?',  a: 'We accept all major cards via Stripe. No crypto, no surprises.' },
              { q: 'What happens at expiry?', a: 'Files from transfers expire after 14 days regardless of plan. Project files are kept as long as you have storage.' },
            ].map(({ q, a }) => (
              <div key={q} className="p-5 rounded-xl border border-surface-300 bg-surface-100 text-left">
                <p className="text-sm font-semibold text-white mb-2">{q}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
