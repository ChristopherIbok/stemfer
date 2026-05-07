'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone }   from 'react-dropzone';
import {
  Upload, X, CheckCircle2, AlertCircle, Music, File as FileIcon,
  ArrowRight, Send, Clock, Zap,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────────── */
interface FileEntry {
  id:       string;
  file:     File;
  progress: number;
  status:   'pending' | 'uploading' | 'done' | 'error';
  error?:   string;
  /* multipart state */
  uploadId?: string;
  fileKey?:  string;
  parts:    { partNumber: number; etag: string }[];
}

const API        = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';
const CHUNK_SIZE = 5 * 1024 * 1024;
const PARALLEL   = 3;
const RETRIES    = 3;

/* ── Upload store hook ────────────────────────────────────────────── */
function useTransfer() {
  const [files,          setFiles]          = useState<FileEntry[]>([]);
  const [senderEmail,    setSenderEmail]    = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message,        setMessage]        = useState('');
  const [transferId,     setTransferId]     = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'sending' | 'done' | 'error'>('idle');
  const [downloadUrl,    setDownloadUrl]    = useState('');
  const [globalError,    setGlobalError]    = useState('');
  const speedRef = useRef<{ bytes: number; ts: number }>({ bytes: 0, ts: Date.now() });
  const [speed, setSpeed] = useState('');

  const addFiles = useCallback((dropped: File[]) => {
    setFiles(prev => [
      ...prev,
      ...dropped.map(f => ({
        id:       crypto.randomUUID(),
        file:     f,
        progress: 0,
        status:   'pending' as const,
        parts:    [],
      })),
    ]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  /* ── Upload all files ───────────────────────────────────────────── */
  const uploadAll = useCallback(async (tid: string) => {
    const snapshot = [...files];

    for (const entry of snapshot) {
      /* Init multipart */
      const initRes = await fetch(`${API}/transfer/init`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: tid,
          filename:   entry.file.name,
          mimeType:   entry.file.type || 'application/octet-stream',
          size:       entry.file.size,
          senderEmail,
        }),
      });
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({})) as { error?: string };
        updateFile(entry.id, { status: 'error', error: err.error ?? 'Init failed' });
        throw new Error(err.error ?? 'Init failed');
      }
      const init = await initRes.json() as {
        uploadId: string; fileKey: string; fileId: string; totalChunks: number;
      };

      updateFile(entry.id, { status: 'uploading', uploadId: init.uploadId, fileKey: init.fileKey });

      /* Parallel chunked upload */
      const totalChunks = init.totalChunks;
      const parts: { partNumber: number; etag: string }[] = new Array(totalChunks);
      let chunkIdx  = 0;
      let uploaded  = 0;

      const worker = async () => {
        while (chunkIdx < totalChunks) {
          const i     = chunkIdx++;
          const start = i * CHUNK_SIZE;
          const buf   = await entry.file.slice(start, start + CHUNK_SIZE).arrayBuffer();

          for (let attempt = 0; attempt <= RETRIES; attempt++) {
            try {
              const r = await fetch(`${API}/transfer/chunk`, {
                method:  'POST',
                headers: {
                  'X-Transfer-Upload-Id': init.uploadId,
                  'X-Chunk-Index':        String(i),
                  'X-File-Key':           init.fileKey,
                  'Content-Type':         'application/octet-stream',
                },
                body: buf,
              });
              if (!r.ok) throw new Error(`Chunk ${i} HTTP ${r.status}`);
              const p = await r.json() as { partNumber: number; etag: string };
              parts[i] = p;

              /* Speed tracking */
              speedRef.current.bytes += buf.byteLength;
              const now   = Date.now();
              const dt    = (now - speedRef.current.ts) / 1000;
              if (dt > 0.5) {
                const mbps = (speedRef.current.bytes / 1e6 / dt).toFixed(1);
                setSpeed(`${mbps} MB/s`);
                speedRef.current = { bytes: 0, ts: now };
              }

              uploaded++;
              updateFile(entry.id, { progress: Math.round((uploaded / totalChunks) * 100) });
              break;
            } catch {
              if (attempt === RETRIES) {
                updateFile(entry.id, { status: 'error', error: `Chunk ${i} failed` });
                throw new Error(`Chunk ${i} upload failed`);
              }
              await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
            }
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(PARALLEL, totalChunks) }, worker));

      /* Complete file */
      const compRes = await fetch(`${API}/transfer/complete-file`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: init.fileId, uploadId: init.uploadId, fileKey: init.fileKey, parts }),
      });
      if (!compRes.ok) throw new Error('Finalize failed');

      updateFile(entry.id, { status: 'done', progress: 100 });
    }
  }, [files, senderEmail]);

  function updateFile(id: string, patch: Partial<FileEntry>) {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  /* ── Send ───────────────────────────────────────────────────────── */
  const send = useCallback(async () => {
    if (!senderEmail || !recipientEmail || files.length === 0) return;
    setGlobalError('');
    setPhase('uploading');

    try {
      /* Create transfer session ID on first file init (transferId will be set server-side) */
      const tid = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
      setTransferId(tid);

      await uploadAll(tid);

      /* Send */
      setPhase('sending');
      const sendRes = await fetch(`${API}/transfer/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: tid, recipientEmail, message }),
      });
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'Send failed');
      }
      const result = await sendRes.json() as { downloadUrl: string };
      setDownloadUrl(result.downloadUrl);
      setPhase('done');
    } catch (err: any) {
      setGlobalError(err.message ?? 'Transfer failed');
      setPhase('error');
    }
  }, [senderEmail, recipientEmail, files, message, uploadAll]);

  const reset = useCallback(() => {
    setFiles([]);
    setSenderEmail('');
    setRecipientEmail('');
    setMessage('');
    setTransferId(null);
    setPhase('idle');
    setDownloadUrl('');
    setGlobalError('');
    setSpeed('');
  }, []);

  const totalSize   = files.reduce((s, f) => s + f.file.size, 0);
  const allUploaded = files.length > 0 && files.every(f => f.status === 'done');
  const canSend     = !!(senderEmail && recipientEmail && files.length > 0 && phase === 'idle');

  return {
    files, addFiles, removeFile,
    senderEmail, setSenderEmail,
    recipientEmail, setRecipientEmail,
    message, setMessage,
    phase, send, reset,
    downloadUrl, globalError,
    totalSize, allUploaded, speed,
    canSend,
  };
}

/* ── Page Component ─────────────────────────────────────────────────── */
export default function TransferPage() {
  const t = useTransfer();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: t.addFiles,
    multiple: true,
    disabled: t.phase !== 'idle',
  });

  /* Done state */
  if (t.phase === 'done') {
    return (
      <div className="min-h-full flex items-center justify-center p-8 animate-fade-in">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-brand-green-500/15 border border-brand-green-500/30 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-brand-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Transfer sent!</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Emails have been delivered. Files expire in 14 days.
          </p>
          <div className="card mb-6 text-left">
            <p className="text-xs text-zinc-600 mb-1">Download link</p>
            <p className="text-xs text-brand-green-400 break-all font-mono">{t.downloadUrl}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigator.clipboard.writeText(t.downloadUrl)}
              className="btn-ghost flex-1 text-sm"
            >
              Copy Link
            </button>
            <button onClick={t.reset} className="btn-primary flex-1 text-sm">
              New Transfer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isUploading = t.phase === 'uploading' || t.phase === 'sending';
  const overallProgress = t.files.length > 0
    ? Math.round(t.files.reduce((s, f) => s + f.progress, 0) / t.files.length)
    : 0;

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Transfer</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Send files to anyone — no account needed to download.
        </p>
      </div>

      {/* Features row */}
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { icon: Zap,   label: 'Fast upload',   sub: 'Parallel chunks' },
          { icon: Clock, label: '14-day link',   sub: 'Auto-expires' },
          { icon: Send,  label: 'Email delivery', sub: 'Instant notify' },
        ].map(({ icon: Icon, label, sub }) => (
          <div key={label} className="p-3 rounded-xl bg-surface-100 border border-surface-300 flex flex-col items-center gap-1">
            <Icon size={14} className="text-brand-green-400" />
            <p className="text-xs font-medium text-white">{label}</p>
            <p className="text-[10px] text-zinc-600">{sub}</p>
          </div>
        ))}
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isDragActive
            ? 'border-brand-green-500 bg-brand-green-500/8'
            : isUploading
            ? 'border-surface-300 opacity-50 cursor-not-allowed'
            : 'border-surface-400 hover:border-brand-green-500/40 hover:bg-surface-200/30 cursor-pointer'
        }`}
        style={{ transitionDuration: 'var(--duration-base)' }}
      >
        <input {...getInputProps()} />
        <Upload size={24} className={`mx-auto mb-3 ${isDragActive ? 'text-brand-green-400' : 'text-zinc-600'}`} />
        <p className="text-white font-medium text-sm">
          {isDragActive ? 'Drop files here' : 'Drag files here'}
        </p>
        <p className="text-zinc-600 text-xs mt-1">or click to browse · any file type</p>
      </div>

      {/* File list */}
      {t.files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest">
              Files ({t.files.length}) · {formatBytes(t.totalSize)}
            </p>
            {t.speed && (
              <p className="text-xs text-brand-green-400 font-mono">{t.speed}</p>
            )}
          </div>

          {t.files.map(entry => (
            <FileRow
              key={entry.id}
              entry={entry}
              onRemove={() => t.removeFile(entry.id)}
              canRemove={!isUploading}
            />
          ))}

          {/* Overall progress */}
          {isUploading && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
                <span>{t.phase === 'sending' ? 'Processing & sending emails…' : `Uploading… ${overallProgress}%`}</span>
                <span className="tabular-nums">{overallProgress}%</span>
              </div>
              <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
                <div
                  className="upload-bar bg-brand-green-400"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-white">Delivery details</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Your email</label>
            <input
              type="email"
              value={t.senderEmail}
              onChange={e => t.setSenderEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
              disabled={isUploading}
            />
          </div>
          <div>
            <label className="label">Recipient email</label>
            <input
              type="email"
              value={t.recipientEmail}
              onChange={e => t.setRecipientEmail(e.target.value)}
              className="input"
              placeholder="them@example.com"
              disabled={isUploading}
            />
          </div>
        </div>

        <div>
          <label className="label">Message <span className="text-zinc-700">(optional)</span></label>
          <textarea
            value={t.message}
            onChange={e => t.setMessage(e.target.value)}
            className="input resize-none"
            rows={3}
            placeholder="Add a note for the recipient…"
            disabled={isUploading}
          />
        </div>

        {t.globalError && (
          <p className="text-sm text-red-400 flex items-center gap-1.5">
            <AlertCircle size={14} />
            {t.globalError}
          </p>
        )}

        <button
          onClick={t.send}
          disabled={!t.canSend || isUploading}
          className="btn-primary w-full justify-center text-sm"
        >
          {isUploading ? (
            t.phase === 'sending' ? 'Sending emails…' : 'Uploading files…'
          ) : (
            <>
              <Send size={15} />
              Send Transfer
              <ArrowRight size={14} />
            </>
          )}
        </button>

        <p className="text-[10px] text-zinc-700 text-center">
          Files are compressed, encrypted in transit, and automatically deleted after 14 days.
        </p>
      </div>
    </div>
  );
}

/* ── File row ─────────────────────────────────────────────────────── */
function FileRow({
  entry,
  onRemove,
  canRemove,
}: {
  entry: FileEntry;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const isAudio = /\.(wav|mp3|aiff|flac|ogg|m4a)$/i.test(entry.file.name);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-200 border border-surface-300">
      <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
        {isAudio
          ? <Music    size={13} className="text-brand-green-400" />
          : <FileIcon size={13} className="text-zinc-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white truncate max-w-[240px] font-medium">{entry.file.name}</span>
          <span className="text-[10px] text-zinc-500 ml-2 flex-shrink-0">{formatBytes(entry.file.size)}</span>
        </div>

        {entry.status === 'uploading' && (
          <div className="mt-1.5 h-1 bg-surface-300 rounded-full overflow-hidden">
            <div className="upload-bar bg-brand-green-400" style={{ width: `${entry.progress}%` }} />
          </div>
        )}

        {entry.status === 'error' && (
          <p className="text-[10px] text-red-400 mt-0.5">{entry.error}</p>
        )}
      </div>

      {entry.status === 'done' && <CheckCircle2 size={15} className="text-brand-green-400 flex-shrink-0" />}
      {entry.status === 'error' && <AlertCircle size={15} className="text-red-400 flex-shrink-0" />}

      {canRemove && entry.status !== 'uploading' && (
        <button
          onClick={onRemove}
          className="p-1 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400 flex-shrink-0"
          style={{ transition: 'color var(--duration-fast), background-color var(--duration-fast)' }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
