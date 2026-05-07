'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import type { Project } from '@stemfer/shared/types';
import { FolderOpen, Upload, Plus, Music2, Clock, ArrowRight, HardDrive, TrendingUp } from 'lucide-react';
import { SkeletonCard, SkeletonStatCard } from '@/components/ui/Skeleton';
import { memo, useMemo } from 'react';

export default function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const qc   = useQueryClient();

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn:  () => api.get('/projects'),
    staleTime: 60_000,
  });

  const totalFiles = useMemo(
    () => projects.reduce((a, p) => a + p.file_count, 0),
    [projects]
  );

  const storageRatio = user
    ? Math.min(1, user.storage_used / user.storage_limit_bytes)
    : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Good {greeting()}, {user?.name?.split(' ')[0]}.
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Here&apos;s what&apos;s happening in your studio.</p>
        </div>
        <Link href="/projects/new" className="btn-primary flex-shrink-0">
          <Plus size={15} />
          New Project
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard
              label="Projects"
              value={projects.length}
              icon={FolderOpen}
              href="/projects"
            />
            <StatCard
              label="Total Files"
              value={totalFiles}
              icon={Music2}
            />
            <StatCard
              label="Plan"
              value={user?.plan?.toUpperCase() ?? 'FREE'}
              icon={TrendingUp}
              valueClass="text-brand-green-400"
            />
            <div className="card flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-brand-green-500/10">
                  <HardDrive size={16} className="text-brand-green-400" />
                </div>
                <span className="text-[10px] text-zinc-600">
                  {(storageRatio * 100).toFixed(0)}% used
                </span>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Storage</p>
                <p className="text-sm font-semibold text-white mt-0.5">
                  {formatBytes(user?.storage_used ?? 0)}
                  <span className="text-zinc-600 font-normal text-xs"> / {formatBytes(user?.storage_limit_bytes ?? 1)}</span>
                </p>
              </div>
              <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${storageRatio * 100}%`,
                    backgroundColor: storageRatio > 0.9 ? '#ef4444' : storageRatio > 0.7 ? '#f59e0b' : '#22c55e',
                    transition: 'width 0.8s var(--ease-out)',
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white tracking-wide uppercase text-zinc-400" style={{ letterSpacing: '0.08em' }}>
            Recent Projects
          </h2>
          <Link
            href="/projects"
            className="text-xs text-zinc-500 hover:text-brand-green-400 flex items-center gap-1"
            style={{ transition: 'color var(--duration-base) var(--ease-out)' }}
          >
            View all <ArrowRight size={11} />
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.slice(0, 6).map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onHover={() => qc.prefetchQuery({
                  queryKey: ['project', project.id],
                  queryFn:  () => api.get(`/projects/${project.id}`),
                  staleTime: 60_000,
                })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick upload shortcut */}
      <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-surface-400 hover:border-brand-green-500/40 group"
           style={{ transition: 'border-color var(--duration-base) var(--ease-out)' }}>
        <div className="p-3 rounded-xl bg-surface-300 group-hover:bg-brand-green-500/10"
             style={{ transition: 'background-color var(--duration-base) var(--ease-out)' }}>
          <Upload size={20} className="text-zinc-500 group-hover:text-brand-green-400"
                  style={{ transition: 'color var(--duration-base) var(--ease-out)' }} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Upload audio files</p>
          <p className="text-xs text-zinc-600 mt-0.5">Drag & drop WAV, MP3, FLAC, AIFF or DAW project files</p>
        </div>
        <Link href="/upload" className="btn-ghost text-xs flex-shrink-0">
          Upload
        </Link>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

const StatCard = memo(function StatCard({
  label, value, icon: Icon, href, valueClass,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  href?: string;
  valueClass?: string;
}) {
  const inner = (
    <div className="card flex items-center gap-3 group">
      <div className="p-2 rounded-lg bg-brand-green-500/10 flex-shrink-0">
        <Icon size={16} className="text-brand-green-400" />
      </div>
      <div className="min-w-0">
        <p className={`text-xl font-bold leading-tight ${valueClass ?? 'text-white'}`}>{value}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block hover:opacity-90"
          style={{ transition: 'opacity var(--duration-base) var(--ease-out)' }}>
      {inner}
    </Link>
  ) : inner;
});

const ProjectCard = memo(function ProjectCard({
  project,
  onHover,
}: {
  project: Project;
  onHover?: () => void;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="card hover:border-brand-green-500/30 hover:bg-surface-200 group block"
      onMouseEnter={onHover}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
          style={{
            backgroundColor: `${project.color}1a`,
            border: `1px solid ${project.color}44`,
          }}
        >
          <FolderOpen size={16} style={{ color: project.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white group-hover:text-brand-green-400 truncate text-sm"
              style={{ transition: 'color var(--duration-base) var(--ease-out)' }}>
            {project.name}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {project.file_count} files · {project.session_count} sessions
          </p>
        </div>
      </div>
      {project.description && (
        <p className="text-xs text-zinc-600 mt-2.5 line-clamp-2 leading-relaxed">{project.description}</p>
      )}
      <div className="flex items-center gap-1 mt-3 text-[10px] text-zinc-700">
        <Clock size={9} />
        {new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </div>
    </Link>
  );
});

function EmptyProjects() {
  return (
    <div className="card flex flex-col items-center py-16 text-center border-dashed">
      <div className="p-4 rounded-full bg-surface-300 mb-4">
        <FolderOpen size={26} className="text-zinc-600" />
      </div>
      <p className="text-white font-medium text-sm">No projects yet</p>
      <p className="text-zinc-600 text-xs mt-1.5 mb-6 max-w-xs">
        Create your first project to start organizing and sharing audio files.
      </p>
      <Link href="/projects/new" className="btn-primary text-sm">
        <Plus size={14} />
        Create Project
      </Link>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
