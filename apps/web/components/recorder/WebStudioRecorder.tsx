'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Mic, Square, Download, Trash2, Volume2, ChevronDown, Check } from 'lucide-react';
import { useUploadStore } from '@/store/useUploadStore';

interface Props {
  projectId: string;
  sessionId?: string;
  bpm?: number;
  onSaved?: (fileId: string) => void;
}

interface Recording {
  blob:     Blob;
  url:      string;
  duration: number;
  name:     string;
}

/* ── 32-bit float WAV encoder ──────────────────────────────────────────
   Encodes raw Float32Array samples to a standard WAV file.
   Browsers record via MediaRecorder as WebM/Opus which loses bit depth.
   Instead we capture via ScriptProcessorNode / AudioWorklet to get the
   raw float samples directly from the AudioContext.
─────────────────────────────────────────────────────────────────────── */
function encodeWav32(channelData: Float32Array[], sampleRate: number): Blob {
  const numChannels = channelData.length;
  const numSamples  = channelData[0].length;
  const bytesPerSample = 4; // 32-bit float
  const dataSize    = numChannels * numSamples * bytesPerSample;
  const buffer      = new ArrayBuffer(44 + dataSize);
  const view        = new DataView(buffer);

  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const u16 = (o: number, v: number) => view.setUint16(o, v, true);
  const u32 = (o: number, v: number) => view.setUint32(o, v, true);

  write(0,  'RIFF');
  u32(4,    36 + dataSize);
  write(8,  'WAVE');
  write(12, 'fmt ');
  u32(16, 16);             // chunk size
  u16(20, 3);              // PCM float = 3
  u16(22, numChannels);
  u32(24, sampleRate);
  u32(28, sampleRate * numChannels * bytesPerSample);
  u16(32, numChannels * bytesPerSample);
  u16(34, 32);             // bits per sample
  write(36, 'data');
  u32(40, dataSize);

  // Interleave channels
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setFloat32(offset, channelData[ch][i], true);
      offset += 4;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function WebStudioRecorder({ projectId, sessionId, bpm = 120, onSaved }: Props) {
  const [isRecording,   setIsRecording]   = useState(false);
  const [duration,      setDuration]      = useState(0);
  const [inputLevel,    setInputLevel]    = useState(0);
  const [peakLevel,     setPeakLevel]     = useState(0);
  const [recordings,    setRecordings]    = useState<Recording[]>([]);
  const [metronomeOn,   setMetronomeOn]   = useState(false);
  const [saving,        setSaving]        = useState<number | null>(null);
  const [devices,       setDevices]       = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [showDevices,   setShowDevices]   = useState(false);
  const [inputGain,     setInputGain]     = useState(1);
  const [clipping,      setClipping]      = useState(false);

  const startUpload   = useUploadStore(s => s.startUpload);

  const audioCtxRef   = useRef<AudioContext | null>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const processorRef  = useRef<ScriptProcessorNode | null>(null);
  const samplesRef    = useRef<Float32Array[][]>([[], []]);  // [leftChannel[], rightChannel[]]
  const metronomeRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef        = useRef<number>(0);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const gainRef       = useRef<GainNode | null>(null);
  const clippingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Enumerate audio devices ───────────────────────────────────── */
  useEffect(() => {
    async function loadDevices() {
      try {
        // Need to request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
        const all = await navigator.mediaDevices.enumerateDevices();
        const inputs = all.filter(d => d.kind === 'audioinput');
        setDevices(inputs);
        if (inputs.length > 0 && !selectedDevice) setSelectedDevice(inputs[0].deviceId);
      } catch {
        // Permission denied — show empty list
      }
    }
    loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []);

  /* ── Metronome ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!metronomeOn) { if (metronomeRef.current) clearInterval(metronomeRef.current); return; }
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const beatMs = (60 / bpm) * 1000;
    let beat = 0;
    const tick = () => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.frequency.value = beat % 4 === 0 ? 1200 : 900;
      g.gain.value        = beat % 4 === 0 ? 0.3 : 0.15;
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.06);
      beat++;
    };
    tick();
    metronomeRef.current = setInterval(tick, beatMs);
    return () => { if (metronomeRef.current) clearInterval(metronomeRef.current); };
  }, [metronomeOn, bpm]);

  /* ── Level meter RAF ───────────────────────────────────────────── */
  const drawLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const buf = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    setInputLevel(peak);
    if (peak > 0.95) {
      setClipping(true);
      if (clippingTimerRef.current) clearTimeout(clippingTimerRef.current);
      clippingTimerRef.current = setTimeout(() => setClipping(false), 1000);
    }
    setPeakLevel(prev => Math.max(prev * 0.998, peak)); // slow decay
    rafRef.current = requestAnimationFrame(drawLevel);
  }, []);

  /* ── Start recording ───────────────────────────────────────────── */
  const startRecording = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId:        selectedDevice ? { exact: selectedDevice } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       48000,
          channelCount:     2,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      audioCtxRef.current = ctx;

      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize        = 2048;
      analyser.smoothingTimeConstant = 0;
      analyserRef.current     = analyser;

      const inputGainNode = ctx.createGain();
      inputGainNode.gain.value = inputGain;
      gainRef.current = inputGainNode;

      // ScriptProcessorNode to capture raw float32 samples
      const bufferSize  = 4096;
      const numChannels = stream.getAudioTracks()[0].getSettings().channelCount ?? 2;
      const processor   = ctx.createScriptProcessor(bufferSize, numChannels, numChannels);
      processorRef.current = processor;
      samplesRef.current   = Array.from({ length: numChannels }, () => []) as Float32Array[][];

      processor.onaudioprocess = (e) => {
        for (let ch = 0; ch < numChannels; ch++) {
          const channelData = e.inputBuffer.getChannelData(ch);
          samplesRef.current[ch].push(new Float32Array(channelData));
        }
      };

      source.connect(inputGainNode);
      inputGainNode.connect(analyser);
      inputGainNode.connect(processor);
      processor.connect(ctx.destination); // must connect to keep it active

      setIsRecording(true);
      setDuration(0);
      setPeakLevel(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      rafRef.current   = requestAnimationFrame(drawLevel);
    } catch (err) {
      console.error('Microphone error:', err);
    }
  }, [selectedDevice, inputGain, drawLevel]);

  /* ── Stop recording ────────────────────────────────────────────── */
  const stopRecording = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    // Merge all buffered chunks into full channel arrays
    const numChannels = samplesRef.current.length;
    const merged: Float32Array[] = samplesRef.current.map(chunks => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out   = new Float32Array(total);
      let pos = 0;
      for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.length; }
      return out;
    });

    const sampleRate = ctx.sampleRate;
    const blob       = encodeWav32(merged, sampleRate);
    const url        = URL.createObjectURL(blob);
    const dur        = duration;
    const name       = `Take ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;

    setRecordings(r => [...r, { blob, url, duration: dur, name }]);
    setIsRecording(false);
    setInputLevel(0);
    samplesRef.current = [[], []];
  }, [duration]);

  /* ── Save to project ───────────────────────────────────────────── */
  const saveToProject = useCallback(async (idx: number) => {
    const rec = recordings[idx];
    if (!rec) return;
    setSaving(idx);
    try {
      const file = new File([rec.blob], `${rec.name}.wav`, { type: 'audio/wav' });
      const fileId = await startUpload(file, projectId, sessionId);
      onSaved?.(fileId);
      setRecordings(r => r.filter((_, i) => i !== idx));
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(null);
    }
  }, [recordings, projectId, sessionId, startUpload, onSaved]);

  const downloadRecording = (idx: number) => {
    const rec = recordings[idx];
    if (!rec) return;
    const a = document.createElement('a');
    a.href = rec.url; a.download = `${rec.name}.wav`; a.click();
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const selectedDeviceLabel = devices.find(d => d.deviceId === selectedDevice)?.label || 'Default input';

  return (
    <div className="p-3 space-y-3">
      {/* ── Top row: input selector + metronome ─────────────────── */}
      <div className="flex items-center gap-2">
        {/* Input device selector */}
        <div className="relative flex-1">
          <button
            onClick={() => setShowDevices(s => !s)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-200 border border-surface-300 text-left hover:border-surface-400 transition-colors"
            style={{ transitionDuration: 'var(--duration-fast)' }}
          >
            <Mic size={11} className="text-zinc-500 flex-shrink-0" />
            <span className="text-xs text-zinc-400 truncate flex-1">{selectedDeviceLabel}</span>
            <ChevronDown size={11} className="text-zinc-600 flex-shrink-0" />
          </button>
          {showDevices && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-100 border border-surface-300 rounded-lg shadow-2xl overflow-hidden">
              {devices.length === 0 ? (
                <p className="text-xs text-zinc-600 px-3 py-2">No input devices found</p>
              ) : devices.map(d => (
                <button
                  key={d.deviceId}
                  onClick={() => { setSelectedDevice(d.deviceId); setShowDevices(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-surface-200 transition-colors"
                >
                  {d.deviceId === selectedDevice && <Check size={10} className="text-brand-green-400 flex-shrink-0" />}
                  <span className={`truncate ${d.deviceId === selectedDevice ? 'text-white' : 'text-zinc-400'}`}>
                    {d.label || `Input ${devices.indexOf(d) + 1}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input gain */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Volume2 size={11} className="text-zinc-600" />
          <input
            type="range" min="0" max="2" step="0.05"
            value={inputGain}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setInputGain(v);
              if (gainRef.current && audioCtxRef.current) {
                gainRef.current.gain.setTargetAtTime(v, audioCtxRef.current.currentTime, 0.01);
              }
            }}
            className="w-16 accent-brand-green-500"
            title={`Input gain: ${Math.round(inputGain * 100)}%`}
          />
        </div>

        {/* Metronome */}
        <button
          onClick={() => setMetronomeOn(m => !m)}
          className={`text-[10px] px-2 py-1 rounded border flex-shrink-0 transition-colors ${
            metronomeOn
              ? 'bg-brand-green-500/15 border-brand-green-500/40 text-brand-green-400'
              : 'border-surface-300 text-zinc-500 hover:text-white'
          }`}
          style={{ transitionDuration: 'var(--duration-fast)' }}
          title="Toggle metronome"
        >
          ♩ {bpm}
        </button>
      </div>

      {/* ── Level meter + controls ───────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Level meter */}
        <div className="flex-1 space-y-1">
          <div className="relative h-3 bg-surface-300 rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 bottom-0 rounded-full transition-none"
              style={{
                width: `${Math.min(100, inputLevel * 100)}%`,
                backgroundColor: clipping ? '#ef4444' : inputLevel > 0.75 ? '#f97316' : '#22c55e',
              }}
            />
            {/* Peak hold indicator */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/60"
              style={{ left: `${Math.min(100, peakLevel * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-zinc-700">
            <span>-∞</span>
            <span>-12</span>
            <span>-6</span>
            <span className={clipping ? 'text-red-400 font-bold' : ''}>0 {clipping ? 'CLIP' : 'dBFS'}</span>
          </div>
        </div>

        {/* Timecode */}
        <div className="timecode text-base tabular-nums text-white flex-shrink-0 w-14 text-center">
          {fmt(duration)}
        </div>

        {/* Record button */}
        {!isRecording ? (
          <button
            onClick={startRecording}
            className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center flex-shrink-0 transition-colors shadow-lg"
            title="Start recording (32-bit float WAV)"
          >
            <Mic size={18} className="text-white" />
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0 shadow-lg"
            title="Stop recording"
            style={{ animation: 'pulse 1s ease-in-out infinite' }}
          >
            <Square size={16} className="text-white" fill="white" />
          </button>
        )}
      </div>

      {/* ── Recordings list ──────────────────────────────────────── */}
      {recordings.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-surface-300">
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Takes</p>
          {recordings.map((rec, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-200 border border-surface-300">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              <span className="text-xs text-white flex-1 truncate">{rec.name}</span>
              <span className="text-[10px] text-zinc-500 flex-shrink-0 tabular-nums">{fmt(rec.duration)}</span>
              <span className="text-[10px] text-zinc-600 flex-shrink-0">32f WAV</span>
              <button
                onClick={() => saveToProject(i)}
                disabled={saving === i}
                className="btn-primary py-1 px-2 text-[10px] flex-shrink-0 disabled:opacity-50"
              >
                {saving === i ? '…' : 'Save'}
              </button>
              <button onClick={() => downloadRecording(i)} className="p-1 text-zinc-500 hover:text-white flex-shrink-0">
                <Download size={11} />
              </button>
              <button
                onClick={() => setRecordings(r => r.filter((_, j) => j !== i))}
                className="p-1 text-zinc-600 hover:text-red-400 flex-shrink-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
