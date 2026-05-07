'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project } from '@stemfer/shared/types';
import { ChevronRight, Settings, Trash2, AlertTriangle } from 'lucide-react';

const COLORS = [
  '#22c55e', '#3b82f6', '#a855f7', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#f97316',
];

const SAMPLE_RATES = [44100, 48000, 88200, 96000];
const TIME_SIGS   = ['4/4', '3/4', '6/8', '5/4', '7/8'];

export default function ProjectSettingsPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const qc       = useQueryClient();

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn:  () => api.get(`/projects/${id}`),
    staleTime: 60_000,
  });

  const [form, setForm] = useState({
    name:        '',
    description: '',
    bpm:         '',
    time_sig:    '4/4',
    sample_rate: 48000,
    color:       '#22c55e',
  });
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        name:        project.name,
        description: project.description ?? '',
        bpm:         project.bpm?.toString() ?? '',
        time_sig:    project.time_sig ?? '4/4',
        sample_rate: project.sample_rate ?? 48000,
        color:       project.color ?? '#22c55e',
      });
    }
  }, [project]);

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${id}`, {
      name:        form.name.trim(),
      description: form.description.trim() || null,
      bpm:         form.bpm ? Number(form.bpm) : null,
      time_sig:    form.time_sig,
      sample_rate: form.sample_rate,
      color:       form.color,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(['project', id], updated);
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      router.replace('/projects');
    },
  });

  if (isLoading) return (
    <div className="p-8 text-zinc-500 text-sm animate-pulse">Loading…</div>
  );
  if (!project) return (
    <div className="p-8 text-zinc-500 text-sm">Project not found.</div>
  );

  const canDelete = deleteConfirm === project.name;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 py-4 border-b border-surface-300 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-zinc-600 mb-3">
          <Link href="/projects" className="hover:text-white transition-colors">Projects</Link>
          <ChevronRight size={11} />
          <Link href={`/projects/${id}`} className="hover:text-white transition-colors">{project.name}</Link>
          <ChevronRight size={11} />
          <span className="text-zinc-400">Settings</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-300">
            <Settings size={16} className="text-zinc-400" />
          </div>
          <h1 className="text-lg font-bold text-white">Project Settings</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-lg space-y-8">

          {/* General */}
          <section className="card space-y-5">
            <h2 className="text-sm font-semibold text-white">General</h2>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Project name</label>
              <input
                className="input w-full"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                maxLength={100}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Description</label>
              <textarea
                className="input w-full resize-none"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? 'white' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Audio */}
          <section className="card space-y-5">
            <h2 className="text-sm font-semibold text-white">Audio</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">BPM</label>
                <input
                  className="input w-full"
                  type="number"
                  min={1}
                  max={999}
                  placeholder="120"
                  value={form.bpm}
                  onChange={e => setForm(f => ({ ...f, bpm: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Time signature</label>
                <select
                  className="input w-full"
                  value={form.time_sig}
                  onChange={e => setForm(f => ({ ...f, time_sig: e.target.value }))}
                >
                  {TIME_SIGS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Sample rate</label>
              <select
                className="input w-full"
                value={form.sample_rate}
                onChange={e => setForm(f => ({ ...f, sample_rate: Number(e.target.value) }))}
              >
                {SAMPLE_RATES.map(r => (
                  <option key={r} value={r}>{(r / 1000).toFixed(1)} kHz</option>
                ))}
              </select>
            </div>
          </section>

          {/* Save */}
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim()}
          >
            {save.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>

          {save.isError && (
            <p className="text-xs text-red-400">{(save.error as Error).message}</p>
          )}

          {/* Danger zone */}
          {project.member_role === 'owner' && (
            <section className="border border-red-500/20 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400" />
                <h2 className="text-sm font-semibold text-red-400">Danger zone</h2>
              </div>

              <p className="text-xs text-zinc-500 leading-relaxed">
                Permanently delete <span className="text-white font-medium">{project.name}</span> and all its files and sessions. This cannot be undone.
              </p>

              <div className="space-y-2">
                <label className="text-xs text-zinc-400">
                  Type <span className="text-white font-medium">{project.name}</span> to confirm
                </label>
                <input
                  className="input w-full"
                  placeholder={project.name}
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                />
              </div>

              <button
                className="btn-ghost text-red-400 hover:bg-red-500/10 hover:border-red-500/30 gap-2"
                disabled={!canDelete || deleteProject.isPending}
                onClick={() => deleteProject.mutate()}
              >
                <Trash2 size={13} />
                {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
              </button>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
