'use client';

import {
  useRef, useCallback, useEffect, useState, useMemo, memo,
} from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import {
  msToTimecode, msToPx, pxToMs, rulerInterval, generateRulerTicks, timelineDurationMs,
} from '@stemfer/shared/utils/timecode';
import { TimelineClip as ClipType } from '@stemfer/shared/types';
import { WaveformCanvas } from './WaveformCanvas';
import { TimecodeInput }  from './TimecodeInput';
import {
  ZoomIn, ZoomOut, Play, Pause, SkipBack, Lock, Volume2, VolumeX,
  Grid3x3, AlignStartVertical,
} from 'lucide-react';

const TRACK_HEIGHT   = 72;
const RULER_HEIGHT   = 32;
const LABEL_WIDTH    = 180;
const MIN_CLIP_WIDTH = 4;

export function TimelineEngine() {
  const {
    clips, zoom, scrollMs, bpm, snapEnabled, selectedClipId,
    isPlaying, playheadMs, totalTracks,
    setZoom, setScroll, selectClip, moveClip,
    toggleMute, toggleLock, setPlaying, setPlayhead, setBpm, setSnap,
  } = useTimelineStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef    = useRef<number>(0);
  const dragRef   = useRef<{
    fileId: string;
    startX: number;
    startOffset: number;
    track: number;
  } | null>(null);

  /* ── Derived layout metrics ─────────────────────────────────────── */
  const totalMs = useMemo(
    () => Math.max(
      timelineDurationMs(clips.map(c => ({ offsetMs: c.offsetMs, durationMs: c.durationMs }))),
      60_000
    ),
    [clips]
  );

  const viewportWidth = useRef(1000);

  const visibleMs = useMemo(
    () => pxToMs(viewportWidth.current - LABEL_WIDTH, zoom),
    [zoom]
  );

  const interval = useMemo(
    () => rulerInterval(visibleMs, viewportWidth.current - LABEL_WIDTH),
    [visibleMs]
  );

  const ticks = useMemo(
    () => generateRulerTicks(scrollMs, scrollMs + visibleMs, interval),
    [scrollMs, visibleMs, interval]
  );

  /* ── Playback RAF loop ─────────────────────────────────────────── */
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    let lastTime = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      useTimelineStore.setState(s => {
        const next = s.playheadMs + delta;
        if (next >= totalMs) {
          return { playheadMs: totalMs, isPlaying: false };
        }

        /* Auto-scroll: keep playhead within 80% of visible window */
        const playPx = msToPx(next - s.scrollMs, s.zoom);
        const viewW  = viewportWidth.current - LABEL_WIDTH;
        if (playPx > viewW * 0.8) {
          const newScrollMs = next - pxToMs(viewW * 0.2, s.zoom);
          scrollRef.current?.scrollTo({ left: msToPx(newScrollMs, s.zoom) });
          return { playheadMs: next, scrollMs: Math.max(0, newScrollMs) };
        }

        return { playheadMs: next };
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, totalMs]);

  /* ── Scroll sync ───────────────────────────────────────────────── */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    viewportWidth.current = el.clientWidth;
    setScroll(pxToMs(el.scrollLeft, zoom));
  }, [zoom, setScroll]);

  /* ── Wheel zoom (pinch-to-zoom and ctrl+scroll) ────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      /* Zoom centered on cursor position */
      const rect    = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - LABEL_WIDTH;
      const msAtCursor = useTimelineStore.getState().scrollMs + pxToMs(cursorX, useTimelineStore.getState().zoom);

      const factor     = e.deltaY < 0 ? 1.12 : 0.88;
      const newZoom    = Math.max(0.005, Math.min(2, useTimelineStore.getState().zoom * factor));

      /* Adjust scroll so cursor position stays fixed */
      const newScrollMs = msAtCursor - pxToMs(cursorX, newZoom);

      useTimelineStore.setState({ zoom: newZoom });
      setScroll(Math.max(0, newScrollMs));
      el.scrollLeft = msToPx(Math.max(0, newScrollMs), newZoom);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setScroll]);

  /* ── Drag ──────────────────────────────────────────────────────── */
  const onClipMouseDown = useCallback((e: React.MouseEvent, clip: ClipType) => {
    if (clip.isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.fileId);
    dragRef.current = {
      fileId:      clip.fileId,
      startX:      e.clientX,
      startOffset: clip.offsetMs,
      track:       clip.track,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx       = ev.clientX - dragRef.current.startX;
      const dMs      = pxToMs(dx, zoom);
      const newMs    = Math.max(0, dragRef.current.startOffset + dMs);

      const rect     = scrollRef.current!.getBoundingClientRect();
      const relY     = ev.clientY - rect.top - RULER_HEIGHT;
      const newTrack = Math.max(0, Math.min(totalTracks - 1, Math.floor(relY / TRACK_HEIGHT)));

      moveClip(dragRef.current.fileId, newMs, newTrack);
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [zoom, totalTracks, moveClip, selectClip]);

  /* ── Ruler click → set playhead ────────────────────────────────── */
  const onRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ms   = scrollMs + pxToMs(e.clientX - rect.left, zoom);
    setPlayhead(Math.max(0, ms));
  }, [zoom, scrollMs, setPlayhead]);

  /* ── Zoom helpers ──────────────────────────────────────────────── */
  const zoomIn  = useCallback(() => setZoom(zoom * 1.5), [zoom, setZoom]);
  const zoomOut = useCallback(() => setZoom(zoom / 1.5), [zoom, setZoom]);
  const zoomFit = useCallback(() => {
    const w = (scrollRef.current?.clientWidth ?? 1000) - LABEL_WIDTH;
    setZoom(w / totalMs);
    setScroll(0);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [totalMs, setZoom, setScroll]);

  /* ── Measure viewport on mount ─────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    viewportWidth.current = el.clientWidth;

    const ro = new ResizeObserver(([entry]) => {
      viewportWidth.current = entry.contentRect.width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timelineWidth = msToPx(totalMs, zoom);
  const playheadPx    = msToPx(playheadMs - scrollMs, zoom);

  /* ── Visible clips (horizontal culling) ───────────────────────── */
  const viewW = viewportWidth.current - LABEL_WIDTH;
  const visibleClips = useMemo(() => clips.filter(clip => {
    const left  = msToPx(clip.offsetMs - scrollMs, zoom);
    const width = msToPx(clip.durationMs, zoom);
    return left + width > -200 && left < viewW + 200;
  }), [clips, scrollMs, zoom, viewW]);

  return (
    <div className="flex flex-col h-full bg-surface select-none">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-300 bg-surface-100 flex-shrink-0">
        {/* Transport */}
        <button
          onClick={() => { setPlayhead(0); setPlaying(false); }}
          className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white"
          title="Return to start"
          style={{ transition: 'background-color var(--duration-fast)' }}
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={() => setPlaying(!isPlaying)}
          className="p-1.5 rounded bg-brand-green-500 hover:bg-brand-green-600 text-black"
          title={isPlaying ? 'Pause' : 'Play'}
          style={{ transition: 'background-color var(--duration-fast)' }}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>

        <div className="h-4 w-px bg-surface-400 mx-1" />

        <span className="timecode select-text">{msToTimecode(playheadMs)}</span>

        <div className="h-4 w-px bg-surface-400 mx-1" />

        {/* Zoom */}
        <button onClick={zoomOut} className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white" title="Zoom out"
                style={{ transition: 'background-color var(--duration-fast)' }}>
          <ZoomOut size={14} />
        </button>
        <button onClick={zoomIn} className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white" title="Zoom in"
                style={{ transition: 'background-color var(--duration-fast)' }}>
          <ZoomIn size={14} />
        </button>
        <button
          onClick={zoomFit}
          className="text-xs px-2 py-1 rounded hover:bg-surface-300 text-zinc-400 hover:text-white"
          style={{ transition: 'background-color var(--duration-fast)' }}
        >
          Fit
        </button>

        <div className="h-4 w-px bg-surface-400 mx-1" />

        {/* Snap */}
        <button
          onClick={() => setSnap(!snapEnabled)}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
            snapEnabled
              ? 'bg-brand-green-500/20 text-brand-green-400'
              : 'text-zinc-500 hover:bg-surface-300 hover:text-white'
          }`}
          style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
        >
          <Grid3x3 size={11} />
          Snap
        </button>

        {/* BPM */}
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          BPM
          <input
            type="number"
            value={bpm}
            onChange={e => setBpm(parseFloat(e.target.value) || 120)}
            className="w-14 input py-0.5 text-center text-xs h-6"
            min={20}
            max={400}
          />
        </label>

        {/* Inspector */}
        <div className="ml-auto flex items-center gap-2">
          {selectedClipId && <ClipInspector fileId={selectedClipId} />}
        </div>
      </div>

      {/* ── Timeline scroll area ─────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onScroll={handleScroll}
        style={{ cursor: 'default' }}
      >
        {/* ── Track labels (sticky left) ─────────────────────────────── */}
        <TrackLabels
          totalTracks={totalTracks}
          clips={clips}
          onToggleMute={toggleMute}
          onToggleLock={toggleLock}
        />

        {/* ── Scrollable canvas area ─────────────────────────────────── */}
        <div style={{ marginLeft: LABEL_WIDTH, width: timelineWidth, position: 'relative' }}>
          {/* Ruler */}
          <div
            className="sticky top-0 z-10 bg-surface-200 border-b border-surface-300 cursor-pointer overflow-hidden"
            style={{ height: RULER_HEIGHT }}
            onClick={onRulerClick}
          >
            {ticks.map(tick => (
              <RulerTick
                key={tick.ms}
                tick={tick}
                scrollMs={scrollMs}
                zoom={zoom}
              />
            ))}
          </div>

          {/* Track area */}
          <div style={{ position: 'relative', height: totalTracks * TRACK_HEIGHT }}>
            {/* Beat grid lines */}
            {snapEnabled && ticks.filter(t => !t.major).map(tick => (
              <div
                key={`g-${tick.ms}`}
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:        msToPx(tick.ms - scrollMs, zoom),
                  borderLeft:  '1px solid rgba(255,255,255,0.04)',
                }}
              />
            ))}

            {/* Track row backgrounds */}
            {Array.from({ length: totalTracks }).map((_, i) => (
              <div
                key={i}
                className={`absolute left-0 right-0 border-b ${i % 2 === 0 ? 'bg-surface/60' : 'bg-surface-100/40'}`}
                style={{
                  top:         i * TRACK_HEIGHT,
                  height:      TRACK_HEIGHT,
                  borderColor: 'rgba(255,255,255,0.05)',
                }}
              />
            ))}

            {/* Clips — only visible ones rendered */}
            {visibleClips.map(clip => (
              <TimelineClipBlock
                key={clip.fileId}
                clip={clip}
                zoom={zoom}
                scrollMs={scrollMs}
                selected={selectedClipId === clip.fileId}
                onMouseDown={onClipMouseDown}
              />
            ))}

            {/* Playhead */}
            {playheadPx >= -2 && playheadPx <= timelineWidth + 2 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{
                  left:      playheadPx,
                  width:     1,
                  background: 'rgba(74,222,128,0.9)',
                  willChange: 'left',
                }}
              >
                <div
                  className="absolute -left-1.5 -top-1"
                  style={{
                    width:           10,
                    height:          10,
                    borderRadius:    '50%',
                    backgroundColor: '#4ade80',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Track label column (memoized) ──────────────────────────────────────── */
const TrackLabels = memo(function TrackLabels({
  totalTracks,
  clips,
  onToggleMute,
  onToggleLock,
}: {
  totalTracks: number;
  clips: ClipType[];
  onToggleMute: (id: string) => void;
  onToggleLock: (id: string) => void;
}) {
  return (
    <div
      className="sticky left-0 z-20 bg-surface-100 border-r border-surface-300"
      style={{
        width:  LABEL_WIDTH,
        float:  'left',
        height: RULER_HEIGHT + totalTracks * TRACK_HEIGHT,
      }}
    >
      {/* Corner */}
      <div className="flex items-center px-3 border-b border-surface-300" style={{ height: RULER_HEIGHT }}>
        <span className="text-[10px] text-zinc-600 font-mono tracking-widest uppercase">Track</span>
      </div>

      {/* Labels */}
      {Array.from({ length: totalTracks }).map((_, i) => {
        const trackClip = clips.find(c => c.track === i);
        return (
          <div
            key={i}
            className="flex items-center gap-2 px-3 border-b border-surface-300/40"
            style={{ height: TRACK_HEIGHT }}
          >
            <span className="text-[10px] text-zinc-700 font-mono w-4 flex-shrink-0">{i + 1}</span>
            <span className="text-xs text-zinc-500 truncate flex-1 min-w-0">
              {trackClip?.label ?? <span className="text-zinc-700">—</span>}
            </span>
            {trackClip && (
              <div className="flex gap-0.5 flex-shrink-0">
                <button
                  onClick={() => onToggleMute(trackClip.fileId)}
                  className={`p-0.5 rounded transition-colors ${trackClip.isMuted ? 'text-amber-400' : 'text-zinc-600 hover:text-white'}`}
                  title={trackClip.isMuted ? 'Unmute' : 'Mute'}
                >
                  {trackClip.isMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
                <button
                  onClick={() => onToggleLock(trackClip.fileId)}
                  className={`p-0.5 rounded transition-colors ${trackClip.isLocked ? 'text-brand-green-400' : 'text-zinc-600 hover:text-white'}`}
                  title={trackClip.isLocked ? 'Unlock' : 'Lock'}
                >
                  <Lock size={11} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

/* ── Ruler tick (memoized) ──────────────────────────────────────────────── */
const RulerTick = memo(function RulerTick({
  tick,
  scrollMs,
  zoom,
}: {
  tick: { ms: number; major: boolean; label: string };
  scrollMs: number;
  zoom: number;
}) {
  const left = msToPx(tick.ms - scrollMs, zoom);
  return (
    <div
      className="absolute top-0"
      style={{ left, transform: 'translateZ(0)' }}
    >
      <div
        style={{
          height:      tick.major ? RULER_HEIGHT : 10,
          width:       1,
          background:  tick.major ? '#404040' : '#2e2e2e',
        }}
      />
      {tick.major && (
        <span
          className="timecode absolute left-1"
          style={{ top: 7, fontSize: 9, whiteSpace: 'nowrap' }}
        >
          {tick.label}
        </span>
      )}
    </div>
  );
});

/* ── Clip block (memoized) ──────────────────────────────────────────────── */
const TimelineClipBlock = memo(function TimelineClipBlock({
  clip,
  zoom,
  scrollMs,
  selected,
  onMouseDown,
}: {
  clip: ClipType;
  zoom: number;
  scrollMs: number;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, clip: ClipType) => void;
}) {
  const left  = msToPx(clip.offsetMs - scrollMs, zoom);
  const width = Math.max(MIN_CLIP_WIDTH, msToPx(clip.durationMs, zoom));

  const classes = [
    'timeline-clip',
    clip.isMuted   ? 'timeline-clip--muted'    : '',
    selected       ? 'timeline-clip--selected'  : '',
    clip.isLocked  ? 'cursor-not-allowed'        : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{
        left:            Math.max(0, left),
        width:           Math.min(width, 40_000),
        top:             clip.track * TRACK_HEIGHT + 4,
        height:          TRACK_HEIGHT - 8,
        backgroundColor: clip.color ? `${clip.color}1a` : 'rgba(34,197,94,0.12)',
        borderColor:     clip.color ?? '#22c55e99',
        transform:       'translateZ(0)',  /* promote to composite layer */
      }}
      onMouseDown={e => onMouseDown(e, clip)}
    >
      <div className="flex items-center gap-1 px-1.5 h-5 overflow-hidden">
        {clip.isLocked && <Lock size={8} className="text-zinc-500 flex-shrink-0" />}
        <span className="text-[10px] font-medium text-white/80 truncate leading-none">
          {clip.label}
        </span>
      </div>
      {clip.waveformData.length > 0 && (
        <WaveformCanvas
          peaks={clip.waveformData}
          width={width}
          height={TRACK_HEIGHT - 28}
          color={clip.isMuted ? '#555' : clip.color ?? '#22c55e'}
        />
      )}
    </div>
  );
});

/* ── Clip inspector ─────────────────────────────────────────────────────── */
function ClipInspector({ fileId }: { fileId: string }) {
  const clip   = useTimelineStore(s => s.clips.find(c => c.fileId === fileId));
  const update = useTimelineStore(s => s.updateClip);
  if (!clip) return null;

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-400 bg-surface-200 rounded-lg px-3 py-1.5 border border-surface-300 animate-fade-in">
      <span className="font-medium text-white truncate max-w-[100px] text-xs">{clip.label}</span>
      <div className="flex items-center gap-1">
        <span className="text-zinc-600 text-[10px]">TC</span>
        <TimecodeInput
          value={clip.startTimecode}
          onChange={tc => update(fileId, { startTimecode: tc })}
        />
      </div>
      <div className="flex items-center gap-1 text-zinc-500">
        <AlignStartVertical size={11} />
        <span className="text-[11px]">Tr {clip.track + 1}</span>
      </div>
    </div>
  );
}
