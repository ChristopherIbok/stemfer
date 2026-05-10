'use client';

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { AudioEngine } from './audioEngine';

export function useAudioEngine(
  fileUrls: Map<string, string>,
): { engine: AudioEngine } {
  const engine  = AudioEngine.getInstance();
  const prevUrl = useRef<Map<string, string>>(new Map());

  /* Load new buffers when URL map changes */
  useEffect(() => {
    fileUrls.forEach((url, fileId) => {
      if (prevUrl.current.get(fileId) !== url) engine.loadFile(fileId, url);
    });
    prevUrl.current = new Map(fileUrls);
  }, [fileUrls, engine]);

  /* React to isPlaying changes */
  useEffect(() => {
    let prevPlaying = useTimelineStore.getState().isPlaying;

    const unsub = useTimelineStore.subscribe((state) => {
      if (state.isPlaying === prevPlaying) return;
      prevPlaying = state.isPlaying;

      if (state.isPlaying) {
        engine.resume().then(() => {
          const s = useTimelineStore.getState();
          engine.play(s.clips, s.tracks, s.playheadMs);
          if (s.metronomeEnabled) engine.startMetronome(s.bpm, s.timeSig);
        });
      } else {
        engine.stop();
        engine.stopMetronome();
      }
    });
    return unsub;
  }, [engine]);

  /* Metronome toggle */
  useEffect(() => {
    let prevMetronome = useTimelineStore.getState().metronomeEnabled;
    const unsub = useTimelineStore.subscribe((state) => {
      if (state.metronomeEnabled === prevMetronome) return;
      prevMetronome = state.metronomeEnabled;
      if (!state.metronomeEnabled) {
        engine.stopMetronome();
      } else if (state.isPlaying) {
        engine.startMetronome(state.bpm, state.timeSig);
      }
    });
    return unsub;
  }, [engine]);

  /* Live track volume updates */
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state) => {
      state.tracks.forEach(t => engine.setTrackVolume(t.id, t.volume));
    });
    return unsub;
  }, [engine]);

  /* CPU + latency → store */
  useEffect(() => {
    const unsub = engine.onCpuLoad((load) => {
      useTimelineStore.getState().setCpuLoad(load);
      useTimelineStore.getState().setLatency(engine.latencyMs);
    });
    return unsub;
  }, [engine]);

  return { engine };
}
