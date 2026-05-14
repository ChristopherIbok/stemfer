'use client';

import {
  useRef, useCallback, useEffect, useState, useMemo, memo,
} from 'react';
import { useTimelineStore, AutomationLane } from '@/store/useTimelineStore';
import {
  msToTimecode, msToPx, pxToMs, rulerInterval, generateRulerTicks, timelineDurationMs,
} from '@stemfer/shared/utils/timecode';
import { TimelineClip as ClipType } from '@stemfer/shared/types';
import { WaveformCanvas } from './WaveformCanvas';
import { TimecodeInput }  from './TimecodeInput';
import { TrackInspector, LABEL_WIDTH } from './TrackInspector';
import { Lock, Scissors } from 'lucide-react';

export interface TimelineFileDrop {
  files: File[];
  trackIndex: number;
  offsetMs: number;
}

const RULER_HEIGHT   = 36;
const MIN_CLIP_WIDTH = 4;
const TRIM_HANDLE_PX = 8;

/* ── Drag modes ─────────────────────────────────────────────────────── */
type DragMode = 'move' | 'trim-left' | 'trim-right' | 'select-box';

interface DragState {
  mode:         DragMode;
  fileId:       string;
  startX:       number;
  startY:       number;
  startOffset:  number;
  startDuration:number;
  origTrack:    number;
  origOffsets:  Map<string, number>;   // for multi-clip move
}

