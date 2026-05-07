'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project } from '@stemfer/shared/types';
import { Plus, FolderOpen, Music2, Clock, Search } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { memo, useState, useMemo } from 'react';

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn:  () => api.get('/projects'),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white tracking-tight">Projects</h1>
        <Link href="/projects/new" className="btn-primary">
          <Plus size={15} />
          New Project
        </Link>
      </div>

      {/* Search */}
      {!isLoading && projects.length > 4 && (
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            type="text"
            placeholder="Search projects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-8 text-sm h-9 py-0"
          />
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 && search ? (
        <div className="card py-16 text-center border-dashed">
          <Search size={32} className="mx-auto mb-3 text-zinc-700" />
          <p className="text-zinc-400 font-medium text-sm">No results for &ldquo;{search}&rdquo;</p>
          <button
            onClick={() => setSearch('')}
            className="text-xs text-brand-green-400 mt-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="card py-24 text-center border-dashed">
          <FolderOpen size={44} className="mx-auto mb-4 text-zinc-700" />
          <h2 className="text-base font-semibold text-white mb-2">No projects yet</h2>
          <p className="text-zinc-500 text-sm mb-6">Create your first project to start working with audio files.</p>
          <Link href="/projects/new" className="btn-primary inline-flex">
            <Plus size={15} /> Create Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onHover={() => qc.prefetchQuery({
                queryKey: ['project', p.id],
                queryFn:  () => api.get(`/projects/${p.id}`),
                staleTime: 60_000,
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const ProjectCard = memo(function ProjectCard({
  project: p,
  onHover,
}: {
  project: Project;
  onHover?: () => void;
}) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="card hover:border-brand-green-500/30 hover:bg-surface-200 group block"
      onMouseEnter={onHover}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
          style={{
            backgroundColor: `${p.color}1a`,
            border: `1px solid ${p.color}44`,
          }}
        >
          <FolderOpen size={16} style={{ color: p.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate group-hover:text-brand-green-400 text-sm"
              style={{ transition: 'color var(--duration-base) var(--ease-out)' }}>
            {p.name}
          </h3>
          <p className="text-xs text-zinc-500 capitalize mt-0.5">{p.member_role}</p>
        </div>
      </div>

      {p.description && (
        <p className="text-xs text-zinc-500 mb-3 line-clamp-2 leading-relaxed">{p.description}</p>
      )}

      <div className="flex items-center justify-between text-[11px] text-zinc-600 mt-auto">
        <span className="flex items-center gap-1">
          <Music2 size={10} />
          {p.file_count} {p.file_count === 1 ? 'file' : 'files'}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </Link>
  );
});
