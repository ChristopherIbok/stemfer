'use client';

import { memo, useCallback } from 'react';
import {
  SkipBack, Play, Pause, Square, Circle,
  Repeat, Music, Undo2, Redo2, Save,
  Grid3x3, ChevronDown, Cpu, Timer,
  ZoomIn, ZoomOut, MousePointer2, Scissors, Hand,
} from 'lucide-react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { msToTimecode, msToPx, pxToMs } from '@stemfer/shared/utils/timecode';

const TIME_SIGS = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];
const QUANTIZE  = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];

interface TransportBarProps {
  onSave:      () => void;
  isSaving:    boolean;
  totalTracks: number;
}

export const TransportBar = memo(function TransportBar({
  onSave, isSaving,
}: TransportBarProps) {
  const {
    isPlaying, isRecording, playheadMs,
    loopEnabled, metronomeEnabled,
    bpm, timeSig, snapEnabled, quantizeValue,
    zoom, cpuLoad, latencyMs,
    showMixer, showRightPanel,
    toolMode,
    setPlaying, setRecording, setPlayhead,
    setLoop, setMetronome,
    setBpm, setTimeSig, setSnap, setQuantize,
    setZoom, setScroll,
    setShowMixer, setShowRightPanel,
    setToolMode,
    undo, redo,
  } = useTimelineStore();

  const stop = useCallback(() => {
    setPlaying(false);
    setRecording(false);
    setPlayhead(0);
  }, [setPlaying, setRecording, setPlayhead]);

  const toggleRecord = useCallback(() => {
    setRecording(!isRecording);
    if (!isRecording && !isPlaying) setPlaying(true);
  }, [isRecording, isPlaying, setRecording, setPlaying]);

  const zoomIn  = useCallback(() => setZoom(zoom * 1.4), [zoom, setZoom]);
  const zoomOut = useCallback(() => setZoom(zoom / 1.4), [zoom, setZoom]);

  return (
    <div
      className="flex items-center gap-0 px-2 border-b border-surface-300 bg-surface-100 flex-shrink-0 overflow-x-auto"
      style={{ height: 44, minHeight: 44 }}
    >
      {/* ── Transport buttons ──────────────────────────────────── */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-surface-300 mr-2 flex-shrink-0">
        {/* Return to start */}
        <TBtn onClick={() => { setPlayhead(0); setPlaying(false); }} title="Return to start (Home)">
          <SkipBack size={13} />
        </TBtn>

        {/* Stop */}
        <TBtn onClick={stop} title="Stop (Space → play, Home → stop)" active={!isPlaying && !isRecording}>
          <Square size={12} />
        </TBtn>

        {/* Play / Pause */}
        <button
          onClick={() => setPlaying(!isPlaying)}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className={`
            h-7 w-7 rounded flex items-center justify-center flex-shrink-0
            ${isPlaying
              ? 'bg-brand-green-500 text-black'
              : 'bg-brand-green-500/20 text-brand-green-400 hover:bg-brand-green-500/30'}
          `}
          style={{ transition: 'background-color var(--duration-fast)' }}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>

        {/* Record */}
        <button
          onClick={toggleRecord}
          title="Record (R)"
          className={`
            h-7 w-7 rounded flex items-center justify-center flex-shrink-0
            ${isRecording
              ? 'bg-red-500 text-white animate-pulse'
              : 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10'}
          `}
          style={{ transition: 'background-color var(--duration-fast)' }}
        >
          <Circle size={12} />
        </button>
      </div>

      {/* ── Timecode display ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <span
          className="timecode text-sm tabular-nums select-text"
          style={{ minWidth: 96, letterSpacing: '0.04em' }}
        >
          {msToTimecode(playheadMs)}
        </span>
      </div>

      {/* ── Loop & Metronome ───────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <TBtn
          onClick={() => setLoop(!loopEnabled)}
          title="Loop (L)"
          active={loopEnabled}
          activeColor="text-brand-green-400"
        >
          <Repeat size={13} />
        </TBtn>
        <TBtn
          onClick={() => setMetronome(!metronomeEnabled)}
          title="Metronome"
          active={metronomeEnabled}
          activeColor="text-brand-green-400"
        >
          <Music size={13} />
        </TBtn>
      </div>

      {/* ── BPM ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest">BPM</span>
        <input
          type="number"
          value={bpm}
          onChange={e => setBpm(parseFloat(e.target.value) || 120)}
          className="w-12 bg-surface-200 border border-surface-300 rounded text-xs text-white text-center h-6 focus:outline-none focus:ring-1 focus:ring-brand-green-500"
          min={20}
          max={400}
          step={0.1}
        />
      </div>

      {/* ── Time signature ────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest">SIG</span>
        <div className="relative">
          <select
            value={timeSig}
            onChange={e => setTimeSig(e.target.value)}
            className="appearance-none bg-surface-200 border border-surface-300 rounded text-xs text-white pl-2 pr-5 h-6 focus:outline-none focus:ring-1 focus:ring-brand-green-500 cursor-pointer"
          >
            {TIME_SIGS.map(sig => (
              <option key={sig} value={sig}>{sig}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {/* ── Snap & Quantize ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <button
          onClick={() => setSnap(!snapEnabled)}
          title="Snap to grid"
          className={`flex items-center gap-1 text-[10px] px-1.5 h-6 rounded font-medium ${
            snapEnabled ? 'bg-brand-green-500/20 text-brand-green-400' : 'text-zinc-600 hover:text-white hover:bg-surface-300'
          }`}
          style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
        >
          <Grid3x3 size={11} />
          Snap
        </button>

        <div className="relative">
          <select
            value={quantizeValue}
            onChange={e => setQuantize(e.target.value)}
            className="appearance-none bg-surface-200 border border-surface-300 rounded text-[10px] text-zinc-400 pl-1.5 pr-4 h-6 focus:outline-none cursor-pointer"
          >
            {QUANTIZE.map(q => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <ChevronDown size={9} className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
        </div>
      </div>

      {/* ── Zoom ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <TBtn onClick={zoomOut} title="Zoom out (⌘-)">
          <ZoomOut size={12} />
        </TBtn>
        <TBtn onClick={zoomIn} title="Zoom in (⌘+)">
          <ZoomIn size={12} />
        </TBtn>
        <button
          onClick={() => { /* fit handled in engine */ useTimelineStore.setState({ zoom: 0.05 }); }}
          className="text-[10px] px-1.5 h-6 rounded text-zinc-500 hover:text-white hover:bg-surface-300"
          style={{ transition: 'background-color var(--duration-fast)' }}
          title="Fit to window"
        >
          Fit
        </button>
      </div>

      {/* ── Undo / Redo ───────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <TBtn onClick={undo} title="Undo (⌘Z)"><Undo2 size={12} /></TBtn>
        <TBtn onClick={redo} title="Redo (⌘⇧Z)"><Redo2 size={12} /></TBtn>
      </div>

      {/* ── Tool modes ────────────────────────────────────────── */}
      <div className="flex items-center gap-0 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <ToolModeBtn
          mode="pointer"
          current={toolMode}
          onSelect={setToolMode}
          title="Select / Move (V)"
        >
          <MousePointer2 size={12} />
        </ToolModeBtn>
        <ToolModeBtn
          mode="razor"
          current={toolMode}
          onSelect={setToolMode}
          title="Razor / Cut (B)"
        >
          <Scissors size={12} />
        </ToolModeBtn>
        <ToolModeBtn
          mode="hand"
          current={toolMode}
          onSelect={setToolMode}
          title="Hand / Scroll (H)"
        >
          <Hand size={12} />
        </ToolModeBtn>
      </div>

      {/* ── Save ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 border-r border-surface-300 mr-2 flex-shrink-0">
        <button
          onClick={onSave}
          disabled={isSaving}
          title="Save (⌘S)"
          className="flex items-center gap-1 text-[10px] h-6 px-2 rounded bg-surface-200 border border-surface-300 text-zinc-400 hover:text-white hover:border-surface-400 disabled:opacity-40"
          style={{ transition: 'color var(--duration-fast), border-color var(--duration-fast)' }}
        >
          <Save size={11} />
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── Spacer ────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── CPU / Latency ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-2 flex-shrink-0">
        <div className="flex items-center gap-1" title="CPU load">
          <Cpu size={10} className="text-zinc-600" />
          <div className="flex items-end gap-px h-3">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="w-0.5 rounded-sm"
                style={{
                  height:      `${Math.min(100, (i / 7) * 100) <= cpuLoad ? 100 : 30}%`,
                  backgroundColor: cpuLoad > 80 ? '#ef4444' : cpuLoad > 60 ? '#f59e0b' : '#22c55e',
                  opacity:     (i / 7) * 100 <= cpuLoad ? 0.9 : 0.15,
                }}
              />
            ))}
          </div>
          <span className="text-[9px] text-zinc-600 tabular-nums w-6">{cpuLoad.toFixed(0)}%</span>
        </div>

        <div className="flex items-center gap-1" title="Latency">
          <Timer size={10} className="text-zinc-600" />
          <span className="text-[9px] text-zinc-600 tabular-nums">{latencyMs.toFixed(1)}ms</span>
        </div>
      </div>

      {/* ── Panel toggles ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 border-l border-surface-300 ml-1 flex-shrink-0">
        <TBtn
          onClick={() => setShowMixer(!showMixer)}
          active={showMixer}
          title="Mixer (M)"
          activeColor="text-brand-green-400"
        >
          <span className="text-[9px] font-bold tracking-widest">MIX</span>
        </TBtn>
        <TBtn
          onClick={() => setShowRightPanel(!showRightPanel)}
          active={showRightPanel}
          title="Inspector (I)"
          activeColor="text-brand-green-400"
        >
          <span className="text-[9px] font-bold tracking-widest">INS</span>
        </TBtn>
      </div>
    </div>
  );
});

/* ── Tool mode button ───────────────────────────────────────────────── */
function ToolModeBtn({
  children, mode, current, onSelect, title,
}: {
  children: React.ReactNode;
  mode: 'pointer' | 'razor' | 'hand';
  current: 'pointer' | 'razor' | 'hand';
  onSelect: (m: 'pointer' | 'razor' | 'hand') => void;
  title?: string;
}) {
  const active = current === mode;
  return (
    <button
      onClick={() => onSelect(mode)}
      title={title}
      className={`
        h-7 w-7 rounded flex items-center justify-center flex-shrink-0
        ${active
          ? 'bg-brand-green-500/20 text-brand-green-400 ring-1 ring-brand-green-500/40'
          : 'text-zinc-500 hover:text-white hover:bg-surface-300'}
      `}
      style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
    >
      {children}
    </button>
  );
}

/* ── Small toolbar button ───────────────────────────────────────────── */
function TBtn({
  children,
  onClick,
  title,
  active,
  activeColor = 'text-white',
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`
        h-7 w-7 rounded flex items-center justify-center flex-shrink-0
        disabled:opacity-30 disabled:cursor-not-allowed
        ${active
          ? `bg-surface-300 ${activeColor}`
          : 'text-zinc-500 hover:text-white hover:bg-surface-300'}
      `}
      style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
    >
      {children}
    </button>
  );
}