export function TimelineEngine({ onFileDrop }: { onFileDrop?: (drop: TimelineFileDrop) => void }) {
  const store = useTimelineStore();
  const {
    clips, tracks, totalTracks, zoom, scrollMs, bpm, snapEnabled,
    selectedClipIds, isPlaying, playheadMs,
    loopEnabled, loopStartMs, loopEndMs,
    markers, automationLanes, showAutomation,
    setZoom, setScroll, selectClip, moveClip, splitClip,
    toggleMute, toggleLock, setPlaying, setPlayhead,
    deleteClips, duplicateClips, pushHistory, addMarker,
  } = store;

  const scrollRef     = useRef<HTMLDivElement>(null);
  const rafRef        = useRef<number>(0);
  const dragRef       = useRef<DragState | null>(null);
  const boxRef        = useRef<{ startX: number; startY: number } | null>(null);
  const [selectBox, setSelectBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<number | null>(null);

  const viewportWidth = useRef(1200);

  /* ── Derived geometry ───────────────────────────────────────────── */
  const trackHeights  = useMemo(() => tracks.map(t => t.height ?? 72), [tracks]);
  const totalHeight   = useMemo(() => trackHeights.reduce((s, h) => s + h, 0), [trackHeights]);
  const trackTops     = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const h of trackHeights) { tops.push(y); y += h; }
    return tops;
  }, [trackHeights]);

  const totalMs = useMemo(
    () => Math.max(
      timelineDurationMs(clips.map(c => ({ offsetMs: c.offsetMs, durationMs: c.durationMs }))),
      120_000
    ),
    [clips]
  );

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

  /* ── Playback RAF loop ──────────────────────────────────────────── */
  useEffect(() => {
    if (!isPlaying) { cancelAnimationFrame(rafRef.current); return; }

    let lastTime = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime    = now;

      useTimelineStore.setState(s => {
        let next = s.playheadMs + delta;

        /* Loop */
        if (s.loopEnabled && next >= s.loopEndMs) {
          next = s.loopStartMs;
        } else if (next >= totalMs) {
          return { playheadMs: totalMs, isPlaying: false };
        }

        /* Auto-scroll */
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

  /* ── Pinch / ctrl-wheel zoom ───────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect       = el.getBoundingClientRect();
      const cursorX    = e.clientX - rect.left - LABEL_WIDTH;
      const s          = useTimelineStore.getState();
      const msAtCursor = s.scrollMs + pxToMs(cursorX, s.zoom);
      const factor     = e.deltaY < 0 ? 1.15 : 0.85;
      const newZoom    = Math.max(0.003, Math.min(4, s.zoom * factor));
      const newScroll  = Math.max(0, msAtCursor - pxToMs(cursorX, newZoom));

      useTimelineStore.setState({ zoom: newZoom });
      setScroll(newScroll);
      el.scrollLeft = msToPx(newScroll, newZoom);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setScroll]);

  /* ── Ruler click → seek ────────────────────────────────────────── */
  const onRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ms   = scrollMs + pxToMs(e.clientX - rect.left, zoom);
    setPlayhead(Math.max(0, ms));
  }, [zoom, scrollMs, setPlayhead]);

  /* ── Ruler double-click → add marker ──────────────────────────── */
  const onRulerDblClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ms   = scrollMs + pxToMs(e.clientX - rect.left, zoom);
    addMarker(ms);
  }, [zoom, scrollMs, addMarker]);

  /* ── Clip mouse down (move / trim) ─────────────────────────────── */
  const onClipMouseDown = useCallback((e: React.MouseEvent, clip: ClipType) => {
    if (clip.isLocked) return;
    e.preventDefault();
    e.stopPropagation();

    /* Determine trim vs move from cursor position within clip */
    const clipEl  = e.currentTarget as HTMLElement;
    const clipRect = clipEl.getBoundingClientRect();
    const relX    = e.clientX - clipRect.left;
    const clipW   = clipRect.width;

    let mode: DragMode = 'move';
    if (relX <= TRIM_HANDLE_PX)         mode = 'trim-left';
    else if (relX >= clipW - TRIM_HANDLE_PX) mode = 'trim-right';

    /* Select: additive with shift */
    const additive = e.shiftKey;
    if (!selectedClipIds.has(clip.fileId)) selectClip(clip.fileId, additive);

    /* Collect all selected clips' current offsets for group move */
    const origOffsets = new Map<string, number>();
    useTimelineStore.getState().clips
      .filter(c => selectedClipIds.has(c.fileId) || c.fileId === clip.fileId)
      .forEach(c => origOffsets.set(c.fileId, c.offsetMs));

    pushHistory();

    dragRef.current = {
      mode,
      fileId:        clip.fileId,
      startX:        e.clientX,
      startY:        e.clientY,
      startOffset:   clip.offsetMs,
      startDuration: clip.durationMs,
      origTrack:     clip.track,
      origOffsets,
    };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx  = ev.clientX - d.startX;
      const dMs = pxToMs(dx, zoom);

      if (d.mode === 'move') {
        const newMs = Math.max(0, d.startOffset + dMs);
        /* Track from cursor Y */
        const rect = scrollRef.current!.getBoundingClientRect();
        const relY = ev.clientY - rect.top - RULER_HEIGHT;
        let newTrack = 0;
        for (let i = 0; i < trackTops.length; i++) {
          if (relY >= trackTops[i]) newTrack = i;
        }
        newTrack = Math.max(0, Math.min(totalTracks - 1, newTrack));

        /* Move all selected clips by the same delta */
        const delta = newMs - d.startOffset;
        useTimelineStore.getState().clips
          .filter(c => d.origOffsets.has(c.fileId))
          .forEach(c => {
            const origOffset = d.origOffsets.get(c.fileId)!;
            const trackDelta = c.fileId === d.fileId ? newTrack - d.origTrack : 0;
            moveClip(c.fileId, Math.max(0, origOffset + delta), c.track + trackDelta);
          });
      } else if (d.mode === 'trim-right') {
        const newDur = Math.max(100, d.startDuration + dMs);
        useTimelineStore.getState().updateClip(d.fileId, { durationMs: newDur });
      } else if (d.mode === 'trim-left') {
        const newOffset = Math.max(0, d.startOffset + dMs);
        const newDur    = Math.max(100, d.startDuration - dMs);
        useTimelineStore.getState().updateClip(d.fileId, { offsetMs: newOffset, durationMs: newDur });
      }
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [zoom, totalTracks, trackTops, selectedClipIds, moveClip, selectClip, pushHistory]);

  /* ── Canvas area mouse down → selection box ────────────────────── */
  const onCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    selectClip(null);

    const rect   = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    boxRef.current = { startX, startY };
    setSelectBox({ x: startX, y: startY, w: 0, h: 0 });

    const onMove = (ev: MouseEvent) => {
      if (!boxRef.current) return;
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const bx = boxRef.current;
      setSelectBox({
        x: Math.min(x, bx.startX),
        y: Math.min(y, bx.startY),
        w: Math.abs(x - bx.startX),
        h: Math.abs(y - bx.startY),
      });
    };

    const onUp = (ev: MouseEvent) => {
      if (!boxRef.current) return;
      const x2  = ev.clientX - rect.left;
      const y2  = ev.clientY - rect.top;
      const bx  = boxRef.current;
      const selX = Math.min(x2, bx.startX);
      const selW = Math.abs(x2 - bx.startX);
      const selY = Math.min(y2, bx.startY);
      const selH = Math.abs(y2 - bx.startY);

      if (selW > 4 && selH > 4) {
        /* Convert box to ms + track range */
        const selStartMs = scrollMs + pxToMs(selX, zoom);
        const selEndMs   = scrollMs + pxToMs(selX + selW, zoom);
        const hitClips = useTimelineStore.getState().clips.filter(c => {
          const clipTop    = trackTops[c.track] ?? 0;
          const clipBottom = clipTop + (tracks[c.track]?.height ?? 72);
          const clipStart  = c.offsetMs;
          const clipEnd    = c.offsetMs + c.durationMs;
          return clipEnd > selStartMs && clipStart < selEndMs &&
                 clipBottom > selY + RULER_HEIGHT && clipTop < selY + selH + RULER_HEIGHT;
        });
        useTimelineStore.getState().selectClips(hitClips.map(c => c.fileId));
      }

      boxRef.current = null;
      setSelectBox(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [scrollMs, zoom, trackTops, tracks, selectClip]);

  /* ── System file drag-and-drop onto tracks ─────────────────────── */
  const getTrackAtY = useCallback((clientY: number) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect) return -1;
    const relY = clientY - rect.top - RULER_HEIGHT;
    let idx = -1;
    for (let i = 0; i < trackTops.length; i++) {
      if (relY >= trackTops[i]) idx = i;
    }
    return Math.max(0, Math.min(totalTracks - 1, idx));
  }, [trackTops, totalTracks]);

  const onTrackDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types).map(t => t.toLowerCase());
    if (!types.includes('files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTrack(getTrackAtY(e.clientY));
  }, [getTrackAtY]);

  const onTrackDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTrack(null);
    }
  }, []);

  const onTrackDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverTrack(null);
    if (!onFileDrop) return;
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(wav|mp3|aiff|aif|flac|ogg|m4a|opus|webm|als|logicx|song|ptx|rpp)$/i.test(f.name) ||
      f.type.startsWith('audio/')
    );
    if (!files.length) return;
    const rect = scrollRef.current!.getBoundingClientRect();
    const relX = e.clientX - rect.left - LABEL_WIDTH + (scrollRef.current?.scrollLeft ?? 0);
    const offsetMs = Math.max(0, pxToMs(relX, zoom));
    const trackIndex = getTrackAtY(e.clientY);
    onFileDrop({ files, trackIndex, offsetMs });
  }, [onFileDrop, zoom, getTrackAtY]);

  /* ── Measure viewport ──────────────────────────────────────────── */
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
  const loopStartPx   = msToPx(loopStartMs - scrollMs, zoom);
  const loopEndPx     = msToPx(loopEndMs   - scrollMs, zoom);

  /* ── Visible clips ─────────────────────────────────────────────── */
  const viewW = viewportWidth.current - LABEL_WIDTH;
  const visibleClips = useMemo(() => clips.filter(clip => {
    const left  = msToPx(clip.offsetMs - scrollMs, zoom);
    const width = msToPx(clip.durationMs, zoom);
    return left + width > -400 && left < viewW + 400;
  }), [clips, scrollMs, zoom, viewW]);

  return (
    <div className="flex h-full bg-surface select-none overflow-hidden">
      {/* ── Track inspector (sticky left) ───────────────────────── */}
      <div
        className="flex-shrink-0 overflow-y-auto"
        style={{ width: LABEL_WIDTH, boxShadow: '2px 0 8px rgba(0,0,0,0.4)' }}
      >
        <TrackInspector rulerHeight={RULER_HEIGHT} />
      </div>

      {/* ── Scrollable timeline canvas ───────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onScroll={handleScroll}
      >
        <div style={{ width: timelineWidth, position: 'relative', minWidth: '100%' }}>

          {/* ── Ruler ────────────────────────────────────────────── */}
          <div
            className="sticky top-0 z-10 bg-surface-200 border-b border-surface-300 cursor-pointer overflow-hidden"
            style={{ height: RULER_HEIGHT }}
            onClick={onRulerClick}
            onDoubleClick={onRulerDblClick}
          >
            {/* Loop region */}
            {loopEnabled && loopEndPx > loopStartPx && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:            Math.max(0, loopStartPx),
                  width:           loopEndPx - loopStartPx,
                  backgroundColor: 'rgba(34,197,94,0.08)',
                  borderLeft:      '1px solid rgba(34,197,94,0.4)',
                  borderRight:     '1px solid rgba(34,197,94,0.4)',
                }}
              />
            )}

            {/* Ruler ticks */}
            {ticks.map(tick => (
              <RulerTick key={tick.ms} tick={tick} scrollMs={scrollMs} zoom={zoom} />
            ))}

            {/* Markers */}
            {markers.map(m => {
              const mpx = msToPx(m.ms - scrollMs, zoom);
              if (mpx < -20 || mpx > viewW + 20) return null;
              return (
                <div
                  key={m.id}
                  className="absolute top-0 flex flex-col items-center pointer-events-none"
                  style={{ left: mpx }}
                >
                  <div style={{ width: 1, height: RULER_HEIGHT, backgroundColor: m.color }} />
                  <span
                    className="absolute text-[8px] font-medium whitespace-nowrap px-0.5 rounded"
                    style={{ top: 2, left: 3, color: m.color, backgroundColor: 'rgba(0,0,0,0.6)' }}
                  >
                    {m.label}
                  </span>
                </div>
              );
            })}

            {/* Playhead triangle on ruler */}
            {playheadPx >= -2 && (
              <div
                className="absolute top-0 pointer-events-none"
                style={{ left: playheadPx - 6, zIndex: 20 }}
              >
                <div style={{
                  width:        0,
                  height:       0,
                  borderLeft:   '6px solid transparent',
                  borderRight:  '6px solid transparent',
                  borderTop:    '8px solid #4ade80',
                }} />
              </div>
            )}
          </div>

          {/* ── Track area ───────────────────────────────────────── */}
          <div
            style={{ position: 'relative', height: totalHeight }}
            onMouseDown={onCanvasMouseDown}
            onDragOver={onTrackDragOver}
            onDragLeave={onTrackDragLeave}
            onDrop={onTrackDrop}
          >
            {/* Beat grid */}
            {snapEnabled && ticks.map(tick => (
              <div
                key={`g-${tick.ms}`}
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:       msToPx(tick.ms - scrollMs, zoom),
                  borderLeft: `1px solid ${tick.major ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)'}`,
                }}
              />
            ))}

            {/* Track row backgrounds */}
            {Array.from({ length: totalTracks }).map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-b"
                style={{
                  top:         trackTops[i],
                  height:      trackHeights[i],
                  borderColor: dragOverTrack === i ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.04)',
                  backgroundColor: dragOverTrack === i
                    ? 'rgba(74,222,128,0.06)'
                    : i % 2 === 0 ? 'rgba(10,10,10,0.5)' : 'rgba(17,17,17,0.4)',
                  transition: 'background-color 80ms, border-color 80ms',
                }}
              />
            ))}

            {/* Loop region on tracks */}
            {loopEnabled && loopEndPx > loopStartPx && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left:            Math.max(0, loopStartPx),
                  width:           loopEndPx - loopStartPx,
                  backgroundColor: 'rgba(34,197,94,0.04)',
                }}
              />
            )}

            {/* Clips */}
            {visibleClips.map(clip => {
              const trackH = trackHeights[clip.track] ?? 72;
              return (
                <TimelineClipBlock
                  key={clip.fileId}
                  clip={clip}
                  zoom={zoom}
                  scrollMs={scrollMs}
                  selected={selectedClipIds.has(clip.fileId)}
                  trackTop={trackTops[clip.track] ?? 0}
                  trackHeight={trackH}
                  trackColor={tracks[clip.track]?.color}
                  onMouseDown={onClipMouseDown}
                />
              );
            })}

            {/* Selection box */}
            {selectBox && (
              <div
                className="absolute pointer-events-none border border-brand-green-500/50 bg-brand-green-500/5 rounded"
                style={{
                  left:   selectBox.x,
                  top:    selectBox.y,
                  width:  selectBox.w,
                  height: selectBox.h,
                  zIndex: 30,
                }}
              />
            )}

            {/* Automation lanes */}
            {showAutomation && automationLanes.filter(l => l.visible).map(lane => (
              <AutomationLaneView
                key={`${lane.trackId}-${lane.param}`}
                lane={lane}
                zoom={zoom}
                scrollMs={scrollMs}
                trackTop={trackTops[lane.trackId] ?? 0}
                trackHeight={trackHeights[lane.trackId] ?? 72}
                trackColor={tracks[lane.trackId]?.color ?? '#22c55e'}
              />
            ))}

            {/* Playhead */}
            {playheadPx >= -2 && playheadPx <= timelineWidth + 2 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{
                  left:       playheadPx,
                  width:      1,
                  background: 'rgba(74,222,128,0.85)',
                  willChange: 'left',
                  boxShadow:  '0 0 4px rgba(74,222,128,0.3)',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Right panel: Clip inspector ───────────────────────────── */}
      <ClipInspectorPanel />
    </div>
  );
}

