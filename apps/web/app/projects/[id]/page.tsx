'use client';
import { memo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project, Session, ActivityLog } from '@stemfer/shared/types';
import { ChunkedUploader } from '@/components/upload/ChunkedUploader';
import { FolderBrowser } from '@/components/files/FolderBrowser';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  Music2, Clock, Upload, GitBranch, Settings,
  Play, ChevronRight, FolderOpen, Plus, Activity, Trash2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

export default function ProjectPage() {
  const { id }     = useParams<{ id: string }>();
  const router     = useRouter();
  const qc         = useQueryClient();
  const [tab, setTab] = useState<'files' | 'sessions' | 'activity' | 'upload'>('files');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: project, isLoading: loadingProject } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn:  () => api.get(`/projects/${id}`),
    staleTime: 60_000,
  });

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<Session[]>({
    queryKey: ['sessions', id],
    queryFn:  () => api.get(`/projects/${id}/sessions`),
    staleTime: 120_000,
  });

  const { data: activity = [] } = useQuery<ActivityLog[]>({
    queryKey: ['activity', id],
    queryFn:  () => api.get(`/projects/${id}/activity`),
    enabled:  tab === 'activity',
    staleTime: 60_000,
  });

  const deleteProject = useMutation({
    mutationFn: () => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      router.push('/projects');
    },
  });

  if (loadingProject) return <ProjectSkeleton />;
  if (!project) return <div className="p-8 text-zinc-500 text-sm">Project not found.</div>;

  const isOwner = project.member_role === 'owner';

  const TABS = [
    { key: 'files',    label: 'Files',    icon: Music2 },
    { key: 'sessions', label: 'Sessions', icon: GitBranch },
    { key: 'upload',   label: 'Upload',   icon: Upload },
    { key: 'activity', label: 'Activity', icon: Activity },
  ] as const;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 py-4 border-b border-surface-300 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-zinc-600 mb-3">
          <Link href="/projects" className="hover:text-white transition-colors">Projects</Link>
          <ChevronRight size={11} />
          <span className="text-zinc-400">{project.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: `${project.color}1a`, border: `1px solid ${project.color}44` }}
          >
            <FolderOpen size={18} style={{ color: project.color }} />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-base md:text-lg font-bold text-white leading-tight truncate">{project.name}</h1>
            {project.description && (
              <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {project.bpm && (
              <span className="hidden sm:block timecode text-xs px-2 py-0.5 rounded bg-surface-300">
                {project.bpm} BPM
              </span>
            )}
            <Link href={`/projects/${id}/timeline`} className="btn-primary text-xs px-3 py-1.5">
              <Play size={12} />
              <span className="hidden sm:inline">Timeline</span>
            </Link>
            <Link href={`/projects/${id}/settings`} className="btn-ghost p-2">
              <Settings size={14} />
            </Link>
            {isOwner && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-2 rounded-lg border border-surface-300 text-zinc-600 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/8 transition-colors"
                title="Delete project"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 md:px-8 border-b border-surface-300 flex-shrink-0 bg-surface-100 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors flex-shrink-0 ${
              tab === t.key
                ? 'border-brand-green-500 text-brand-green-400'
                : 'border-transparent text-zinc-500 hover:text-white'
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4 md:p-8">
        {tab === 'files' && (
          <FolderBrowser projectId={id} memberRole={project.member_role} />
        )}

        {tab === 'sessions' && (
          loadingSessions
            ? <div className="grid grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            : <SessionList sessions={sessions} projectId={id} />
        )}

        {tab === 'upload' && (
          <div className="max-w-xl">
            <ChunkedUploader
              projectId={id}
              onUploadComplete={() => qc.invalidateQueries({ queryKey: ['files', id] })}
            />
          </div>
        )}

        {tab === 'activity' && <ActivityFeed logs={activity} />}
      </div>

      {/* ── Delete project confirm ───────────────────────────────────────── */}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete "${project.name}"?`}
        description="All files, sessions, and activity logs will be permanently deleted. This cannot be undone."
        confirmLabel="Delete project"
        danger
        loading={deleteProject.isPending}
        onConfirm={() => deleteProject.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/* ── SessionList ─────────────────────────────────────────────────────────── */
function SessionList({ sessions, projectId }: { sessions: Session[]; projectId: string }) {
  if (!sessions.length) return (
    <div className="text-center py-16 text-zinc-500">
      <GitBranch size={36} className="mx-auto mb-4 text-zinc-700" />
      <p className="text-sm font-medium text-zinc-400">No sessions yet</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {sessions.map(s => (
        <Link
          key={s.id}
          href={`/projects/${projectId}/sessions/${s.id}`}
          className="card hover:border-brand-green-500/30 group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <GitBranch size={15} className="text-purple-400" />
            </div>
            <div>
              <p className="font-medium text-white text-sm group-hover:text-brand-green-400 transition-colors">{s.name}</p>
              <p className="text-xs text-zinc-500">{s.file_count} files · {s.status}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ── ActivityFeed ────────────────────────────────────────────────────────── */
function ActivityFeed({ logs }: { logs: ActivityLog[] }) {
  if (!logs.length) return (
    <div className="text-center py-16 text-zinc-500">
      <Activity size={36} className="mx-auto mb-4 text-zinc-700" />
      <p className="text-sm font-medium text-zinc-400">No activity yet</p>
    </div>
  );

  return (
    <div className="space-y-1 max-w-xl">
      {logs.map((log, i) => (
        <div key={log.id} className={`flex items-start gap-3 py-2.5 ${i < logs.length - 1 ? 'border-b border-surface-300/50' : ''}`}>
          <div className="w-6 h-6 rounded-full bg-surface-300 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-[10px] text-zinc-400 font-medium">{log.user_name?.[0]?.toUpperCase() ?? '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white leading-snug">
              <span className="font-medium">{log.user_name ?? 'System'}</span>
              {' '}<span className="text-zinc-400">{formatAction(log.action)}</span>
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Loading skeleton ────────────────────────────────────────────────────── */
function ProjectSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-4 border-b border-surface-300 space-y-3">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 px-8 py-1 border-b border-surface-300 bg-surface-100">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 mx-1 rounded" />)}
      </div>
      <div className="flex-1 overflow-auto p-8 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatAction(action: string): string {
  const map: Record<string, string> = {
    file_upload:    'uploaded a file',
    file_delete:    'deleted a file',
    file_update:    'updated a file',
    folder_create:  'created a folder',
    folder_delete:  'deleted a folder',
    folder_update:  'renamed a folder',
    project_create: 'created the project',
    project_update: 'updated project settings',
    project_delete: 'deleted the project',
    session_create: 'created a session',
    member_add:     'added a member',
    user_login:     'signed in',
  };
  return map[action] ?? action.replace(/_/g, ' ');
}
