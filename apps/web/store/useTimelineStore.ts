'use client';
import { create } from 'zustand';
import { snapToGrid, msToTimecode } from '@stemfer/shared/utils/timecode';
import type { TimelineClip } from '@stemfer/shared/types';

/* ── Per-track mixer state ──────────────────────────────────────────── */
export interface TrackState {
  id:       number;
  name:     string;
  color:    string;
  volume:   number;   // 0–1
  pan:      number;   // -1 to +1
  muted:    boolean;
  soloed:   boolean;
  armed:    boolean;
  monitor:  boolean;
  height:   number;   // px
  collapsed: boolean;
  fxSlots:  string[]; // plugin IDs (future)
}

/* ── Automation point ───────────────────────────────────────────────── */
export interface AutomationPoint {
  ms:    number;
  value: number; // 0–1 normalized
}

export interface AutomationLane {
  trackId: number;
  param:   'volume' | 'pan';
  points:  AutomationPoint[];
  visible: boolean;
}

/* ── Marker ─────────────────────────────────────────────────────────── */
export interface Marker {
  id:    string;
  ms:    number;
  label: string;
  color: string;
}

/* ── History snapshot ───────────────────────────────────────────────── */
interface HistorySnapshot {
  clips:  TimelineClip[];
  tracks: TrackState[];
}

const TRACK_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f97316', '#ef4444',
];

function defaultTrack(id: number): TrackState {
  return {
    id,
    name:      `Track ${id + 1}`,
    color:     TRACK_COLORS[id % TRACK_COLORS.length],
    volume:    0.8,
    pan:       0,
    muted:     false,
    soloed:    false,
    armed:     false,
    monitor:   false,
    height:    72,
    collapsed: false,
    fxSlots:   [],
  };
}

/* ── Store interface ────────────────────────────────────────────────── */
interface TimelineState {
  /* Clips */
  clips:             TimelineClip[];
  selectedClipIds:   Set<string>;

  /* Tracks */
  tracks:            TrackState[];
  totalTracks:       number;

  /* Transport */
  isPlaying:         boolean;
  isRecording:       boolean;
  playheadMs:        number;
  loopEnabled:       boolean;
  loopStartMs:       number;
  loopEndMs:         number;
  metronomeEnabled:  boolean;
  punchIn:           boolean;
  punchInMs:         number;
  punchOutMs:        number;

  /* Grid & timing */
  bpm:               number;
  timeSig:           string;   // e.g. '4/4'
  zoom:              number;
  scrollMs:          number;
  snapEnabled:       boolean;
  snapSubdivision:   number;   // 1 = beat, 0.25 = 16th, etc.
  quantizeValue:     string;   // '1/4', '1/8', '1/16', '1/32'

  /* Markers */
  markers:           Marker[];

  /* Automation */
  automationLanes:   AutomationLane[];
  showAutomation:    boolean;

  /* Tool mode */
  toolMode:          'pointer' | 'razor' | 'hand';

  /* UI panels */
  showMixer:         boolean;
  showRightPanel:    boolean;
  rightPanelTab:     'inspector' | 'fx' | 'automation';
  mixerVisible:      boolean;

  /* CPU / latency (updated externally by audio engine) */
  cpuLoad:           number;   // 0–100
  latencyMs:         number;

  /* History */
  history:           HistorySnapshot[];
  historyIndex:      number;

  /* Actions — clips */
  setClips:          (clips: TimelineClip[]) => void;
  addClip:           (clip: TimelineClip) => void;
  updateClip:        (fileId: string, patch: Partial<TimelineClip>) => void;
  selectClip:        (id: string | null, additive?: boolean) => void;
  selectClips:       (ids: string[]) => void;
  moveClip:          (fileId: string, newOffsetMs: number, newTrack?: number) => void;
  splitClip:         (fileId: string, atMs: number) => void;
  duplicateClips:    (fileIds: string[]) => void;
  deleteClips:       (fileIds: string[]) => void;
  toggleMute:        (fileId: string) => void;
  toggleLock:        (fileId: string) => void;
  groupClips:        (fileIds: string[]) => void;
  ungroupClips:      (groupId: string) => void;

  /* Actions — tracks */
  addTrack:          () => void;
  updateTrack:       (id: number, patch: Partial<TrackState>) => void;
  setTrackVolume:    (id: number, v: number) => void;
  setTrackPan:       (id: number, v: number) => void;
  toggleTrackMute:   (id: number) => void;
  toggleTrackSolo:   (id: number) => void;
  toggleTrackArm:    (id: number) => void;
  resizeTrack:       (id: number, height: number) => void;