/* ── Ruler tick ─────────────────────────────────────────────────────── */
const RulerTick = memo(function RulerTick({
  tick, scrollMs, zoom,
}: {
  tick: { ms: number; major: boolean; label: string };
  scrollMs: number;
  zoom:     number;
}) {
  const left = msToPx(tick.ms - scrollMs, zoom);
  return (
    <div className="absolute top-0" style={{ left, transform: 'translateZ(0)' }}>
      <div style={{
        height:     tick.major ? RULER_HEIGHT : 10,
        width:      1,
        background: tick.major ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)',
      }} />
      {tick.major && (
        <span
          className="timecode absolute left-1"
          style={{ top: 10, fontSize: 9, whiteSpace: 'nowrap', color: '#6b6b6b' }}
        >
          {tick.label}
        </span>
      )}
    </div>
  );
});

/* ── Clip block ─────────────────────────────────────────────────────── */
const TimelineClipBlock = memo(function TimelineClipBlock({
  clip, zoom, scrollMs, selected, trackTop, trackHeight, trackColor, onMouseDown,
}: {
  clip:        ClipType;
  zoom:        number;
  scrollMs:    number;
  selected:    boolean;
  trackTop:    number;
  trackHeight: number;
  trackColor?: string;
  onMouseDown: (e: React.MouseEvent, clip: ClipType) => void;
}) {
  const left  = msToPx(clip.offsetMs - scrollMs, zoom);
  const width = Math.max(MIN_CLIP_WIDTH, msToPx(clip.durationMs, zoom));
  const color = trackColor ?? clip.color ?? '#22c55e';

  const PAD = 4;

  return (
    <div
      className={[
        'timeline-clip group',
        clip.isMuted  ? 'timeline-clip--muted'   : '',
        selected      ? 'timeline-clip--selected' : '',
        clip.isLocked ? 'cursor-not-allowed'       : 'cursor-grab active:cursor-grabbing',
      ].filter(Boolean).join(' ')}
      style={{
        left:            Math.max(0, left),
        width:           Math.min(width, 80_000),
        top:             trackTop + PAD,
        height:          trackHeight - PAD * 2,
        position:        'absolute',
        backgroundColor: `${color}18`,
        borderColor:     selected ? '#fff' : `${color}80`,
        transform:       'translateZ(0)',
        boxShadow:       selected ? `0 0 0 1px #ffffff22 inset, 0 0 6px ${color}20` : undefined,
      }}
      onMouseDown={e => onMouseDown(e, clip)}
    >
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
        style={{ backgroundColor: `${color}40`, borderRadius: '3px 0 0 3px' }}
      />
      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
        style={{ backgroundColor: `${color}40`, borderRadius: '0 3px 3px 0' }}
      />

      {/* Header */}
      <div className="flex items-center gap-1 px-1.5 overflow-hidden" style={{ height: 18 }}>
        {clip.isLocked && <Lock size={7} className="text-zinc-500 flex-shrink-0" />}
        <span className="text-[9px] font-medium truncate leading-none" style={{ color: `${color}dd` }}>
          {clip.label}
        </span>
      </div>

      {/* Waveform */}
      {clip.waveformData.length > 0 && (
        <WaveformCanvas
          peaks={clip.waveformData}
          width={width - 2}
          height={trackHeight - PAD * 2 - 20}
          color={clip.isMuted ? '#404040' : color}
        />
      )}
    </div>
  );
}, (prev, next) =>
  prev.clip       === next.clip &&
  prev.zoom       === next.zoom &&
  prev.scrollMs   === next.scrollMs &&
  prev.selected   === next.selected &&
  prev.trackTop   === next.trackTop &&
  prev.trackColor === next.trackColor
);

