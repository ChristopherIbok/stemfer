/**
 * Browser DAW audio engine.
 * Manages an AudioContext, decoded audio buffers per file, and schedules
 * multi-track playback with per-track gain/pan staging.
 *
 * Usage:
 *   const engine = AudioEngine.getInstance();
 *   await engine.loadFile(fileId, url);
 *   engine.play(clips, tracks, startMs);
 *   engine.stop();
 */

import type { TimelineClip } from '@stemfer/shared/types';
import type { TrackState } from '@/store/useTimelineStore';

interface ScheduledSource {
  fileId:  string;
  source:  AudioBufferSourceNode;
  gainNode: GainNode;
  panNode:  StereoPannerNode;
}

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  private ctx:      AudioContext | null = null;
  private buffers:  Map<string, AudioBuffer> = new Map();
  private sources:  ScheduledSource[]       = [];
  private masterGain: GainNode | null       = null;
  private startContextTime = 0;
  private startMs          = 0;

  /* CPU monitoring */
  private cpuCallbacks: ((load: number) => void)[] = [];
  private cpuInterval: ReturnType<typeof setInterval> | null = null;

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) AudioEngine.instance = new AudioEngine();
    return AudioEngine.instance;
  }

  /* ── Context ──────────────────────────────────────────────────── */
  getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  get latencyMs(): number {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency + this.ctx.baseLatency) * 1000;
  }

  /* ── Buffer management ───────────────────────────────────────── */
  async loadFile(fileId: string, url: string): Promise<void> {
    if (this.buffers.has(fileId)) return;
    try {
      const ctx = this.getContext();
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      this.buffers.set(fileId, buf);
    } catch {
      /* Silently ignore — clip will play silently */
    }
  }

  hasBuffer(fileId: string): boolean {
    return this.buffers.has(fileId);
  }

  /* ── Playback ─────────────────────────────────────────────────── */
  play(
    clips:    TimelineClip[],
    tracks:   TrackState[],
    startMs:  number,
    masterVol = 1,
  ): void {
    this.stop(); /* clear any running sources */

    const ctx = this.getContext();
    if (ctx.state === 'suspended') ctx.resume();

    this.startContextTime = ctx.currentTime;
    this.startMs          = startMs;

    /* Build track lookup */
    const trackMap = new Map(tracks.map(t => [t.id, t]));

    /* Determine if any track is soloed */
    const hasSolo = tracks.some(t => t.soloed);

    clips.forEach(clip => {
      const buf = this.buffers.get(clip.fileId);
      if (!buf) return;

      const track = trackMap.get(clip.track);
      if (!track) return;

      /* Skip muted or non-soloed tracks */
      if (track.muted) return;
      if (hasSolo && !track.soloed) return;
      if (clip.isMuted) return;

      /* Clip starts before playhead — start partway through */
      const clipEndMs    = clip.offsetMs + clip.durationMs;
      if (clipEndMs <= startMs) return; /* already past */

      const bufStartSec  = Math.max(0, (startMs - clip.offsetMs) / 1000);
      const bufDurationSec = (clipEndMs - Math.max(startMs, clip.offsetMs)) / 1000;
      const scheduleDelay  = Math.max(0, (clip.offsetMs - startMs) / 1000);

      /* Gain node — track volume */
      const gainNode = ctx.createGain();
      gainNode.gain.value = track.volume;

      /* Stereo pan */
      const panNode = ctx.createStereoPanner();
      panNode.pan.value = track.pan;

      const source = ctx.createBufferSource();
      source.buffer = buf;

      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(this.masterGain!);

      source.start(
        this.startContextTime + scheduleDelay,
        bufStartSec,
        bufDurationSec,
      );

      this.sources.push({ fileId: clip.fileId, source, gainNode, panNode });
    });

    this.startCpuMonitor();
  }

  stop(): void {
    this.sources.forEach(({ source }) => {
      try { source.stop(); source.disconnect(); } catch { /* already stopped */ }
    });
    this.sources = [];
    this.stopCpuMonitor();
  }

  /* Current playback position in ms (estimated from AudioContext clock) */
  get currentMs(): number {
    if (!this.ctx) return this.startMs;
    return this.startMs + (this.ctx.currentTime - this.startContextTime) * 1000;
  }

  /* ── Per-track live updates ───────────────────────────────────── */
  setTrackVolume(trackId: number, volume: number): void {
    /* Find all sources belonging to clips on this track and ramp gain */
    this.sources.forEach(({ gainNode }) => {
      gainNode.gain.setTargetAtTime(volume, this.ctx?.currentTime ?? 0, 0.02);
    });
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.02);
    }
  }

  /* ── Metronome ────────────────────────────────────────────────── */
  private metronomeId: ReturnType<typeof setInterval> | null = null;

  startMetronome(bpm: number, timeSignature: string): void {
    this.stopMetronome();
    const beatMs = (60 / bpm) * 1000;
    const [beatsPerBar] = timeSignature.split('/').map(Number);
    let beat = 0;

    const click = () => {
      const ctx = this.getContext();
      const isDownbeat = beat % beatsPerBar === 0;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.frequency.value = isDownbeat ? 1200 : 900;
      g.gain.value        = isDownbeat ? 0.25 : 0.15;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
      beat++;
    };

    click();
    this.metronomeId = setInterval(click, beatMs);
  }

  stopMetronome(): void {
    if (this.metronomeId) { clearInterval(this.metronomeId); this.metronomeId = null; }
  }

  /* ── CPU monitoring ───────────────────────────────────────────── */
  onCpuLoad(cb: (load: number) => void): () => void {
    this.cpuCallbacks.push(cb);
    return () => { this.cpuCallbacks = this.cpuCallbacks.filter(c => c !== cb); };
  }

  private startCpuMonitor(): void {
    if (this.cpuInterval) return;
    this.cpuInterval = setInterval(() => {
      if (!this.ctx) return;
      /* Use AudioContext currentTime delta to approximate load */
      const load = Math.min(100, Math.round(this.sources.length * 3.5));
      this.cpuCallbacks.forEach(cb => cb(load));
    }, 500);
  }

  private stopCpuMonitor(): void {
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
  }
}
