import { clsx } from 'clsx';

/* Base shimmer block ─────────────────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx('animate-pulse rounded-md', className)}
      aria-hidden="true"
    />
  );
}

/* Project card skeleton ─────────────────────────────────────────────────── */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx('card space-y-3 pointer-events-none', className)} aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/5" />
      </div>
    </div>
  );
}

/* Stat card skeleton ────────────────────────────────────────────────────── */
export function SkeletonStatCard() {
  return (
    <div className="card flex items-center gap-4 pointer-events-none" aria-hidden="true">
      <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/* File row skeleton ─────────────────────────────────────────────────────── */
export function SkeletonFileRow() {
  return (
    <div
      className="grid gap-4 items-center px-4 py-3 pointer-events-none"
      style={{ gridTemplateColumns: 'auto 1fr auto auto auto auto' }}
      aria-hidden="true"
    >
      <Skeleton className="w-8 h-8 rounded-lg" />
      <div className="space-y-1.5 min-w-0">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-10" />
      <Skeleton className="w-8 h-8 rounded" />
    </div>
  );
}

/* Timeline toolbar + tracks skeleton ───────────────────────────────────── */
export function SkeletonTimeline({ tracks = 4 }: { tracks?: number }) {
  return (
    <div className="flex flex-col flex-1 bg-surface overflow-hidden" aria-hidden="true">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-300 bg-surface-100 flex-shrink-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-8 rounded" />
        ))}
        <Skeleton className="h-7 w-20 rounded mx-1" />
        <div className="h-5 w-px bg-surface-300 mx-1" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i + 10} className="h-7 w-8 rounded" />
        ))}
        <Skeleton className="h-7 w-16 ml-auto rounded" />
      </div>

      {/* Track area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Labels */}
        <div className="w-[180px] flex-shrink-0 border-r border-surface-300 flex flex-col">
          <div className="h-8 border-b border-surface-300 px-3 flex items-center">
            <Skeleton className="h-3 w-10" />
          </div>
          {Array.from({ length: tracks }).map((_, i) => (
            <div key={i} className="h-[72px] border-b border-surface-300/50 flex items-center gap-2 px-3">
              <Skeleton className="w-4 h-4 rounded flex-shrink-0" />
              <Skeleton className="h-3 flex-1 rounded" />
            </div>
          ))}
        </div>

        {/* Clips area */}
        <div className="flex-1 relative overflow-hidden">
          {/* Ruler */}
          <div className="h-8 border-b border-surface-300 flex items-center px-4 gap-12">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-12 rounded" />
            ))}
          </div>
          {Array.from({ length: tracks }).map((_, i) => (
            <div key={i} className="h-[72px] border-b border-surface-300/40 flex items-end gap-3 px-4 pb-2">
              {i % 2 === 0 && <Skeleton className="h-11 w-56 rounded" />}
              {i % 3 !== 2 && <Skeleton className={`h-11 rounded ${i === 1 ? 'w-40 ml-32' : 'w-64 ml-8'}`} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Dashboard header skeleton ─────────────────────────────────────────────── */
export function SkeletonDashboardHeader() {
  return (
    <div className="flex items-center justify-between" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-44" />
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  );
}
