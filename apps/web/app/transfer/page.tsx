'use client';

import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, X, CheckCircle2, AlertCircle, Music, File as FileIcon,
  ArrowRight, Send, Clock, Download, Link as LinkIcon,
  ChevronDown, ChevronUp, Users,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';

/* ── Types ─────────────────────────────────────────────────────────── */
interface FileEntry {
  id:       string;
  file:     File;
  progress: number;
  status:   'pending' | 'uploading' | 'done' | 'error';
  error?:   string;
  uploadId?: string;
  fileKey?:  string;
  parts:    { partNumber: number; etag: string }[];
}

const API        = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';
const CHUNK_SIZE = 5 * 1024 * 1024;
const PARALLEL   = 3;
const RETRIES    = 3;

/* ── My Transfers types ─────────────────────────────────────────────── */
interface MyTransfer {
  id:              string;
  recipient_email: string;
  message:         string | null;
  status:          string;
  zip_size_bytes:  number | null;
  download_count:  number;
  max_downloads:   number;
  download_token:  string | null;
  created_at:      string;
  expires_at:      string;
  file_count:      number;
  file_names:      string | null;
}

interface DownloadEvent {
  id:            string;
  downloaded_at: string;
  ip:            string | null;
  user_agent:    string | null;
}

/* ── Upload store hook ────────────────────────────────────────────── */
function useTransfer(senderEmail: string) {
  const [files,          setFiles]          = useState<FileEntry[]>([]);
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

  const uploadAll = useCallback(async (tid: string) => {
    const snapshot = [...files];

    for (const entry of snapshot) {
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

      const totalChunks = init.totalChunks;
      const parts: { partNumber: number; etag: string }[] = new Array(totalChunks);
      let chunkIdx = 0;
      let uploaded = 0;

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

              speedRef.current.bytes += buf.byteLength;
              const now = Date.now();
              const dt  = (now - speedRef.current.ts) / 1000;
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

  const send = useCallback(async () => {
    if (!recipientEmail || files.length === 0) return;
    setGlobalError('');
    setPhase('uploading');

    try {
      const tid = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
      setTransferId(tid);

      await uploadAll(tid);

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
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Transfer failed');
      setPhase('error');
    }
  }, [senderEmail, recipientEmail, files, message, uploadAll]);

  const reset = useCallback(() => {
    setFiles([]);
    setRecipientEmail('');
    setMessage('');
    setTransferId(null);
    setPhase('idle');
    setDownloadUrl('');
    setGlobalError('');
    setSpeed('');
  }, []);

  const totalSize  = files.reduce((s, f) => s + f.file.size, 0);
  const canSend    = !!(recipientEmail && files.length > 0 && phase === 'idle');

  return {
    files, addFiles, removeFile,
    recipientEmail, setRecipientEmail,
    message, setMessage,
    phase, send, reset,
    downloadUrl, globalError,
    totalSize, speed,
    canSend,
  };
}

/* ── Page ───────────────────────────────────────────────────────────── */
export default function TransferPage() {
  const user = useAuthStore(s => s.user);
  const senderEmail = user?.email ?? '';

  const t = useTransfer(senderEmail);
  const [cardOpen, setCardOpen] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => { t.addFiles(files); setCardOpen(true); },
    multiple: true,
    disabled: t.phase !== 'idle',
    noClick: true,
  });

  const openCard = () => setCardOpen(true);
  const closeCard = () => {
    if (t.phase === 'idle' || t.phase === 'done' || t.phase === 'error') {
      setCardOpen(false);
      if (t.phase === 'done' || t.phase === 'error') t.reset();
    }
  };

  const isUploading     = t.phase === 'uploading' || t.phase === 'sending';
  const overallProgress = t.files.length > 0
    ? Math.round(t.files.reduce((s, f) => s + f.progress, 0) / t.files.length)
    : 0;

  return (
    <div
      {...getRootProps()}
      className={`min-h-[calc(100vh-56px)] flex flex-col relative transition-colors overflow-x-hidden ${
        isDragActive ? 'bg-brand-green-500/5' : ''
      }`}
      style={{ transitionDuration: 'var(--duration-base)' }}
    >
      <input {...getInputProps()} />

      {/* ── Drag overlay hint ───────────────────────────────────────── */}
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-2xl bg-brand-green-500/20 border-2 border-dashed border-brand-green-500 flex items-center justify-center">
              <Upload size={32} className="text-brand-green-400" />
            </div>
            <p className="text-brand-green-400 font-semibold text-lg">Drop to transfer</p>
          </div>
        </div>
      )}

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-lg mx-auto animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-3">
            Send files to anyone
          </h1>
          <p className="text-zinc-400 text-sm sm:text-base mb-8 max-w-sm mx-auto">
            Drop stems, sessions, or mixes — we'll package and email a download link. Expires in 14 days.
          </p>
          <button
            onClick={openCard}
            className="btn-primary text-base px-8 py-3"
          >
            <Upload size={17} />
            Send files
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* ── My Transfers ────────────────────────────────────────────── */}
      <MyTransfers />

      {/* ── Modal overlay ───────────────────────────────────────────── */}
      {cardOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeCard(); }}
        >
          <div className="w-full max-w-lg bg-surface-100 border border-surface-300 rounded-2xl shadow-2xl animate-fade-in overflow-hidden">

            {/* Done state */}
            {t.phase === 'done' ? (
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-brand-green-500/15 border border-brand-green-500/30 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 size={28} className="text-brand-green-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Transfer sent!</h2>
                <p className="text-zinc-400 text-sm mb-5">
                  Emails delivered. Files expire in 14 days.
                </p>
                <div className="bg-surface-200 border border-surface-300 rounded-lg px-4 py-3 mb-6 text-left">
                  <p className="text-[10px] text-zinc-600 mb-1 uppercase tracking-widest">Download link</p>
                  <p className="text-xs text-brand-green-400 break-all font-mono">{t.downloadUrl}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => navigator.clipboard.writeText(t.downloadUrl)}
                    className="btn-ghost flex-1 text-sm"
                  >
                    Copy Link
                  </button>
                  <button onClick={() => { t.reset(); }} className="btn-primary flex-1 text-sm">
                    New Transfer
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-surface-300">
                  <h2 className="text-sm font-semibold text-white">Send a transfer</h2>
                  <button
                    onClick={closeCard}
                    disabled={isUploading}
                    className="p-1.5 rounded-lg hover:bg-surface-300 text-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    style={{ transitionDuration: 'var(--duration-fast)' }}
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {/* Inner drop zone */}
                  <InnerDropZone
                    onDrop={t.addFiles}
                    disabled={isUploading}
                    hasFiles={t.files.length > 0}
                  />

                  {/* File list */}
                  {t.files.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-widest">
                          {t.files.length} file{t.files.length !== 1 ? 's' : ''} · {formatBytes(t.totalSize)}
                        </p>
                        {t.speed && (
                          <p className="text-[10px] text-brand-green-400 font-mono">{t.speed}</p>
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
                      {isUploading && (
                        <div className="pt-0.5">
                          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
                            <span>{t.phase === 'sending' ? 'Processing & sending emails…' : `Uploading… ${overallProgress}%`}</span>
                            <span className="tabular-nums">{overallProgress}%</span>
                          </div>
                          <div className="h-0.5 bg-surface-300 rounded-full overflow-hidden">
                            <div className="upload-bar bg-brand-green-400" style={{ width: `${overallProgress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* From field — read-only, shown only when authenticated */}
                  {senderEmail && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-200 border border-surface-300">
                      <span className="text-[10px] text-zinc-600 uppercase tracking-widest flex-shrink-0">From</span>
                      <span className="text-xs text-zinc-400 truncate">{senderEmail}</span>
                    </div>
                  )}

                  {/* Recipient */}
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

                  <div>
                    <label className="label">Message <span className="text-zinc-700">(optional)</span></label>
                    <textarea
                      value={t.message}
                      onChange={e => t.setMessage(e.target.value)}
                      className="input resize-none"
                      rows={2}
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
                        <Send size={14} />
                        Send Transfer
                        <ArrowRight size={13} />
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-zinc-700 text-center">
                    Encrypted in transit · auto-deleted after 14 days
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inner drop zone (inside modal) ─────────────────────────────────── */
function InnerDropZone({
  onDrop,
  disabled,
  hasFiles,
}: {
  onDrop: (files: File[]) => void;
  disabled: boolean;
  hasFiles: boolean;
}) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      onClick={open}
      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
        isDragActive
          ? 'border-brand-green-500 bg-brand-green-500/8'
          : disabled
          ? 'border-surface-300 opacity-50 cursor-not-allowed'
          : hasFiles
          ? 'border-surface-400 hover:border-brand-green-500/40 py-3'
          : 'border-surface-400 hover:border-brand-green-500/40 hover:bg-surface-200/30'
      }`}
      style={{ transitionDuration: 'var(--duration-base)' }}
    >
      <input {...getInputProps()} />
      {hasFiles ? (
        <p className="text-xs text-zinc-500">
          {isDragActive ? 'Drop to add more' : '+ Add more files'}
        </p>
      ) : (
        <>
          <Upload size={22} className={`mx-auto mb-2 ${isDragActive ? 'text-brand-green-400' : 'text-zinc-600'}`} />
          <p className="text-white font-medium text-sm">
            {isDragActive ? 'Drop files here' : 'Drag files or click to browse'}
          </p>
          <p className="text-zinc-600 text-xs mt-0.5">any file type · no size limit</p>
        </>
      )}
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
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-200 border border-surface-300">
      <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
        {isAudio
          ? <Music    size={12} className="text-brand-green-400" />
          : <FileIcon size={12} className="text-zinc-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white truncate max-w-[200px] font-medium">{entry.file.name}</span>
          <span className="text-[10px] text-zinc-500 ml-2 flex-shrink-0">{formatBytes(entry.file.size)}</span>
        </div>
        {entry.status === 'uploading' && (
          <div className="mt-1 h-0.5 bg-surface-300 rounded-full overflow-hidden">
            <div className="upload-bar bg-brand-green-400" style={{ width: `${entry.progress}%` }} />
          </div>
        )}
        {entry.status === 'error' && (
          <p className="text-[10px] text-red-400 mt-0.5">{entry.error}</p>
        )}
      </div>

      {entry.status === 'done'  && <CheckCircle2 size={14} className="text-brand-green-400 flex-shrink-0" />}
      {entry.status === 'error' && <AlertCircle  size={14} className="text-red-400 flex-shrink-0" />}

      {canRemove && entry.status !== 'uploading' && (
        <button
          onClick={onRemove}
          className="p-1 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400 flex-shrink-0 transition-colors"
          style={{ transitionDuration: 'var(--duration-fast)' }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/* ── My Transfers section ────────────────────────────────────────────── */
function MyTransfers() {
  const { data: transfers = [], isLoading } = useQuery<MyTransfer[]>({
    queryKey: ['my-transfers'],
    queryFn:  () => api.get('/transfer/my'),
    staleTime: 30_000,
  });

  return (
    <section className="px-6 pb-16 max-w-3xl mx-auto w-full">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
        My Transfers
      </h2>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl bg-surface-100 animate-pulse" />
          ))}
        </div>
      ) : transfers.length === 0 ? (
        <div className="card border-dashed text-center py-8">
          <Send size={20} className="text-zinc-600 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">No transfers yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transfers.map(t => <TransferRow key={t.id} transfer={t} />)}
        </div>
      )}
    </section>
  );
}

function TransferRow({ transfer: t }: { transfer: MyTransfer }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const downloadUrl = t.download_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/transfer/download/${t.download_token}`
    : null;

  const { data: events, isFetching } = useQuery<DownloadEvent[]>({
    queryKey: ['transfer-downloads', t.id],
    queryFn:  () => api.get(`/transfer/${t.id}/downloads`),
    enabled:  open,
    staleTime: 15_000,
  });

  const fileList = t.file_names
    ? t.file_names.split('||').slice(0, 3)
    : [];
  const extraFiles = (t.file_count ?? 0) - fileList.length;

  const isExpired  = new Date(t.expires_at) < new Date();
  const isPending  = t.status === 'uploading';
  const isFailed   = t.status === 'failed';

  const copyLink = () => {
    if (!downloadUrl) return;
    navigator.clipboard.writeText(downloadUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-surface-100 border border-surface-300 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isFailed ? 'bg-red-500' :
          isPending ? 'bg-yellow-400 animate-pulse' :
          isExpired ? 'bg-zinc-600' :
          'bg-brand-green-400'
        }`} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-white truncate max-w-[200px]">
              To: {t.recipient_email}
            </span>
            {fileList.length > 0 && (
              <span className="text-[10px] text-zinc-600 truncate">
                {fileList.join(', ')}{extraFiles > 0 ? ` +${extraFiles} more` : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-zinc-600 flex items-center gap-1">
              <Clock size={9} />
              {new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            {!isPending && !isFailed && (
              <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                <Download size={9} />
                {t.download_count} / {t.max_downloads} downloads
              </span>
            )}
            {isPending && <span className="text-[10px] text-yellow-400">Processing…</span>}
            {isFailed  && <span className="text-[10px] text-red-400">Failed</span>}
            {isExpired && !isPending && !isFailed && <span className="text-[10px] text-zinc-600">Expired</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {downloadUrl && !isExpired && !isFailed && !isPending && (
            <button
              onClick={copyLink}
              title="Copy download link"
              className="p-1.5 rounded-lg hover:bg-surface-300 text-zinc-500 hover:text-brand-green-400 transition-colors"
              style={{ transitionDuration: 'var(--duration-fast)' }}
            >
              {copied ? <CheckCircle2 size={13} className="text-brand-green-400" /> : <LinkIcon size={13} />}
            </button>
          )}
          {t.download_count > 0 && (
            <button
              onClick={() => setOpen(o => !o)}
              title="Show download history"
              className="p-1.5 rounded-lg hover:bg-surface-300 text-zinc-500 hover:text-white transition-colors flex items-center gap-1"
              style={{ transitionDuration: 'var(--duration-fast)' }}
            >
              <Users size={13} />
              {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
        </div>
      </div>

      {/* Download link bar */}
      {downloadUrl && !isExpired && !isFailed && !isPending && (
        <div className="px-4 pb-2.5 -mt-1">
          <p className="text-[10px] text-brand-green-400 font-mono truncate opacity-60">{downloadUrl}</p>
        </div>
      )}

      {/* Download events */}
      {open && (
        <div className="border-t border-surface-300 px-4 py-3">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">Download History</p>
          {isFetching ? (
            <p className="text-xs text-zinc-600">Loading…</p>
          ) : events && events.length > 0 ? (
            <div className="space-y-1.5">
              {events.map((ev, i) => (
                <div key={ev.id} className="flex items-start gap-2 text-[11px]">
                  <span className="text-zinc-600 flex-shrink-0 tabular-nums">#{i + 1}</span>
                  <span className="text-zinc-400">
                    {new Date(ev.downloaded_at).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  {ev.ip && (
                    <span className="text-zinc-600 font-mono">{ev.ip}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">No download events recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