  /* Actions — transport */
  setPlaying:        (v: boolean) => void;
  setRecording:      (v: boolean) => void;
  setPlayhead:       (ms: number) => void;
  setLoop:           (enabled: boolean, startMs?: number, endMs?: number) => void;
  setMetronome:      (v: boolean) => void;
  setPunchIn:        (enabled: boolean, inMs?: number, outMs?: number) => void;

  /* Actions — grid */
  setZoom:           (zoom: number) => void;
  setScroll:         (ms: number) => void;
  setBpm:            (bpm: number) => void;
  setTimeSig:        (sig: string) => void;
  setSnap:           (enabled: boolean) => void;
  setSnapSubdivision:(v: number) => void;
  setQuantize:       (v: string) => void;

  /* Actions — markers */
  addMarker:         (ms: number, label?: string) => void;
  removeMarker:      (id: string) => void;

  /* Actions — automation */
  addAutomationPoint:(trackId: number, param: AutomationLane['param'], ms: number, value: number) => void;
  toggleAutomation:  (trackId: number, param: AutomationLane['param']) => void;
  setShowAutomation: (v: boolean) => void;

  /* Actions — UI */
  setToolMode:       (mode: 'pointer' | 'razor' | 'hand') => void;
  setShowMixer:      (v: boolean) => void;
  setShowRightPanel: (v: boolean) => void;
  setRightPanelTab:  (tab: 'inspector' | 'fx' | 'automation') => void;
  setCpuLoad:        (v: number) => void;
  setLatency:        (v: number) => void;

  /* Actions — track order */
  reorderTracks:     (fromIndex: number, toIndex: number) => void;

  /* Actions — history */
  undo:              () => void;
  redo:              () => void;
  pushHistory:       () => void;
}

