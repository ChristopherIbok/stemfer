'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const COLORS = ['#22c55e','#a855f7','#3b82f6','#f59e0b','#ef4444','#ec4899','#06b6d4'];
const TIME_SIGS = ['4/4','3/4','6/8','5/4','7/8','12/8'];

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', description: '', bpm: 120, time_sig: '4/4',
    sample_rate: 48000, color: COLORS[0],
  });
  const [error, setError] = useState('');

  const update = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/projects', form),
    onSuccess: (data) => router.push(`/projects/${data.id}`),
    onError: (err: any) => setError(err.message),
  });

  return (
    <div className="p-8 max-w-lg mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-xl font-bold text-white">New Project</h1>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); create.mutate(); }}
          className="card space-y-5"
        >
          <div>
            <label className="label">Project Name *</label>
            <input value={form.name} onChange={e => update('name', e.target.value)} className="input" placeholder="My Album Session" required />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} className="input min-h-[80px] resize-none" placeholder="Optional project description…" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">BPM</label>
              <input type="number" value={form.bpm} onChange={e => update('bpm', parseInt(e.target.value))} className="input" min={20} max={400} />
            </div>
            <div>
              <label className="label">Time Signature</label>
              <select value={form.time_sig} onChange={e => update('time_sig', e.target.value)} className="input">
                {TIME_SIGS.map(ts => <option key={ts}>{ts}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Sample Rate</label>
            <select value={form.sample_rate} onChange={e => update('sample_rate', parseInt(e.target.value))} className="input">
              <option value={44100}>44.1 kHz</option>
              <option value={48000}>48 kHz</option>
              <option value={88200}>88.2 kHz</option>
              <option value={96000}>96 kHz</option>
            </select>
          </div>

          <div>
            <label className="label">Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => update('color', c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${form.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={create.isPending} className="btn-primary w-full justify-center">
            {create.isPending ? 'Creating…' : 'Create Project'}
          </button>
        </form>
    </div>
  );
}
