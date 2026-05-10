'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { GripVertical, Mic, Volume2, Plus } from 'lucide-react';
import { useTimelineStore, TrackState } from '@/store/useTimelineStore';

export const LABEL_WIDTH = 200;

const TRACK_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f97316', '#ef4444',
  '#84cc16', '#06b6d4',
];

interface TrackInspectorProps {
  rulerHeight: number;
}

export const TrackInspector = memo(function TrackInspector({ rulerHeight }: TrackInspectorProps) {
  const {
    tracks, totalTracks,
    toggleTrackMute, toggleTrackSolo, toggleTrackArm,
    setTrackVolume, setTrackPan,
    updateTrack, addTrack, reorderTracks,
  } = useTimelineStore();

  /* ── Drag-reorder state ─────────────────────────────────────────── */
  const [dragIndex,   setDragIndex]   = useState<number | null>(null);
  const [overIndex,   setOverIndex]   = useState<number | null>(null);
  const containerRef                   = useRef<HTMLDivElement>(null);
  const dragStartY                     = useRef(0);
  const rowHeights                     = useRef<number[]>([]);

  /* Called when the grip handle is pointer-downed */
  const onGripPointerDown = useCallback((e: React.PointerEvent, trackIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    dragStartY.current = e.clientY;
    setDragIndex(trackIndex);
    setOverIndex(trackIndex);

    /* Snapshot row heights once so we can compute drop targets */
    const container = containerRef.current;
    if (container) {
      const rows = container.querySelectorAll<HTMLElement>('[data-track-row]');
      rowHeights.current = Array.from(rows).map(r => r.getBoundingClientRect().height);
    }

    const onMove = (ev: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      /* Compute which row the cursor is hovering over */
      const containerRect = container.getBoundingClientRect();
      /* Offset from top of the first track row (skip ruler header) */
      const relY = ev.clientY - containerRect.top - rulerHeight;

      let cumulative = 0;
      let hoverIdx   = 0;
      for (let i = 0; i < rowHeights.current.length; i++) {
        cumulative += rowHeights.current[i];
        if (relY < cumulative) { hoverIdx = i; break; }
        hoverIdx = i;
      }
      setOverIndex(Math.max(0, Math.min(rowHeights.current.length - 1, hoverIdx)));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      setDragIndex(prev => {
        setOverIndex(over => {
          if (prev !== null && over !== null && prev !== over) {
            reorderTracks(prev, over);
          }
          return null;
        });
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [rulerHeight, reorderTracks]);

  return (
    <div
      ref={containerRef}
      className="sticky left-0 z-20 bg-[#0e0e0e] border-r border-surface-300 flex-shrink-0"
      style={{ width: LABEL_WIDTH }}
    >
      {/* Ruler-height corner */}
      <div
        className="flex items-center justify-between px-3 border-b border-surface-300 bg-surface-100"
        style={{ height: rulerHeight }}
      >
        <span className="text-[9px] text-zinc-600 font-mono tracking-widest uppercase">Track</span>
        <button
          onClick={addTrack}
          title="Add track"
          className="p-0.5 rounded text-zinc-600 hover:text-white hover:bg-surface-300"
          style={{ transition: 'color var(--duration-fast)' }}
        >
          <Plus size={10} />
        </button>
      </div>

      {/* Track rows */}
      {Array.from({ length: totalTracks }).map((_, i) => {
        const track = tracks[i] ?? {
          id: i, name: `Track ${i + 1}`, color: '#22c55e',
          volume: 0.8, pan: 0, muted: false, soloed: false, armed: false, height: 72,
        };

        const isDragging = dragIndex === i;
        const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
        const dropAbove = isDropTarget && dragIndex !== null && dragIndex > i;
        const dropBelow = isDropTarget && dragIndex !== null && dragIndex < i;

        return (
          <TrackRow
            key={track.id}
            track={track}
            trackIndex={i}
            isDragging={isDragging}
            dropAbove={dropAbove}
            dropBelow={dropBelow}
            onGripPointerDown={onGripPointerDown}
            onToggleMute={() => toggleTrackMute(i)}
            onToggleSolo={() => toggleTrackSolo(i)}
            onToggleArm={() => toggleTrackArm(i)}
            onVolumeChange={v => setTrackVolume(i, v)}
            onPanChange={v => setTrackPan(i, v)}
            onNameChange={name => updateTrack(i, { name })}
            onColorChange={color => updateTrack(i, { color })}
          />
        );
      })}
    </div>
  );
});

/* ── Individual track row ───────────────────────────────────────────── */
const TrackRow = memo(function TrackRow({
  track,
  trackIndex,
  isDragging,
  dropAbove,
  dropBelow,
  onGripPointerDown,
  onToggleMute,
  onToggleSolo,
  onToggleArm,
  onVolumeChange,
  onPanChange,
  onNameChange,
  onColorChange,
}: {
  track:              TrackState;
  trackIndex:         number;
  isDragging:         boolean;
  dropAbove:          boolean;
  dropBelow:          boolean;
  onGripPointerDown:  (e: React.PointerEvent, index: number) => void;
  onToggleMute:       () => void;
  onToggleSolo:       () => void;
  onToggleArm:        () => void;
  onVolumeChange:     (v: number) => void;
  onPanChange:        (v: number) => void;
  onNameChange:       (name: string) => void;
  onColorChange:      (color: string) => void;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editing, setEditing]               = useState(false);
  const nameRef                              = useRef<HTMLInputElement>(null);
  const hasSolo = useTimelineStore(s => s.tracks.some(t => t.soloed));
  const dimmed  = hasSolo && !track.soloed;

  return (
    <div
      data-track-row
      className={[
        'relative border-b select-none transition-all',
        dimmed    ? 'opacity-40'    : '',
        isDragging ? 'opacity-50 bg-surface-200' : 'border-surface-300/40',
      ].join(' ')}
      style={{
        height:    track.height,
        minHeight: 40,
        /* Drop indicator lines */
        borderTop:    dropAbove ? '2px solid #22c55e' : undefined,
        borderBottom: dropBelow ? '2px solid #22c55e' : undefined,
      }}
    >
      {/* Color strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 cursor-pointer"
        style={{ backgroundColor: track.color }}
        onClick={() => setShowColorPicker(s => !s)}
        title="Click to change color"
      />

      {/* Color picker */}
      {showColorPicker && (
        <div className="absolute left-2 top-0 z-30 bg-surface-200 border border-surface-300 rounded-lg p-2 shadow-xl grid grid-cols-5 gap-1">
          {TRACK_COLORS.map(c => (
            <button
              key={c}
              className={`w-4 h-4 rounded-sm border-2 ${track.color === c ? 'border-white' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
              onClick={() => { onColorChange(c); setShowColorPicker(false); }}
            />
          ))}
        </div>
      )}

      <div className="flex items-stretch h-full">
        {/* ── Drag grip ─────────────────────────────────────────── */}
        <div
          className="flex items-center justify-center flex-shrink-0 cursor-grab active:cursor-grabbing hover:bg-surface-300/40 group"
          style={{ width: 16, paddingLeft: 2 }}
          onPointerDown={e => onGripPointerDown(e, trackIndex)}
          title="Drag to reorder track"
        >
          <GripVertical
            size={10}
            className="text-zinc-700 group-hover:text-zinc-400"
            style={{ transition: 'color var(--duration-fast)' }}
          />
        </div>

        {/* ── Track content ─────────────────────────────────────── */}
        <div className="flex flex-col justify-center pr-2 h-full gap-1 flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-zinc-700 font-mono w-3 flex-shrink-0">{trackIndex + 1}</span>
            {editing ? (
              <input
                ref={nameRef}
                defaultValue={track.name}
                className="flex-1 bg-surface-300 border border-brand-green-500/50 rounded px-1 text-xs text-white h-4 focus:outline-none"
                autoFocus
                onBlur={e => { onNameChange(e.target.value); setEditing(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    if (e.key === 'Enter') onNameChange((e.target as HTMLInputElement).value);
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <span
                className="flex-1 text-[11px] text-zinc-400 truncate cursor-pointer hover:text-white"
                onDoubleClick={() => setEditing(true)}
                title="Double-click to rename"
              >
                {track.name}
              </span>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-0.5">
            <TrackBtn onClick={onToggleMute} active={track.muted} activeColor="#f59e0b"
              title={track.muted ? 'Unmute (M)' : 'Mute (M)'} label="M" />
            <TrackBtn onClick={onToggleSolo} active={track.soloed} activeColor="#22c55e"
              title={track.soloed ? 'Unsolo' : 'Solo (S)'} label="S" />
            <TrackBtn onClick={onToggleArm} active={track.armed} activeColor="#ef4444"
              title={track.armed ? 'Disarm' : 'Arm'} label={<Mic size={8} />} />

            <div className="flex-1 flex items-center gap-1 ml-1">
              <Volume2 size={9} className="text-zinc-600 flex-shrink-0" />
              <MiniSlider
                value={track.volume} min={0} max={1}
                onChange={onVolumeChange} color={track.color}
                title={`Volume: ${Math.round(track.volume * 100)}%`}
              />
            </div>
          </div>

          {/* Pan (only if tall enough) */}
          {track.height >= 60 && (
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-700 w-4">Pan</span>
              <MiniSlider
                value={(track.pan + 1) / 2} min={0} max={1}
                onChange={v => onPanChange(v * 2 - 1)} color={track.color}
                title={`Pan: ${track.pan === 0 ? 'C' : `${track.pan > 0 ? 'R' : 'L'}${Math.abs(Math.round(track.pan * 100))}`}`}
                center
              />
              <span className="text-[8px] text-zinc-700 w-5 text-right tabular-nums">
                {track.pan === 0 ? 'C' : `${track.pan > 0 ? 'R' : 'L'}${Math.abs(Math.round(track.pan * 100))}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ── Minimal DAW track button ───────────────────────────────────────── */
function TrackBtn({
  onClick, active, activeColor, title, label,
}: {
  onClick:     () => void;
  active:      boolean;
  activeColor: string;
  title:       string;
  label:       React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-5 h-5 rounded text-[8px] font-bold flex items-center justify-center flex-shrink-0"
      style={{
        backgroundColor: active ? `${activeColor}25` : 'rgba(255,255,255,0.04)',
        color:           active ? activeColor : '#52525b',
        border:          `1px solid ${active ? `${activeColor}60` : 'transparent'}`,
        transition:      'background-color var(--duration-fast), color var(--duration-fast)',
      }}
    >
      {label}
    </button>
  );
}

/* ── Mini horizontal slider ─────────────────────────────────────────── */
function MiniSlider({
  value, min, max, onChange, color, title, center,
}: {
  value:    number;
  min:      number;
  max:      number;
  onChange: (v: number) => void;
  color:    string;
  title?:   string;
  center?:  boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = trackRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);

    const update = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      onChange(min + pct * (max - min));
    };
    update(e.nativeEvent);

    const onMove = (ev: PointerEvent) => update(ev);
    const onUp   = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [min, max, onChange]);

  const pct = (value - min) / (max - min);

  return (
    <div
      ref={trackRef}
      className="relative flex-1 h-2 rounded-full cursor-ew-resize"
      style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
      onPointerDown={handlePointer}
      title={title}
    >
      {center ? (
        <>
          <div
            className="absolute top-0 bottom-0 rounded-full"
            style={{
              left:            pct < 0.5 ? `${pct * 100}%` : '50%',
              right:           pct > 0.5 ? `${(1 - pct) * 100}%` : '50%',
              backgroundColor: `${color}80`,
            }}
          />
          <div className="absolute top-0 bottom-0 w-px bg-zinc-600" style={{ left: '50%' }} />
        </>
      ) : (
        <div
          className="absolute top-0 left-0 bottom-0 rounded-full"
          style={{ width: `${pct * 100}%`, backgroundColor: `${color}80` }}
        />
      )}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-surface-300"
        style={{ left: `calc(${pct * 100}% - 4px)`, backgroundColor: color }}
      />
    </div>
  );
}
