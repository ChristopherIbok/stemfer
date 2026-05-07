'use client';
import { create } from 'zustand';
import { snapToGrid, msToTimecode } from '@stemfer/shared/utils/timecode';
import type { TimelineClip } from '@stemfer/shared/types';

interface TimelineState {
  clips:          TimelineClip[];
  zoom:           number;      // pixels per ms
  scrollMs:       number;      // scroll position in ms
  bpm:            number;
  snapEnabled:    boolean;
  snapSubdivision: number;
  selectedClipId: string | null;
  isPlaying:      boolean;
  playheadMs:     number;
  totalTracks:    number;

  setClips:       (clips: TimelineClip[]) => void;
  updateClip:     (fileId: string, patch: Partial<TimelineClip>) => void;
  setZoom:        (zoom: number) => void;
  setScroll:      (ms: number) => void;
  setBpm:         (bpm: number) => void;
  setSnap:        (enabled: boolean) => void;
  selectClip:     (id: string | null) => void;
  moveClip:       (fileId: string, newOffsetMs: number, newTrack?: number) => void;
  toggleMute:     (fileId: string) => void;
  toggleLock:     (fileId: string) => void;
  groupClips:     (fileIds: string[]) => void;
  ungroupClips:   (groupId: string) => void;
  setPlayhead:    (ms: number) => void;
  setPlaying:     (v: boolean) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  clips:           [],
  zoom:            0.05,    // 0.05 px/ms = 20ms per px default
  scrollMs:        0,
  bpm:             120,
  snapEnabled:     true,
  snapSubdivision: 1,
  selectedClipId:  null,
  isPlaying:       false,
  playheadMs:      0,
  totalTracks:     8,

  setClips: (clips) => set({ clips }),

  updateClip(fileId, patch) {
    set(s => ({ clips: s.clips.map(c => c.fileId === fileId ? { ...c, ...patch } : c) }));
  },

  setZoom(zoom) {
    set({ zoom: Math.max(0.005, Math.min(zoom, 2)) });
  },

  setScroll(ms) {
    set({ scrollMs: Math.max(0, ms) });
  },

  setBpm(bpm) {
    set({ bpm: Math.max(20, Math.min(bpm, 400)) });
  },

  setSnap(enabled) { set({ snapEnabled: enabled }); },

  selectClip(id) { set({ selectedClipId: id }); },

  moveClip(fileId, newOffsetMs, newTrack) {
    const { snapEnabled, bpm, snapSubdivision } = get();
    const snapped = snapEnabled
      ? snapToGrid(newOffsetMs, bpm, snapSubdivision)
      : newOffsetMs;
    const offsetMs = Math.max(0, snapped);

    set(s => ({
      clips: s.clips.map(c => {
        if (c.fileId !== fileId) {
          // If in same group, move together
          const movedClip = s.clips.find(x => x.fileId === fileId);
          if (movedClip?.groupId && c.groupId === movedClip.groupId) {
            const delta = offsetMs - (movedClip.offsetMs);
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

  setPlayhead(ms) { set({ playheadMs: ms }); },
  setPlaying(v)   { set({ isPlaying: v }); },
}));
