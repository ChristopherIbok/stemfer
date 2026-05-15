'use client';

import { useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';

/**
 * Full professional DAW keyboard shortcut system.
 * Call once inside the timeline page component.
 */
export function useDAWShortcuts(
  onSave:      () => void,
  onRecord:    () => void,
  onSplitClip: () => void,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const meta = e.metaKey || e.ctrlKey;
      const s    = useTimelineStore.getState();

      switch (e.code) {
        /* ── Transport ──────────────────────────────────────────── */
        case 'Space':
          e.preventDefault();
          if (s.isPlaying) {
            s.setPlaying(false);
          } else {
            s.setPlaying(true);
          }
          break;

        case 'Home':
        case 'KeyJ':
          if (!meta) {
            e.preventDefault();
            s.setPlayhead(0);
            s.setPlaying(false);
          }
          break;

        case 'KeyL':
          if (!meta) {
            e.preventDefault();
            s.setLoop(!s.loopEnabled);
          }
          break;

        case 'KeyR':
          if (!meta) {
            e.preventDefault();
            onRecord();
          }
          break;

        case 'KeyK':
          if (!meta) {
            e.preventDefault();
            onSplitClip();
          }
          break;

        /* ── Edit ───────────────────────────────────────────────── */
        case 'KeyZ':
          if (meta && e.shiftKey) { e.preventDefault(); s.redo(); }
          else if (meta)          { e.preventDefault(); s.undo(); }
          break;

        case 'KeyS':
          if (meta) { e.preventDefault(); onSave(); }
          break;

        case 'KeyD':
          if (meta) {
            e.preventDefault();
            const ids = [...s.selectedClipIds];
            if (ids.length) { s.pushHistory(); s.duplicateClips(ids); }
          }
          break;

        case 'Delete':
        case 'Backspace':
          if (s.selectedClipIds.size > 0) {
            e.preventDefault();
            s.pushHistory();
            s.deleteClips([...s.selectedClipIds]);
          }
          break;

        /* ── Track controls ─────────────────────────────────────── */
        case 'KeyM': {
          if (meta) break;
          e.preventDefault();
          /* Mute the track of the first selected clip */
          const clip = s.selectedClipIds.size > 0
            ? s.clips.find(c => s.selectedClipIds.has(c.fileId))
            : null;
          if (clip !== null && clip !== undefined) s.toggleTrackMute(clip.track);
          break;
        }

        case 'KeyW': /* Solo */
          if (!meta) {
            e.preventDefault();
            const clip = s.selectedClipIds.size > 0
              ? s.clips.find(c => s.selectedClipIds.has(c.fileId))
              : null;
            if (clip) s.toggleTrackSolo(clip.track);
          }
          break;

        /* ── Tool modes ─────────────────────────────────────────── */
        case 'KeyV':
          if (!meta) { e.preventDefault(); s.setToolMode('pointer'); }
          break;
        case 'KeyB':
          if (!meta) { e.preventDefault(); s.setToolMode('razor'); }
          break;
        case 'KeyH':
          if (!meta) { e.preventDefault(); s.setToolMode('hand'); }
          break;

        /* ── View ───────────────────────────────────────────────── */
        case 'KeyA':
          if (meta) {
            e.preventDefault();
            s.selectClips(s.clips.map(c => c.fileId));
          } else {
            e.preventDefault();
            s.setShowAutomation(!s.showAutomation);
          }
          break;

        case 'KeyI':
          if (!meta) {
            e.preventDefault();
            s.setShowRightPanel(!s.showRightPanel);
          }
          break;

        case 'Equal':
          if (meta) { e.preventDefault(); s.setZoom(s.zoom * 1.4); }
          break;

        case 'Minus':
          if (meta) { e.preventDefault(); s.setZoom(s.zoom / 1.4); }
          break;

        /* ── Nudge with arrow keys ───────────────────────────────── */
        case 'ArrowLeft': {
          if (s.selectedClipIds.size === 0) break;
          e.preventDefault();
          const nudgeL = e.shiftKey ? 1000 : (meta ? 100 : 10);
          s.pushHistory();
          s.clips
            .filter(c => s.selectedClipIds.has(c.fileId) && !c.isLocked)
            .forEach(c => s.moveClip(c.fileId, Math.max(0, c.offsetMs - nudgeL)));
          break;
        }

        case 'ArrowRight': {
          if (s.selectedClipIds.size === 0) break;
          e.preventDefault();
          const nudgeR = e.shiftKey ? 1000 : (meta ? 100 : 10);
          s.pushHistory();
          s.clips
            .filter(c => s.selectedClipIds.has(c.fileId) && !c.isLocked)
            .forEach(c => s.moveClip(c.fileId, c.offsetMs + nudgeR));
          break;
        }

        case 'ArrowUp': {
          if (s.selectedClipIds.size === 0) break;
          e.preventDefault();
          s.pushHistory();
          s.clips
            .filter(c => s.selectedClipIds.has(c.fileId) && !c.isLocked)
            .forEach(c => s.moveClip(c.fileId, c.offsetMs, Math.max(0, c.track - 1)));
          break;
        }

        case 'ArrowDown': {
          if (s.selectedClipIds.size === 0) break;
          e.preventDefault();
          s.pushHistory();
          s.clips
            .filter(c => s.selectedClipIds.has(c.fileId) && !c.isLocked)
            .forEach(c => s.moveClip(c.fileId, c.offsetMs, Math.min(s.totalTracks - 1, c.track + 1)));
          break;
        }

        /* ── Escape: deselect ───────────────────────────────────── */
        case 'Escape':
          s.selectClip(null);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onRecord, onSplitClip]);
}
