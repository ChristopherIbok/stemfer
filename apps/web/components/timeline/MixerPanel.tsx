'use client';

import { memo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { useTimelineStore, TrackState } from '@/store/useTimelineStore';

export const MixerPanel = memo(function MixerPanel() {
  const {
    tracks, showMixer,
    setShowMixer, setTrackVolume, setTrackPan,
    toggleTrackMute, toggleTrackSolo, toggleTrackArm,
  } = useTimelineStore();

  if (!showMixer) return null;

  return (
    <div
      className="border-t border-surface-300 bg-[#0a0a0a] flex-shrink-0 flex flex-col"
      style={{ height: 220 }}
    >
      {/* Mixer header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-300 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Mixer</span>
          <span className="text-[9px] text-zinc-700">{tracks.length} channels</span>
        </div>
        <button
          onClick={() => setShowMixer(false)}
          className="p-1 rounded text-zinc-600 hover:text-white hover:bg-surface-300"
          style={{ transition: 'color var(--duration-fast)' }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Channel strips */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-px bg-surface-300">
          {tracks.map(track => (
            <ChannelStrip
              key={track.id}
              track={track}
              onVolumeChange={v => setTrackVolume(track.id, v)}
              onPanChange={v => setTrackPan(track.id, v)}
              onMute={() => toggleTrackMute(track.id)}
              onSolo={() => toggleTrackSolo(track.id)}
              onArm={() => toggleTrackArm(track.id)}
            />
          ))}

          {/* Master bus */}
          <MasterStrip />
        </div>
      </div>
    </div>
  );
});

/* ── Channel strip ──────────────────────────────────────────────────── */
const ChannelStrip = memo(function ChannelStrip({
  track,
  onVolumeChange,
  onPanChange,
  onMute,
  onSolo,
  onArm,
}: {
  track:           TrackState;
  onVolumeChange: (v: number) => void;
  onPanChange:    (v: number) => void;
  onMute:         () => void;
  onSolo:         () => void;
  onArm:          () => void;
}) {
  const hasSolo = useTimelineStore(s => s.tracks.some(t => t.soloed));
  const dimmed  = hasSolo && !track.soloed;

  return (
    <div
      className={`flex flex-col items-center bg-[#0e0e0e] px-1.5 pb-2 flex-shrink-0 transition-opacity ${dimmed ? 'opacity-40' : ''}`}
      style={{ width: 56, borderLeft: `2px solid ${track.color}40` }}
    >
      {/* Track name */}
      <div className="w-full py-1 overflow-hidden">
        <p className="text-[8px] text-center truncate" style={{ color: track.color }}>
          {track.name}
        </p>
      </div>

      {/* Pan knob */}
      <PanKnob value={track.pan} onChange={onPanChange} color={track.color} />

      {/* M / S / A buttons */}
      <div className="flex gap-0.5 mt-1">
        <MixerBtn
          label="M" active={track.muted}
          color="#f59e0b" onClick={onMute}
          title="Mute"
        />
        <MixerBtn
          label="S" active={track.soloed}
          color="#22c55e" onClick={onSolo}
          title="Solo"
        />
        <MixerBtn
          label="A" active={track.armed}
          color="#ef4444" onClick={onArm}
          title="Arm"
        />
      </div>

      {/* Fader */}
      <VerticalFader
        value={track.volume}
        onChange={onVolumeChange}
        color={track.color}
      />

      {/* Level meter */}
      <LevelMeter active={!track.muted && !(hasSolo && !track.soloed)} color={track.color} />

      {/* Volume readout */}
      <span className="text-[8px] text-zinc-600 tabular-nums mt-0.5">
        {Math.round(track.volume * 100)}
      </span>
    </div>
  );
});

/* ── Master bus strip ───────────────────────────────────────────────── */
function MasterStrip() {
  return (
    <div className="flex flex-col items-center bg-[#111] px-1.5 pb-2 flex-shrink-0 ml-1"
      style={{ width: 56, borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
      <div className="py-1">
        <p className="text-[8px] text-center text-zinc-500">Master</p>
      </div>
      <PanKnob value={0} onChange={() => {}} color="#6b7280" disabled />
      <div className="flex gap-0.5 mt-1" style={{ height: 16 }} />
      <VerticalFader value={1} onChange={() => {}} color="#6b7280" />
      <LevelMeter active color="#6b7280" />
      <span className="text-[8px] text-zinc-600 tabular-nums mt-0.5">100</span>
    </div>
  );
}

/* ── Pan knob ───────────────────────────────────────────────────────── */
function PanKnob({
  value, onChange, color, disabled,
}: {
  value:    number;
  onChange: (v: number) => void;
  color:    string;
  disabled?: boolean;
}) {
  const startY = useRef<number | null>(null);
  const startV = useRef(value);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startV.current = value;

    const onMove = (ev: PointerEvent) => {
      if (startY.current === null) return;
      const delta = (startY.current - ev.clientY) / 60;
      onChange(Math.max(-1, Math.min(1, startV.current + delta)));
    };
    const onUp = () => {
      startY.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [value, onChange, disabled]);

  /* Rotation: -135° (full left) to +135° (full right), 0° = center */
  const deg = value * 135;
  const tip_x = 8 + 7 * Math.sin((deg * Math.PI) / 180);
  const tip_y = 8 - 7 * Math.cos((deg * Math.PI) / 180);

  return (
    <div
      className={`relative mt-1 ${disabled ? 'opacity-30' : 'cursor-ns-resize'}`}
      style={{ width: 20, height: 20 }}
      onPointerDown={onPointerDown}
      title={`Pan: ${value === 0 ? 'C' : `${value > 0 ? 'R' : 'L'}${Math.abs(Math.round(value * 100))}`}`}
    >
      <svg width="20" height="20" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" fill="#1a1a1a" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        <line x1="8" y1="8" x2={tip_x} y2={tip_y} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ── Vertical fader ─────────────────────────────────────────────────── */
function VerticalFader({
  value, onChange, color,
}: {
  value:    number;
  onChange: (v: number) => void;
  color:    string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const H        = 80;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = 1 - Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      onChange(pct);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onChange]);

  const thumbTop = (1 - value) * (H - 12);

  return (
    <div
      ref={trackRef}
      className="relative flex justify-center mt-2 cursor-ns-resize"
      style={{ width: 16, height: H }}
      onPointerDown={onPointerDown}
    >
      {/* Track */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: 3, height: H, backgroundColor: 'rgba(255,255,255,0.07)' }}
      />
      {/* Fill */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full bottom-0"
        style={{ width: 3, height: value * H, backgroundColor: `${color}60` }}
      />
      {/* Unity mark (0 dB) */}
      <div
        className="absolute left-0 right-0 h-px"
        style={{ top: (1 - 0.8) * H, backgroundColor: 'rgba(255,255,255,0.15)' }}
      />
      {/* Thumb */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-sm shadow-md"
        style={{
          width:           14,
          height:          10,
          top:             thumbTop,
          backgroundColor: '#2a2a2a',
          border:          `1px solid ${color}80`,
        }}
      />
    </div>
  );
}

/* ── Level meter ────────────────────────────────────────────────────── */
function LevelMeter({ active, color }: { active: boolean; color: string }) {
  /* Decorative static meter — real metering needs Web Audio AnalyserNode */
  const bars = 8;
  return (
    <div className="flex gap-px mt-1 items-end" style={{ height: 20 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const pct   = i / (bars - 1);
        const lit   = active && pct < 0.65;
        const warn  = active && pct >= 0.65 && pct < 0.85;
        const clip  = active && pct >= 0.85;
        return (
          <div
            key={i}
            style={{
              width:           2,
              height:          `${30 + i * 8}%`,
              backgroundColor: clip  ? '#ef4444'
                             : warn  ? '#f59e0b'
                             : lit   ? color
                             : 'rgba(255,255,255,0.06)',
              borderRadius:    1,
              opacity:         active ? 0.8 : 0.2,
              transition:      'background-color 0.1s',
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Tiny mixer button ──────────────────────────────────────────────── */
function MixerBtn({
  label, active, color, onClick, title,
}: {
  label:   string;
  active:  boolean;
  color:   string;
  onClick: () => void;
  title:   string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="text-[7px] font-bold rounded flex items-center justify-center"
      style={{
        width:           14,
        height:          14,
        backgroundColor: active ? `${color}30` : 'rgba(255,255,255,0.04)',
        color:           active ? color : '#52525b',
        border:          `1px solid ${active ? `${color}60` : 'transparent'}`,
        transition:      'background-color var(--duration-fast)',
      }}
    >
      {label}
    </button>
  );
}