/* ── Store implementation ───────────────────────────────────────────── */
export const useTimelineStore = create<TimelineState>((set, get) => ({
  clips:            [],
  selectedClipIds:  new Set(),

  tracks:           Array.from({ length: 8 }, (_, i) => defaultTrack(i)),
  totalTracks:      8,

  isPlaying:        false,
  isRecording:      false,
  playheadMs:       0,
  loopEnabled:      false,
  loopStartMs:      0,
  loopEndMs:        8000,
  metronomeEnabled: false,
  punchIn:          false,
  punchInMs:        0,
  punchOutMs:       0,

  bpm:              120,
  timeSig:          '4/4',
  zoom:             0.05,
  scrollMs:         0,
  snapEnabled:      true,
  snapSubdivision:  1,
  quantizeValue:    '1/4',

  markers:          [],
  automationLanes:  [],
  showAutomation:   false,

  toolMode:         'pointer',

  showMixer:        false,
  showRightPanel:   false,
  rightPanelTab:    'inspector',
  mixerVisible:     false,

  cpuLoad:          0,
  latencyMs:        0,

  history:          [],
  historyIndex:     -1,

  /* ── Clips ─────────────────────────────────────────────────────── */
  setClips(clips) {
    set(s => {
      const needed = Math.max(s.totalTracks, ...clips.map(c => c.track + 1), 8);
      const tracks = needed > s.tracks.length
        ? [...s.tracks, ...Array.from({ length: needed - s.tracks.length }, (_, i) => defaultTrack(s.tracks.length + i))]
        : s.tracks;
      return { clips, tracks, totalTracks: tracks.length };
    });
  },

  addClip(clip) {
    set(s => ({ clips: [...s.clips, clip] }));
  },

  updateClip(fileId, patch) {
    set(s => ({ clips: s.clips.map(c => c.fileId === fileId ? { ...c, ...patch } : c) }));
  },

  selectClip(id, additive = false) {
    set(s => {
      if (id === null) return { selectedClipIds: new Set() };
      if (additive) {
        const next = new Set(s.selectedClipIds);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selectedClipIds: next };
      }
      return { selectedClipIds: new Set([id]) };
    });
  },

  selectClips(ids) {
    set({ selectedClipIds: new Set(ids) });
  },

  moveClip(fileId, newOffsetMs, newTrack) {
    const { snapEnabled, bpm, snapSubdivision } = get();
    const snapped  = snapEnabled ? snapToGrid(newOffsetMs, bpm, snapSubdivision) : newOffsetMs;
    const offsetMs = Math.max(0, snapped);

    set(s => ({
      clips: s.clips.map(c => {
        if (c.fileId !== fileId) {
          const movedClip = s.clips.find(x => x.fileId === fileId);
          if (movedClip?.groupId && c.groupId === movedClip.groupId) {
            const delta = offsetMs - movedClip.offsetMs;
            return { ...c, offsetMs: Math.max(0, c.offsetMs + delta) };
          }
          return c;
        }
        return {
          ...c,
          offsetMs,
          startTimecode: msToTimecode(offsetMs),
          ...(newTrack !== undefined ? { track: newTrack } : {}),
        };
      }),
    }));
  },

  splitClip(fileId, atMs) {
    const clip = get().clips.find(c => c.fileId === fileId);
    if (!clip || atMs <= clip.offsetMs || atMs >= clip.offsetMs + clip.durationMs) return;

    const leftDuration  = atMs - clip.offsetMs;
    const rightDuration = clip.durationMs - leftDuration;
    const splitPoint    = leftDuration / clip.durationMs;

    const left: TimelineClip = {
      ...clip,
      durationMs:   leftDuration,
      waveformData: clip.waveformData.slice(0, Math.floor(clip.waveformData.length * splitPoint)),
    };
    const right: TimelineClip = {
      ...clip,
      fileId:        `${clip.fileId}_split_${Date.now()}`,
      offsetMs:      atMs,
      startTimecode: msToTimecode(atMs),
      durationMs:    rightDuration,
      waveformData:  clip.waveformData.slice(Math.floor(clip.waveformData.length * splitPoint)),
    };

    set(s => ({ clips: s.clips.map(c => c.fileId === fileId ? left : c).concat(right) }));
  },

  duplicateClips(fileIds) {
    const clips = get().clips.filter(c => fileIds.includes(c.fileId));
    const offset = 500;
    const dupes = clips.map(c => ({
      ...c,
      fileId:   `${c.fileId}_dup_${Date.now()}`,
      offsetMs: c.offsetMs + offset,
    }));
    set(s => ({ clips: [...s.clips, ...dupes] }));
  },

  deleteClips(fileIds) {
    set(s => ({ clips: s.clips.filter(c => !fileIds.includes(c.fileId)), selectedClipIds: new Set() }));
  },

  toggleMute(fileId) {
    set(s => ({ clips: s.clips.map(c => c.fileId === fileId ? { ...c, isMuted: !c.isMuted } : c) }));
  },

  toggleLock(fileId) {
    set(s => ({ clips: s.clips.map(c => c.fileId === fileId ? { ...c, isLocked: !c.isLocked } : c) }));
  },

  groupClips(fileIds) {
    const groupId = crypto.randomUUID();
    set(s => ({ clips: s.clips.map(c => fileIds.includes(c.fileId) ? { ...c, groupId } : c) }));
  },

  ungroupClips(groupId) {
    set(s => ({ clips: s.clips.map(c => c.groupId === groupId ? { ...c, groupId: undefined } : c) }));
  },

  /* ── Tracks ────────────────────────────────────────────────────── */
  addTrack() {
    set(s => {
      const id     = s.tracks.length;
      const tracks = [...s.tracks, defaultTrack(id)];
      return { tracks, totalTracks: tracks.length };
    });
  },

  updateTrack(id, patch) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, ...patch } : t) }));
  },

  setTrackVolume(id, v) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, volume: Math.max(0, Math.min(1, v)) } : t) }));
  },

  setTrackPan(id, v) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, pan: Math.max(-1, Math.min(1, v)) } : t) }));
  },

  toggleTrackMute(id) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, muted: !t.muted } : t) }));
  },

  toggleTrackSolo(id) {
    set(s => {
      const wasSoloed = s.tracks.find(t => t.id === id)?.soloed ?? false;
      return { tracks: s.tracks.map(t => t.id === id ? { ...t, soloed: !wasSoloed } : t) };
    });
  },

  toggleTrackArm(id) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, armed: !t.armed } : t) }));
  },

  resizeTrack(id, height) {
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, height: Math.max(40, Math.min(200, height)) } : t) }));
  },

  reorderTracks(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    set(s => {
      /* Reorder the track array */
      const next = [...s.tracks];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      /* Build a mapping: old track index → new track index */
      const oldIds = s.tracks.map(t => t.id);
      const newIds  = next.map(t => t.id);
      const remap   = new Map<number, number>();
      oldIds.forEach((id, oldIdx) => {
        const newIdx = newIds.indexOf(id);
        remap.set(oldIdx, newIdx);
      });

      /* Re-assign clip.track values to follow their track */
      const clips = s.clips.map(c => ({
        ...c,
        track: remap.get(c.track) ?? c.track,
      }));

      return { tracks: next, clips };
    });
  },

  /* ── Transport ─────────────────────────────────────────────────── */
  setPlaying(v)    { set({ isPlaying: v }); },
  setRecording(v)  { set({ isRecording: v }); },
  setPlayhead(ms)  { set({ playheadMs: Math.max(0, ms) }); },

  setLoop(enabled, startMs, endMs) {
    set(s => ({
      loopEnabled: enabled,
      loopStartMs: startMs ?? s.loopStartMs,
      loopEndMs:   endMs   ?? s.loopEndMs,
    }));
  },

  setMetronome(v) { set({ metronomeEnabled: v }); },

  setPunchIn(enabled, inMs, outMs) {
    set(s => ({
      punchIn:    enabled,
      punchInMs:  inMs  ?? s.punchInMs,
      punchOutMs: outMs ?? s.punchOutMs,
    }));
  },

  /* ── Grid ──────────────────────────────────────────────────────── */
  setZoom(zoom)   { set({ zoom: Math.max(0.003, Math.min(zoom, 4)) }); },
  setScroll(ms)   { set({ scrollMs: Math.max(0, ms) }); },
  setBpm(bpm)     { set({ bpm: Math.max(20, Math.min(bpm, 400)) }); },
  setTimeSig(sig) { set({ timeSig: sig }); },
  setSnap(v)      { set({ snapEnabled: v }); },
  setSnapSubdivision(v) { set({ snapSubdivision: v }); },
  setQuantize(v)  { set({ quantizeValue: v }); },

  /* ── Markers ───────────────────────────────────────────────────── */
  addMarker(ms, label) {
    set(s => ({
      markers: [...s.markers, {
        id:    crypto.randomUUID(),
        ms,
        label: label ?? `M${s.markers.length + 1}`,
        color: '#f59e0b',
      }],
    }));
  },
  removeMarker(id) {
    set(s => ({ markers: s.markers.filter(m => m.id !== id) }));
  },

  /* ── Automation ────────────────────────────────────────────────── */
  addAutomationPoint(trackId, param, ms, value) {
    set(s => {
      const lanes = [...s.automationLanes];
      let lane    = lanes.find(l => l.trackId === trackId && l.param === param);
      if (!lane) {
        lane = { trackId, param, points: [], visible: true };
        lanes.push(lane);
      }
      lane.points = [...lane.points, { ms, value }].sort((a, b) => a.ms - b.ms);
      return { automationLanes: lanes };
    });
  },

  toggleAutomation(trackId, param) {
    set(s => {
      const lanes = s.automationLanes.map(l =>
        l.trackId === trackId && l.param === param ? { ...l, visible: !l.visible } : l
      );
      const exists = lanes.some(l => l.trackId === trackId && l.param === param);
      if (!exists) lanes.push({ trackId, param, points: [], visible: true });
      return { automationLanes: lanes };
    });
  },

  setShowAutomation(v) { set({ showAutomation: v }); },

  /* ── UI ────────────────────────────────────────────────────────── */
  setToolMode(mode)     { set({ toolMode: mode }); },
  setShowMixer(v)       { set({ showMixer: v }); },
  setShowRightPanel(v)  { set({ showRightPanel: v }); },
  setRightPanelTab(tab) { set({ rightPanelTab: tab }); },
  setCpuLoad(v)         { set({ cpuLoad: v }); },
  setLatency(v)         { set({ latencyMs: v }); },

  /* ── History ───────────────────────────────────────────────────── */
  pushHistory() {
    const { clips, tracks, history, historyIndex } = get();
    const snapshot: HistorySnapshot = {
      clips:  clips.map(c => ({ ...c })),
      tracks: tracks.map(t => ({ ...t })),
    };
    const truncated = history.slice(0, historyIndex + 1);
    set({
      history:      [...truncated, snapshot].slice(-50),
      historyIndex: Math.min(historyIndex + 1, 49),
    });
  },

  undo() {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const snap = history[historyIndex - 1];
    set({ clips: snap.clips, tracks: snap.tracks, historyIndex: historyIndex - 1 });
  },

  redo() {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const snap = history[historyIndex + 1];
    set({ clips: snap.clips, tracks: snap.tracks, historyIndex: historyIndex + 1 });
  },
}));

/* ── Convenience selectors ──────────────────────────────────────────── */
export const selectedClipId = (s: TimelineState): string | null => {
  const ids = [...s.selectedClipIds];
  return ids.length === 1 ? ids[0] : null;
};
