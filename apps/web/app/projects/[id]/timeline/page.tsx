'use client';
import { useEffect, useState, lazy, Suspense, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useTimelineStore } from '@/store/useTimelineStore';
import type { AudioFile, Project } from '@stemfer/shared/types';
import { timecodeToMs } from '@stemfer/shared/utils/timecode';
import { Download, ArrowLeft, Mic, Music2, Save } from 'lucide-react';
import Link from 'next/link';
import { SkeletonTimeline } from '@/components/ui/Skeleton';

const TimelineEngine    = lazy(() => import('@/components/timeline/TimelineEngine').then(m => ({ default: m.TimelineEngine })));
const WebStudioRecorder = lazy(() => import('@/components/recorder/WebStudioRecorder').then(m => ({ default: m.WebStudioRecorder })));

export default function TimelinePage() {
  const { id }      = useParams<{ id: string }>();
  const qc          = useQueryClient();
  const setClips    = useTimelineStore(s => s.setClips);
  const clips       = useTimelineStore(s => s.clips);
  const setBpm      = useTimelineStore(s => s.setBpm);
  const setPlaying  = useTimelineStore(s => s.setPlaying);
  const isPlaying   = useTimelineStore(s => s.isPlaying);
  const setPlayhead = useTimelineStore(s => s.setPlayhead);

  const [showRecorder, setShowRecorder] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: project } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn:  () => api.get(`/projects/${id}`),
    staleTime: 60_000,
  });

  const { data: files = [] } = useQuery<AudioFile[]>({
    queryKey: ['files', id],
    queryFn:  () => api.get('/files', { projectId: id }),
    staleTime: 60_000,
  });

  /* Hydrate timeline clips from file data */
  useEffect(() => {
    if (!files.length) return;
    setClips(
      files.filter(f => f.file_type === 'audio').map((f, i) => ({
        fileId:        f.id,
        track:         f.timeline_track ?? i,
        offsetMs:      f.offset_ms ?? timecodeToMs(f.start_timecode ?? '00:00:00:000'),
        durationMs:    f.duration_ms ?? 0,
        startTimecode: f.start_timecode ?? '00:00:00:000',
        label:         f.original_name,
        waveformData:  f.waveform_data ?? [],
        isLocked:      !!f.is_locked,
        isMuted:       !!f.is_muted,
        groupId:       f.group_id ?? undefined,
      }))
    );
  }, [files, setClips]);

  useEffect(() => {
    if (project?.bpm) setBpm(project.bpm);
  }, [project, setBpm]);

  /* Save positions — debounced by the caller */
  const savePositions = useMutation({
    mutationFn: async () => {
      await Promise.all(
        clips.map(c =>
          api.patch(`/files/${c.fileId}`, {
            offset_ms:      c.offsetMs,
            start_timecode: c.startTimecode,
            timeline_track: c.track,
            is_locked:      c.isLocked ? 1 : 0,
            is_muted:       c.isMuted  ? 1 : 0,
          })
        )
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', id] }),
  });

  const triggerSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => savePositions.mutate(), 1500);
  }, [savePositions]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setPlaying(!isPlaying);
          break;
        case 'Home':
          e.preventDefault();
          setPlayhead(0);
          setPlaying(false);
          break;
        case 'KeyS':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            savePositions.mutate();
          }
          break;
        case 'KeyR':
          if (!e.metaKey && !e.ctrlKey) setShowRecorder(s => !s);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, setPlaying, setPlayhead, savePositions]);

  const exportStems = async () => {
    const res = await api.post<{ url: string }>('/files/export', {
      projectId: id,
      clips: clips.map(c => ({ fileId: c.fileId, offsetMs: c.offsetMs, track: c.track })),
    });
    window.open(res.url, '_blank');
  };

  return (
    <div className="flex flex-col h-screen bg-surface">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-surface-300 flex-shrink-0 bg-surface-100">
        <Link
          href={`/projects/${id}`}
          className="p-1.5 rounded hover:bg-surface-300 text-zinc-500 hover:text-white flex-shrink-0"
          style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
        >
          <ArrowLeft size={15} />
        </Link>

        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-semibold text-white flex items-center gap-1.5 leading-tight">
            <Music2 size={12} className="text-brand-green-400 flex-shrink-0" />
            <span className="truncate">{project?.name ?? '…'}</span>
            <span className="text-zinc-600">— Timeline</span>
          </h1>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {clips.length} track{clips.length !== 1 ? 's' : ''} · Space to play · ⌘S to save
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setShowRecorder(s => !s)}
            className={`btn-ghost text-xs px-3 ${showRecorder ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/15' : ''}`}
          >
            <Mic size={12} />
            Record
          </button>
          <button
            onClick={() => savePositions.mutate()}
            disabled={savePositions.isPending}
            className="btn-ghost text-xs px-3"
          >
            <Save size={12} />
            {savePositions.isPending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={exportStems} className="btn-primary text-xs px-3">
            <Download size={12} />
            Export
          </button>
        </div>
      </div>

      {/* ── Recorder panel ──────────────────────────────────────────── */}
      {showRecorder && (
        <div className="border-b border-surface-300 bg-surface-100 flex-shrink-0 overflow-hidden">
          <Suspense fallback={<div className="h-36 animate-pulse rounded" />}>
            <WebStudioRecorder
              projectId={id}
              bpm={project?.bpm ?? 120}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['files', id] });
                setShowRecorder(false);
              }}
            />
          </Suspense>
        </div>
      )}

      {/* ── Timeline ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<SkeletonTimeline tracks={clips.length || 4} />}>
          <TimelineEngine />
        </Suspense>
      </div>
    </div>
  );
}