/* ── Automation lane overlay ────────────────────────────────────────── */
const AutomationLaneView = memo(function AutomationLaneView({
  lane, zoom, scrollMs, trackTop, trackHeight, trackColor,
}: {
  lane:        AutomationLane;
  zoom:        number;
  scrollMs:    number;
  trackTop:    number;
  trackHeight: number;
  trackColor:  string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const h         = 32;
  const top       = trackTop + trackHeight; /* draw below track */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w   = canvas.offsetWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx || w <= 0) return;

    canvas.width  = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    if (lane.points.length < 2) return;

    ctx.beginPath();
    lane.points.forEach((pt, i) => {
      const x = msToPx(pt.ms - scrollMs, zoom);
      const y = h - pt.value * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = `${trackColor}cc`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    /* Fill under curve */
    const last = lane.points[lane.points.length - 1];
    ctx.lineTo(msToPx(last.ms - scrollMs, zoom), h);
    ctx.lineTo(msToPx(lane.points[0].ms - scrollMs, zoom), h);
    ctx.closePath();
    ctx.fillStyle = `${trackColor}18`;
    ctx.fill();

    lane.points.forEach(pt => {
      const x = msToPx(pt.ms - scrollMs, zoom);
      const y = h - pt.value * h;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = trackColor;
      ctx.fill();
    });
  }, [lane, zoom, scrollMs, trackColor]);

  return (
    <div
      className="absolute left-0 right-0 border-b border-surface-300/40 overflow-hidden"
      style={{ top, height: h, backgroundColor: 'rgba(0,0,0,0.3)' }}
    >
      <span
        className="absolute left-1 top-0.5 text-[8px] uppercase tracking-widest"
        style={{ color: `${trackColor}80` }}
      >
        {lane.param}
      </span>
      <canvas ref={canvasRef} className="absolute inset-0 w-full" style={{ height: h }} />
    </div>
  );
});

