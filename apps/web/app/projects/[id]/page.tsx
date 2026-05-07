'use client';
import { memo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project, AudioFile, Session, ActivityLog } from '@stemfer/shared/types';
import { ChunkedUploader } from '@/components/upload/ChunkedUploader';
import {
  Music2, File, Clock, Upload, GitBranch, Settings,
  Download, Trash2, Play, ChevronRight, FolderOpen,
  Plus, Activity,
} from 'lucide-react';
import { msToTimecode, formatDuration } from '@stemfer/shared/utils/timecode';
import { Skeleton, SkeletonFileRow } from '@/components/ui/Skeleton';

export default function ProjectPage() {
  const { id }        = useParams<{ id: string }>();
  const qc            = useQueryClient();
  const [tab, setTab] = useState<'files' | 'sessions' | 'activity' | 'upload'>('files');

  const { data: project, isLoading: loadingProject } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn:  () => api.get(`/projects/${id}`),
    staleTime: 60_000,
  });

  const { data: files = [], isLoading: loadingFiles } = useQuery<AudioFile[]>({
    queryKey: ['files', id],
    queryFn:  () => api.get('/files', { projectId: id }),
    staleTime: 60_000,
  });

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<Session[]>({
    queryKey: ['sessions', id],
    queryFn:  () => api.get(`/projects/${id}/sessions`),
    staleTime: 120_000,
  });

  /* Activity only fetched when tab is opened */
  const { data: activity = [] } = useQuery<ActivityLog[]>({
    queryKey: ['activity', id],
    queryFn:  () => api.get(`/projects/${id}/activity`),
    enabled:  tab === 'activity',
    staleTime: 60_000,
  });

  /* Optimistic delete */
  const deleteFile = useMutation({
    mutationFn: (fileId: string) => api.delete(`/files/${fileId}`),
    onMutate: async (fileId) => {
      await qc.cancelQueries({ queryKey: ['files', id] });
      const prev = qc.getQueryData<AudioFile[]>(['files', id]);
      qc.setQueryData<AudioFile[]>(['files', id], old => old?.filter(f => f.id !== fileId) ?? []);
      return { prev };
    },
    onError: (_err, _fileId, ctx) => {
      if (ctx?.prev) qc.setQueryData(['files', id], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['files', id] }),
  });

  const handleDelete = useCallback((fid: string) => deleteFile.mutate(fid), [deleteFile]);

  /* Loading state */
  if (loadingProject) return <ProjectSkeleton />;
  if (!project) return (
    <div className="p-8 text-zinc-500 text-sm">Project not found.</div>
  );

  const TABS = [
    { key: 'files',    label: `Files`,          badge: files.length,    icon: Music2 },
    { key: 'sessions', label: `Sessions`,        badge: sessions.length, icon: GitBranch },
    { key: 'upload',   label: 'Upload',          badge: null,            icon: Upload },
    { key: 'activity', label: 'Activity',        badge: null,            icon: Activity },
  ] as const;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-8 py-4 border-b border-surface-300 flex-shrink-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-600 mb-3">
          <Link href="/projects" className="hover:text-white transition-colors">Projects</Link>
          <ChevronRight size={11} />
          <span className="text-zinc-400">{project.name}</span>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{
              backgroundColor: `${project.color}1a`,
              border: `1px solid ${project.color}44`,
            }}
          >
            <FolderOpen size={18} style={{ color: project.color }} />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white leading-tight">{project.name}</h1>
            {project.description && (
              <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {project.bpm && (
              <span className="timecode text-xs px-2 py-0.5 rounded bg-surface-300">
                {project.bpm} BPM
              </span>
            )}
            <Link href={`/projects/${id}/timeline`} className="btn-primary text-xs">
              <Play size={13} />
              Timeline
            </Link>
            <Link href={`/projects/${id}/settings`} className="btn-ghost p-2 text-xs">
              <Settings size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 px-8 border-b border-surface-300 flex-shrink-0 bg-surface-100">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-brand-green-500 text-brand-green-400'
                : 'border-transparent text-zinc-500 hover:text-white'
            }`}
            style={{ transitionDuration: 'var(--duration-base)' }}
          >
            <t.icon size={13} />
            {t.label}
            {t.badge !== null && t.badge > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                tab === t.key
                  ? 'bg-brand-green-500/20 text-brand-green-400'
                  : 'bg-surface-300 text-zinc-500'
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-8">
        {tab === 'files' && (
          loadingFiles
            ? <div className="space-y-1">{Array.from({ length: 5 }).map((_, i) => <SkeletonFileRow key={i} />)}</div>
            : <FileList files={files} onDelete={handleDelete} projectId={id} />
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

        {tab === 'activity' && (
          <ActivityFeed logs={activity} />
        )}
      </div>
    </div>
  );
}

/* ── FileList ─────────────────────────────────────────────────────────────── */
function FileList({
  files,
  onDelete,
  projectId,
}: {
  files: AudioFile[];
  onDelete: (id: string) => void;
  projectId: string;
}) {
  if (!files.length) return (
    <div className="text-center py-16 text-zinc-500">
      <Music2 size={36} className="mx-auto mb-4 text-zinc-700" />
      <p className="text-sm font-medium text-zinc-400">No files yet</p>
      <p className="text-xs text-zinc-600 mt-1">Upload audio files from the Upload tab.</p>
    </div>
  );

  return (
    <div className="space-y-1">
      {/* Column header */}
      <div
        className="grid gap-4 px-4 py-2 text-[10px] text-zinc-600 uppercase tracking-widest font-medium"
        style={{ gridTemplateColumns: 'auto 1fr auto auto auto auto' }}
      >
        <span />
        <span>Name</span>
        <span>Duration</span>
        <span>Timecode</span>
        <span>Size</span>
        <span />
      </div>
      {files.map(f => <FileRow key={f.id} file={f} onDelete={onDelete} projectId={projectId} />)}
    </div>
  );
}

const FileRow = memo(function FileRow({
  file,
  onDelete,
  projectId,
}: {
  file: AudioFile;
  onDelete: (id: string) => void;
  projectId: string;
}) {
  const isAudio = file.file_type === 'audio';
  const isDaw   = file.file_type === 'daw_project';

  return (
    <div
      className="grid gap-4 items-center px-4 py-2.5 rounded-lg hover:bg-surface-200 group"
      style={{
        gridTemplateColumns: 'auto 1fr auto auto auto auto',
        transition: 'background-color var(--duration-fast) var(--ease-out)',
      }}
    >
      <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
        {isAudio ? <Music2 size={13} className="text-brand-green-400" /> :
         isDaw    ? <GitBranch size={13} className="text-brand-purple-400" /> :
                    <File size={13} className="text-zinc-500" />}
      </div>

      <div className="min-w-0">
        <p className="text-sm text-white truncate font-medium leading-tight">{file.original_name}</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">
          {file.processing_status === 'processing'
            ? <span className="text-amber-400">Analyzing…</span>
            : file.processing_status === 'failed'
            ? <span className="text-red-400">Failed</span>
            : `${file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)}kHz` : '?'} · ${
                file.channels === 2 ? 'Stereo' : file.channels === 1 ? 'Mono' : ''
              } · v${file.version}`}
        </p>
      </div>

      <span className="text-xs text-zinc-400 tabular-nums">
        {file.duration_ms ? formatDuration(file.duration_ms) : '—'}
      </span>

      <span className="timecode">{file.start_timecode ?? '00:00:00:000'}</span>

      <span className="text-xs text-zinc-500">{formatFileSize(file.size_bytes)}</span>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={`${process.env.NEXT_PUBLIC_API_URL}/files/${file.id}/download`}
          className="p-1.5 rounded hover:bg-surface-300 text-zinc-600 hover:text-white transition-colors"
          title="Download"
        >
          <Download size={12} />
        </a>
        <button
          onClick={() => onDelete(file.id)}
          className="p-1.5 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});

/* ── SessionList ──────────────────────────────────────────────────────────── */
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
            <div className="p-2 rounded-lg bg-brand-purple-500/10">
              <GitBranch size={15} className="text-brand-purple-400" />
            </div>
            <div>
              <p className="font-medium text-white text-sm group-hover:text-brand-green-400"
                 style={{ transition: 'color var(--duration-base) var(--ease-out)' }}>
                {s.name}
              </p>
              <p className="text-xs text-zinc-500">{s.file_count} files · {s.status}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ── ActivityFeed ─────────────────────────────────────────────────────────── */
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

/* ── Loading skeleton ─────────────────────────────────────────────────────── */
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
        {Array.from({ length: 6 }).map((_, i) => <SkeletonFileRow key={i} />)}
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function formatAction(action: string): string {
  const map: Record<string, string> = {
    file_upload:    'uploaded a file',
    file_delete:    'deleted a file',
    file_update:    'updated a file',
    project_create: 'created the project',
    project_update: 'updated project settings',
    session_create: 'created a session',
    member_add:     'added a member',
    user_login:     'signed in',
  };
  return map[action] ?? action.replace(/_/g, ' ');
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
