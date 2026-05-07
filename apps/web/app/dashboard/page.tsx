'use client';
import Link from 'next/link';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import type { Project } from '@stemfer/shared/types';
import {
  FolderOpen, Upload, Plus, Music2, Clock,
  ArrowRight, HardDrive, TrendingUp, Send,
} from 'lucide-react';
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
    <div className="animate-fade-in">

      {/* ── Mobile header ──────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 flex items-center justify-between md:hidden">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">{greeting()}</p>
          <h1 className="text-xl font-bold text-white tracking-tight leading-none">
            {user?.name?.split(' ')[0] ?? 'Studio'} 👋
          </h1>
        </div>
        <Link
          href="/projects/new"
          className="w-9 h-9 rounded-full bg-brand-green-500 flex items-center justify-center active:bg-brand-green-600 transition-colors"
        >
          <Plus size={18} className="text-black" />
        </Link>
      </div>

      {/* ── Desktop header ─────────────────────────────────────────────── */}
      <div className="hidden md:flex items-start justify-between p-8 pb-0">
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

      <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">

        {/* ── Stats — horizontal scroll on mobile, grid on desktop ───── */}
        <div className="-mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-none">
          <div className="flex md:grid md:grid-cols-4 gap-3 w-max md:w-auto">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="w-36 md:w-auto flex-shrink-0">
                  <SkeletonStatCard />
                </div>
              ))
            ) : (
              <>
                <StatPill label="Projects" value={projects.length} icon={FolderOpen} href="/projects" />
                <StatPill label="Files" value={totalFiles} icon={Music2} />
                <StatPill label="Plan" value={user?.plan?.toUpperCase() ?? 'FREE'} icon={TrendingUp} valueClass="text-brand-green-400" />
                <StoragePill storageRatio={storageRatio} user={user} />
              </>
            )}
          </div>
        </div>

        {/* ── Quick actions (mobile only) ────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 md:hidden">
          {[
            { href: '/upload',   icon: Upload,     label: 'Upload'   },
            { href: '/transfer', icon: Send,        label: 'Transfer' },
            { href: '/projects', icon: FolderOpen,  label: 'Projects' },
          ].map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center justify-center gap-2 py-4 rounded-xl bg-surface-100 border border-surface-300 active:bg-surface-200 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-brand-green-500/10 flex items-center justify-center">
                <Icon size={18} className="text-brand-green-400" />
              </div>
              <span className="text-xs text-zinc-400">{label}</span>
            </Link>
          ))}
        </div>

        {/* ── Recent projects ────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              Recent Projects
            </h2>
            <Link href="/projects" className="text-xs text-zinc-500 hover:text-brand-green-400 flex items-center gap-1 transition-colors">
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {isLoading ? (
            <>
              {/* mobile: list skeletons */}
              <div className="md:hidden space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse" />
                ))}
              </div>
              {/* desktop: card grid skeletons */}
              <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            </>
          ) : projects.length === 0 ? (
            <EmptyProjects />
          ) : (
            <>
              {/* Mobile: list rows */}
              <div className="md:hidden space-y-2">
                {projects.slice(0, 5).map(project => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    onPress={() => qc.prefetchQuery({
                      queryKey: ['project', project.id],
                      queryFn:  () => api.get(`/projects/${project.id}`),
                      staleTime: 60_000,
                    })}
                  />
                ))}
              </div>
              {/* Desktop: card grid */}
              <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4">
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
            </>
          )}
        </div>

        {/* ── Upload banner (desktop only, bottom CTA) ───────────────── */}
        <div className="hidden md:flex items-center gap-4 p-4 rounded-xl border border-dashed border-surface-400 hover:border-brand-green-500/40 group transition-colors">
          <div className="p-3 rounded-xl bg-surface-300 group-hover:bg-brand-green-500/10 transition-colors">
            <Upload size={20} className="text-zinc-500 group-hover:text-brand-green-400 transition-colors" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Upload audio files</p>
            <p className="text-xs text-zinc-600 mt-0.5">Drag &amp; drop WAV, MP3, FLAC, AIFF or DAW project files</p>
          </div>
          <Link href="/upload" className="btn-ghost text-xs flex-shrink-0">Upload</Link>
        </div>

      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

const StatPill = memo(function StatPill({
  label, value, icon: Icon, href, valueClass,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  href?: string;
  valueClass?: string;
}) {
  const inner = (
    <div className="w-36 md:w-auto card flex items-center gap-3 flex-shrink-0">
      <div className="p-2 rounded-lg bg-brand-green-500/10 flex-shrink-0">
        <Icon size={15} className="text-brand-green-400" />
      </div>
      <div className="min-w-0">
        <p className={`text-lg font-bold leading-tight ${valueClass ?? 'text-white'}`}>{value}</p>
        <p className="text-[11px] text-zinc-500">{label}</p>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90 transition-opacity">{inner}</Link>
  ) : inner;
});

const StoragePill = memo(function StoragePill({
  storageRatio, user,
}: {
  storageRatio: number;
  user: import('@stemfer/shared/types').User | null;
}) {
  const color = storageRatio > 0.9 ? '#ef4444' : storageRatio > 0.7 ? '#f59e0b' : '#22c55e';
  return (
    <div className="w-36 md:w-auto card flex flex-col gap-2 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg bg-brand-green-500/10">
          <HardDrive size={15} className="text-brand-green-400" />
        </div>
        <span className="text-[10px] text-zinc-600">{(storageRatio * 100).toFixed(0)}%</span>
      </div>
      <div>
        <p className="text-[11px] text-zinc-500">Storage</p>
        <p className="text-sm font-bold text-white leading-tight">
          {formatBytes(user?.storage_used ?? 0)}
          <span className="text-zinc-600 font-normal text-[11px]"> / {formatBytes(user?.storage_limit_bytes ?? 1)}</span>
        </p>
      </div>
      <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${storageRatio * 100}%`, backgroundColor: color, transition: 'width 0.8s' }} />
      </div>
    </div>
  );
});

const ProjectRow = memo(function ProjectRow({
  project, onPress,
}: {
  project: Project;
  onPress?: () => void;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      onClick={onPress}
      className="flex items-center gap-3 p-3 rounded-xl bg-surface-100 border border-surface-300 active:bg-surface-200 transition-colors"
    >
      <div
        className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={{ backgroundColor: `${project.color}1a`, border: `1px solid ${project.color}44` }}
      >
        <FolderOpen size={16} style={{ color: project.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{project.name}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{project.file_count} files · {project.session_count} sessions</p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <ArrowRight size={14} className="text-zinc-600" />
        <span className="text-[10px] text-zinc-700 flex items-center gap-0.5">
          <Clock size={9} />
          {new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </Link>
  );
});

const ProjectCard = memo(function ProjectCard({
  project, onHover,
}: {
  project: Project;
  onHover?: () => void;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="card hover:border-brand-green-500/30 hover:bg-surface-200 group block transition-colors"
      onMouseEnter={onHover}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
          style={{ backgroundColor: `${project.color}1a`, border: `1px solid ${project.color}44` }}
        >
          <FolderOpen size={16} style={{ color: project.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white group-hover:text-brand-green-400 truncate text-sm transition-colors">
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
    <div className="card flex flex-col items-center py-12 text-center border-dashed">
      <div className="p-4 rounded-full bg-surface-300 mb-4">
        <FolderOpen size={24} className="text-zinc-600" />
      </div>
      <p className="text-white font-medium text-sm">No projects yet</p>
      <p className="text-zinc-600 text-xs mt-1.5 mb-5 max-w-xs">
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
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
