'use client';
import { useEffect, useState, lazy, Suspense, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useUploadStore } from '@/store/useUploadStore';
import type { AudioFile, Project } from '@stemfer/shared/types';
import { timecodeToMs, msToTimecode } from '@stemfer/shared/utils/timecode';
import { ArrowLeft, Mic, Music2 } from 'lucide-react';
import Link from 'next/link';
import { SkeletonTimeline } from '@/components/ui/Skeleton';
import { TransportBar } from '@/components/timeline/TransportBar';
import { MixerPanel }   from '@/components/timeline/MixerPanel';
import { useAudioEngine } from '@/lib/audio/useAudioEngine';
import { useDAWShortcuts } from '@/lib/audio/useDAWShortcuts';
import type { TimelineFileDrop } from '@/components/timeline/TimelineEngine';

const TimelineEngine    = lazy(() => import('@/components/timeline/TimelineEngine').then(m => ({ default: m.TimelineEngine })));
const WebStudioRecorder = lazy(() => import('@/components/recorder/WebStudioRecorder').then(m => ({ default: m.WebStudioRecorder })));

export default function TimelinePage() {
  const { id }      = useParams<{ id: string }>();
  const qc          = useQueryClient();
  const setClips    = useTimelineStore(s => s.setClips);
  const clips       = useTimelineStore(s => s.clips);
  const setBpm      = useTimelineStore(s => s.setBpm);
  const setTimeSig  = useTimelineStore(s => s.setTimeSig);
  const isPlaying   = useTimelineStore(s => s.isPlaying);
  const setPlaying  = useTimelineStore(s => s.setPlaying);
  const setRecording= useTimelineStore(s => s.setRecording);
  const isRecording = useTimelineStore(s => s.isRecording);
  const playheadMs  = useTimelineStore(s => s.playheadMs);
  const showMixer   = useTimelineStore(s => s.showMixer);
  const splitClipFn = useTimelineStore(s => s.splitClip);
  const pushHistory = useTimelineStore(s => s.pushHistory);
  const selectedIds = useTimelineStore(s => s.selectedClipIds);

  const [showRecorder, setShowRecorder] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Data fetching ─────────────────────────────────────────────── */
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

  /* ── Hydrate clips ─────────────────────────────────────────────── */
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
    if (project?.bpm)      setBpm(project.bpm);
    if (project?.time_sig) setTimeSig(project.time_sig);
  }, [project, setBpm, setTimeSig]);

  /* ── Build file URL map for audio engine ───────────────────────── */
  const fileUrls = useMemo(() => {
    const map = new Map<string, string>();
    files.filter(f => f.file_type === 'audio').forEach(f => map.set(f.id, f.file_url));
    return map;
  }, [files]);

  /* ── Audio engine ──────────────────────────────────────────────── */
  const { engine } = useAudioEngine(fileUrls);

  /* ── Save ──────────────────────────────────────────────────────── */
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

  /* ── Split at playhead ─────────────────────────────────────────── */
  const handleSplitAtPlayhead = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      /* Split all clips at playhead */
      clips.forEach(c => {
        if (playheadMs > c.offsetMs && playheadMs < c.offsetMs + c.durationMs) {
          pushHistory();
          splitClipFn(c.fileId, playheadMs);
        }
      });
    } else {
      ids.forEach(fileId => {
        const c = clips.find(x => x.fileId === fileId);
        if (c && playheadMs > c.offsetMs && playheadMs < c.offsetMs + c.durationMs) {
          pushHistory();
          splitClipFn(fileId, playheadMs);
        }
      });
    }
  }, [clips, selectedIds, playheadMs, splitClipFn, pushHistory]);

  /* ── Record toggle ─────────────────────────────────────────────── */
  const handleRecord = useCallback(() => {
    setShowRecorder(s => !s);
    if (!isRecording) setRecording(true);
    else setRecording(false);
  }, [isRecording, setRecording]);

  /* ── Keyboard shortcuts ────────────────────────────────────────── */
  useDAWShortcuts(
    () => savePositions.mutate(),
    handleRecord,
    handleSplitAtPlayhead,
  );

  /* ── System file drop onto timeline tracks ─────────────────────── */
  const addClip = useTimelineStore(s => s.addClip);
  const startUpload = useUploadStore(s => s.startUpload);

  const handleTimelineFileDrop = useCallback(async ({ files, trackIndex, offsetMs }: TimelineFileDrop) => {
    for (const file of files) {
      const placeholderId = `drop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      /* Add a placeholder clip immediately so the user sees something */
      addClip({
        fileId:        placeholderId,
        track:         trackIndex,
        offsetMs,
        durationMs:    30_000,
        startTimecode: msToTimecode(offsetMs),
        label:         file.name,
        waveformData:  [],
        isLocked:      false,
        isMuted:       false,
      });

      try {
        const realFileId = await startUpload(file, id);
        /* Replace the placeholder with the real file ID once upload starts */
        useTimelineStore.getState().updateClip(placeholderId, { fileId: realFileId });
        /* Revalidate files so the clip gets proper metadata after processing */
        qc.invalidateQueries({ queryKey: ['files', id] });
      } catch {
        /* Remove placeholder on failure */
        useTimelineStore.getState().deleteClips([placeholderId]);
      }
    }
  }, [id, addClip, startUpload, qc]);

  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      {/* ── Page header ────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 border-b border-surface-300 flex-shrink-0 bg-[#0a0a0a]"
        style={{ height: 38 }}
      >
        <Link
          href={`/projects/${id}`}
          className="p-1 rounded hover:bg-surface-300 text-zinc-600 hover:text-white flex-shrink-0"
          style={{ transition: 'color var(--duration-fast)' }}
        >
          <ArrowLeft size={13} />
        </Link>

        <Music2 size={11} className="text-brand-green-400 flex-shrink-0" />
        <span className="text-xs text-zinc-400 truncate">
          {project?.name ?? '…'}
        </span>
        <span className="text-zinc-700 text-xs">/ Timeline</span>

        <div className="flex-1" />

        <button
          onClick={() => setShowRecorder(s => !s)}
          className={`flex items-center gap-1 text-[10px] px-2 h-6 rounded border ${
            showRecorder
              ? 'bg-red-500/15 border-red-500/40 text-red-400'
              : 'border-surface-300 text-zinc-500 hover:text-white'
          }`}
          style={{ transition: 'color var(--duration-fast)' }}
        >
          <Mic size={10} />
          {showRecorder ? 'Hide recorder' : 'Record'}
        </button>
      </div>

      {/* ── Transport bar ──────────────────────────────────────────── */}
      <TransportBar
        onSave={() => savePositions.mutate()}
        isSaving={savePositions.isPending}
        totalTracks={clips.length}
      />

      {/* ── Recorder panel ─────────────────────────────────────────── */}
      {showRecorder && (
        <div className="border-b border-surface-300 bg-surface-100 flex-shrink-0">
          <Suspense fallback={<div className="h-36 animate-pulse" />}>
            <WebStudioRecorder
              projectId={id}
              bpm={project?.bpm ?? 120}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['files', id] });
                setShowRecorder(false);
                setRecording(false);
              }}
            />
          </Suspense>
        </div>
      )}

      {/* ── Timeline canvas — flex-1 ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-h-0">
        <Suspense fallback={<SkeletonTimeline tracks={clips.length || 4} />}>
          <TimelineEngine onFileDrop={handleTimelineFileDrop} />
        </Suspense>
      </div>

      {/* ── Mixer panel (bottom) ───────────────────────────────────── */}
      {showMixer && <MixerPanel />}
    </div>
  );
}
