import Link from 'next/link';
import { ArrowRight, Zap, Cloud, GitBranch, Music2, Users } from 'lucide-react';
import NavBar from '@/components/ui/NavBar';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface">
      <NavBar />

      {/* Hero */}
      <section className="pt-40 pb-24 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-green-500/10 border border-brand-green-500/30 text-brand-green-400 text-xs mb-8">
            <Zap size={12} />
            Now in public beta — built for producers
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            The cloud studio<br />
            <span className="text-brand-green-400">built for audio.</span>
          </h1>
          <p className="text-base sm:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto">
            Transfer large audio files, manage DAW projects, synchronize stems with sample-accurate timecode, and collaborate in real time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/auth/register" className="btn-primary text-base px-6 py-3">
              Start for free
              <ArrowRight size={18} />
            </Link>
            <Link href="/demo" className="btn-ghost text-base px-6 py-3">
              Watch demo
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-t border-surface-300">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-16">
            Everything a modern studio needs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Cloud, title: 'File Transfer Engine', desc: 'Chunked uploads with resume support. Send 100GB sessions without timeouts.' },
              { icon: Music2, title: 'Timeline Engine', desc: 'Sample-accurate timecode sync. Drag, snap, and align stems across tracks.' },
              { icon: GitBranch, title: 'Stem Engine', desc: 'Extract stems and metadata from Logic, Ableton, Studio One projects automatically.' },
              { icon: Zap, title: 'BWF Timecode', desc: 'Auto-reads embedded Broadcast WAV timecode metadata for zero-effort alignment.' },
              { icon: Users, title: 'Real-Time Collaboration', desc: 'Presence indicators, live activity feeds, and in-project chat.' },
              { icon: Music2, title: 'Web Recorder', desc: 'Record directly in the browser with BPM-locked metronome and live waveform.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="card hover:border-brand-green-500/40 transition-colors group">
                <div className="p-2 w-10 h-10 rounded-lg bg-brand-green-500/10 flex items-center justify-center mb-4 group-hover:bg-brand-green-500/20 transition-colors">
                  <Icon size={20} className="text-brand-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-20 px-6 border-t border-surface-300">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Simple, transparent pricing</h2>
          <p className="text-zinc-400 mb-12">Start free. Upgrade when you need more.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'Free',   price: '$0',  storage: '5 GB',   projects: 3 },
              { name: 'Pro',    price: '$19', storage: '100 GB', projects: 50, popular: true },
              { name: 'Studio', price: '$79', storage: '500 GB', projects: '∞' },
            ].map(plan => (
              <div key={plan.name} className={`card relative flex flex-col ${plan.popular ? 'border-brand-green-500' : ''}`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-brand-green-500 text-black text-xs font-bold">
                    Most Popular
                  </div>
                )}
                <h3 className="font-bold text-white text-lg">{plan.name}</h3>
                <div className="text-3xl font-bold text-white my-3">
                  {plan.price}<span className="text-sm text-zinc-500 font-normal">/mo</span>
                </div>
                <ul className="text-sm text-zinc-400 space-y-2 flex-1 mb-6">
                  <li>{plan.storage} storage</li>
                  <li>Unlimited file size</li>
                  <li>{plan.projects} projects</li>
                </ul>
                <Link
                  href={`/auth/register?plan=${plan.name.toLowerCase()}`}
                  className={plan.popular ? 'btn-primary justify-center' : 'btn-ghost justify-center'}
                >
                  Get {plan.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-300 py-12 px-6 text-center text-zinc-600 text-sm">
        <div className="text-brand-green-400 font-bold mb-2">Stemfer</div>
        <p>Built for music producers, studios, and engineers.</p>
      </footer>
    </div>
  );
}
