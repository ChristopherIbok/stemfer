'use client';

import { useEffect, useState } from 'react';
import { useParams }           from 'next/navigation';
import { Download, Clock, AlertCircle, Music2, File as FileIcon, Music } from 'lucide-react';

interface FileEntry {
  id:        string;
  name:      string;
  mimeType:  string;
  sizeBytes: number;
}

interface TransferPayload {
  senderEmail:   string;
  message:       string | null;
  expiresAt:     string;
  downloadsLeft: number;
  files:         FileEntry[];
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

export default function TransferDownloadPage() {
  const { token } = useParams<{ token: string }>();

  const [phase,    setPhase]    = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [transfer, setTransfer] = useState<TransferPayload | null>(null);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/transfer/download/${token}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          setErrorMsg(err.error ?? `Error ${res.status}`);
          setPhase('error');
          return;
        }
        const data = await res.json() as TransferPayload;
        setTransfer(data);
        setPhase('ready');
      } catch {
        setErrorMsg('Could not reach server. Please refresh and try again.');
        setPhase('error');
      }
    }
    load();
  }, [token]);

  const downloadFile = (file: FileEntry) => {
    setDownloading(prev => ({ ...prev, [file.id]: true }));
    window.location.href = `${API}/transfer/download/${token}/file/${file.id}`;
    setTimeout(() => setDownloading(prev => ({ ...prev, [file.id]: false })), 3000);
  };

  const expiryStr = transfer?.expiresAt
    ? new Date(transfer.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const totalSize = transfer?.files.reduce((s, f) => s + f.sizeBytes, 0) ?? 0;

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="mb-10 flex items-center gap-2 text-brand-green-400">
        <Music2 size={20} />
        <span className="text-xl font-bold tracking-tight">Stemfer</span>
      </div>

      <div className="w-full max-w-md">
        {/* Loading */}
        {phase === 'loading' && (
          <div className="card space-y-4 animate-pulse pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-surface-300 mx-auto" />
            <div className="h-5 w-40 bg-surface-300 rounded mx-auto" />
            <div className="h-4 w-28 bg-surface-300 rounded mx-auto" />
            <div className="h-px bg-surface-300" />
            <div className="h-11 bg-surface-300 rounded-lg" />
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="card text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertCircle size={24} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white mb-2">Transfer unavailable</h2>
              <p className="text-zinc-500 text-sm">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Ready */}
        {phase === 'ready' && transfer && (
          <div className="card space-y-5 animate-fade-in">
            {/* Header */}
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-brand-green-500/12 border border-brand-green-500/25 flex items-center justify-center mx-auto mb-4">
                <Download size={24} className="text-brand-green-400" />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">
                {transfer.files.length} {transfer.files.length === 1 ? 'file' : 'files'} from {transfer.senderEmail}
              </h2>
              <p className="text-zinc-500 text-sm">{formatBytes(totalSize)} total</p>
            </div>

            {/* Message */}
            {transfer.message && (
              <div className="bg-surface-200 border border-surface-300 rounded-lg px-4 py-3">
                <p className="text-sm text-zinc-400 italic">&ldquo;{transfer.message}&rdquo;</p>
              </div>
            )}

            {/* Expiry */}
            {expiryStr && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-600 py-3 border-y border-surface-300">
                <Clock size={11} />
                Expires {expiryStr}
              </div>
            )}

            {/* File list */}
            <div className="space-y-2">
              {transfer.files.map(file => {
                const isAudio = /\.(wav|mp3|aiff|flac|ogg|m4a)$/i.test(file.name);
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-200 border border-surface-300"
                  >
                    <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
                      {isAudio
                        ? <Music    size={12} className="text-brand-green-400" />
                        : <FileIcon size={12} className="text-zinc-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{file.name}</p>
                      <p className="text-[10px] text-zinc-500">{formatBytes(file.sizeBytes)}</p>
                    </div>
                    <button
                      onClick={() => downloadFile(file)}
                      disabled={downloading[file.id]}
                      className="btn-ghost py-1 px-2 text-xs flex-shrink-0 disabled:opacity-50"
                    >
                      <Download size={12} />
                      {downloading[file.id] ? 'Starting…' : 'Download'}
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-zinc-700 text-center">
              No account needed · Files auto-delete after expiry
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
