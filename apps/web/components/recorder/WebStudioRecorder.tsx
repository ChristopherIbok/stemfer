'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Mic, MicOff, Square, Play, Download, Trash2, Volume2 } from 'lucide-react';
import { WaveformCanvas } from '@/components/timeline/WaveformCanvas';
import { api } from '@/lib/api/client';

interface Props {
  projectId: string;
  sessionId?: string;
  bpm?: number;
  onSaved?: (fileId: string) => void;
}

export function WebStudioRecorder({ projectId, sessionId, bpm = 120, onSaved }: Props) {
  const [isRecording, setIsRecording]   = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [duration, setDuration]         = useState(0);
  const [peaks, setPeaks]               = useState<number[]>([]);
  const [recordings, setRecordings]     = useState<{ blob: Blob; url: string; duration: number; name: string }[]>([]);
  const [metronomeOn, setMetronomeOn]   = useState(false);
  const [inputLevel, setInputLevel]     = useState(0);

  const mediaRef     = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const streamRef    = useRef<MediaStream | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const metronomeRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef     = useRef<NodeJS.Timeout | null>(null);
  const peakBufRef   = useRef<number[]>([]);
  const rafRef       = useRef<number>(0);

  // Metronome
  useEffect(() => {
    if (!metronomeOn || !audioCtxRef.current) return;
    const ctx      = audioCtxRef.current;
    const beatMs   = 60000 / bpm;

    const tick = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    };

    tick(); // immediate first beat
    metronomeRef.current = setInterval(tick, beatMs);
    return () => { if (metronomeRef.current) clearInterval(metronomeRef.current); };
  }, [metronomeOn, bpm]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx     = new AudioContext();
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      // Level meter
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setInputLevel(avg / 255);
        const peak = Math.max(...buf) / 255;
        peakBufRef.current.push(peak);
        if (peakBufRef.current.length > 300) {
          setPeaks([...peakBufRef.current.slice(-300)]);
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.start(100);
      mediaRef.current = mr;

      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!mediaRef.current) return;

    mediaRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const url  = URL.createObjectURL(blob);
      const name = `Recording ${new Date().toLocaleTimeString()}`;
      setRecordings(r => [...r, { blob, url, duration, name }]);
      setPeaks([...peakBufRef.current]);
      peakBufRef.current = [];
    };

    mediaRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setInputLevel(0);
  }, [duration]);

  const saveToProject = useCallback(async (idx: number) => {
    const rec = recordings[idx];
    if (!rec) return;

    const formData = new FormData();
    formData.append('file', rec.blob, `${rec.name}.webm`);
    formData.append('projectId', projectId);
    if (sessionId) formData.append('sessionId', sessionId);

    try {
      // Use chunked uploader via the upload API
      const file = new File([rec.blob], `${rec.name}.webm`, { type: 'audio/webm' });
      const init = await api.post<{ uploadId: string; fileId: string; r2Key: string; totalChunks: number }>('/upload/init', {
        filename: file.name, mimeType: file.type, size: file.size, projectId, sessionId,
      });
      const buf  = await file.arrayBuffer();
      const part = await api.rawPost<{ etag: string; partNumber: number }>('/upload/chunk', buf, {
        'Content-Type': 'application/octet-stream',
        'X-Upload-Id': init.uploadId, 'X-Chunk-Index': '0', 'X-File-Id': init.fileId,
      });
      await api.post('/upload/complete', { uploadId: init.uploadId, fileId: init.fileId, parts: [{ partNumber: 1, etag: part.etag }] });
      onSaved?.(init.fileId);
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [recordings, projectId, sessionId, onSaved]);

  const downloadRecording = (idx: number) => {
    const rec = recordings[idx];
    if (!rec) return;
    const a   = document.createElement('a');
    a.href    = rec.url;
    a.download = `${rec.name}.webm`;
    a.click();
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Studio Recorder</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">BPM {bpm}</span>
          <button
            onClick={() => setMetronomeOn(m => !m)}
            className={`text-xs px-2 py-1 rounded transition-colors ${metronomeOn ? 'bg-brand-green-500/20 text-brand-green-400' : 'text-zinc-500 hover:bg-surface-300'}`}
          >
            Metronome
          </button>
        </div>
      </div>

      {/* Input level meter */}
      <div className="h-2 bg-surface-300 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-75"
          style={{
            width: `${inputLevel * 100}%`,
            backgroundColor: inputLevel > 0.8 ? '#ef4444' : inputLevel > 0.6 ? '#f97316' : '#22c55e',
          }}
        />
      </div>

      {/* Waveform */}
      <div className="h-20 bg-surface-200 rounded-lg overflow-hidden">
        {peaks.length > 0
          ? <WaveformCanvas peaks={peaks} width={600} height={80} />
          : <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
              {isRecording ? 'Recording...' : 'Press record to start'}
            </div>
        }
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <div className="timecode text-lg w-24 text-center">{formatTime(duration)}</div>

        {!isRecording ? (
          <button
            onClick={startRecording}
            className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
          >
            <Mic size={24} />
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors animate-pulse"
          >
            <Square size={24} />
          </button>
        )}

        <div className="w-24" />
      </div>

      {/* Recordings list */}
      {recordings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Recordings</h3>
          {recordings.map((rec, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-surface-200 hover:bg-surface-300 transition-colors">
              <div className="p-1.5 rounded bg-surface-400">
                <Mic size={14} className="text-brand-green-400" />
              </div>
              <span className="text-sm text-white flex-1 truncate">{rec.name}</span>
              <span className="text-xs text-zinc-500">{formatTime(rec.duration)}</span>
              <button onClick={() => saveToProject(i)} className="btn-primary py-1 px-2 text-xs">Save</button>
              <button onClick={() => downloadRecording(i)} className="btn-ghost py-1 px-2 text-xs"><Download size={12} /></button>
              <button
                onClick={() => setRecordings(r => r.filter((_, j) => j !== i))}
                className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