/* ── Clip inspector right panel ─────────────────────────────────────── */
function ClipInspectorPanel() {
  const {
    clips, selectedClipIds, tracks,
    showRightPanel, rightPanelTab,
    setRightPanelTab, updateClip,
  } = useTimelineStore();

  if (!showRightPanel) return null;

  const fileId = [...selectedClipIds][0] ?? null;
  const clip   = fileId ? clips.find(c => c.fileId === fileId) : null;
  const track  = clip ? tracks[clip.track] : null;

  return (
    <div
      className="border-l border-surface-300 bg-surface-100 flex-shrink-0 flex flex-col"
      style={{ width: 220 }}
    >
      {/* Tab bar */}
      <div className="flex border-b border-surface-300 flex-shrink-0">
        {(['inspector', 'fx', 'automation'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setRightPanelTab(tab)}
            className={`flex-1 text-[9px] font-medium uppercase tracking-widest py-2 ${
              rightPanelTab === tab
                ? 'text-brand-green-400 border-b border-brand-green-500'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {rightPanelTab === 'inspector' && clip && (
          <div className="space-y-3">
            <div>
              <label className="label text-[9px]">Clip name</label>
              <div className="text-xs text-white truncate">{clip.label}</div>
            </div>
            <div>
              <label className="label text-[9px]">Track</label>
              <div className="text-xs text-zinc-400">{track?.name ?? `Track ${clip.track + 1}`}</div>
            </div>
            <div>
              <label className="label text-[9px]">Timecode</label>
              <TimecodeInput
                value={clip.startTimecode}
                onChange={tc => updateClip(fileId!, { startTimecode: tc })}
              />
            </div>
            <div>
              <label className="label text-[9px]">Offset</label>
              <div className="text-xs text-zinc-400 tabular-nums">{clip.offsetMs.toFixed(0)} ms</div>
            </div>
            <div>
              <label className="label text-[9px]">Duration</label>
              <div className="text-xs text-zinc-400 tabular-nums">{msToTimecode(clip.durationMs)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <InfoPill label="Muted" value={clip.isMuted ? 'Yes' : 'No'} active={clip.isMuted} />
              <InfoPill label="Locked" value={clip.isLocked ? 'Yes' : 'No'} active={clip.isLocked} />
            </div>
          </div>
        )}
        {rightPanelTab === 'inspector' && !clip && (
          <p className="text-[10px] text-zinc-600 text-center mt-8">Select a clip to inspect</p>
        )}
        {rightPanelTab === 'fx' && (
          <p className="text-[10px] text-zinc-600 text-center mt-8">FX chain — coming soon</p>
        )}
        {rightPanelTab === 'automation' && (
          <AutomationPanel />
        )}
      </div>
    </div>
  );
}

function InfoPill({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="bg-surface-200 border border-surface-300 rounded px-2 py-1.5">
      <p className="text-[8px] text-zinc-600 uppercase tracking-widest">{label}</p>
      <p className={`text-[11px] font-medium mt-0.5 ${active ? 'text-brand-green-400' : 'text-zinc-400'}`}>{value}</p>
    </div>
  );
}

function AutomationPanel() {
  const { tracks, automationLanes, toggleAutomation, showAutomation, setShowAutomation } = useTimelineStore();
  return (
    <div className="space-y-2">
      <button
        onClick={() => setShowAutomation(!showAutomation)}
        className={`w-full text-[10px] py-1.5 rounded border ${showAutomation ? 'bg-brand-green-500/15 border-brand-green-500/40 text-brand-green-400' : 'border-surface-300 text-zinc-500 hover:text-white'}`}
      >
        {showAutomation ? 'Hide automation' : 'Show automation'}
      </button>
      {tracks.map(t => (
        <div key={t.id} className="space-y-1">
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest">{t.name}</p>
          {(['volume', 'pan'] as const).map(param => {
            const lane = automationLanes.find(l => l.trackId === t.id && l.param === param);
            return (
              <button
                key={param}
                onClick={() => toggleAutomation(t.id, param)}
                className={`w-full text-left text-[10px] px-2 py-1 rounded ${lane?.visible ? 'bg-surface-300 text-white' : 'text-zinc-600 hover:text-zinc-400 hover:bg-surface-200'}`}
              >
                {param}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
