'use client';

import { useEffect, useState } from 'react';
import { useParams }           from 'next/navigation';
import { Download, Clock, AlertCircle, Music2 } from 'lucide-react';

interface StatusPayload {
  status:        string;  // 'uploading' | 'processing' | 'ready' | 'failed'
  message?:      string;
  zip_size_bytes?: number | null;
  expires_at?:   string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

export default function TransferDownloadPage() {
  const { token } = useParams<{ token: string }>();

  const [status,      setStatus]      = useState<'loading' | 'ready' | 'processing' | 'error'>('loading');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [zipSize,     setZipSize]     = useState<number | null>(null);
  const [expiresAt,   setExpiresAt]   = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        /* HEAD the download URL to check status without consuming the download */
        const res = await fetch(`${API}/transfer/status/${token}`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            setErrorMsg(err.error ?? 'Transfer not found or expired.');
            setStatus('error');
            return;
          }
          setErrorMsg(`Server error (${res.status})`);
          setStatus('error');
          return;
        }

        const data = await res.json() as StatusPayload;

        if (data.status === 'ready') {
          setZipSize(data.zip_size_bytes ?? null);
          setExpiresAt(data.expires_at ?? '');
          setStatus('ready');
        } else if (data.status === 'failed') {
          setErrorMsg('Transfer processing failed. Please ask the sender to retry.');
          setStatus('error');
        } else {
          /* Still processing — poll again */
          setStatus('processing');
          if (!stopped) setTimeout(poll, 3000);
        }
      } catch {
        setErrorMsg('Could not reach server. Please refresh and try again.');
        setStatus('error');
      }
    }

    poll();
    return () => { stopped = true; };
  }, [token]);

  const handleDownload = () => {
    setDownloading(true);
    /* Navigate directly — browser handles Content-Disposition: attachment */
    window.location.href = `${API}/transfer/download/${token}`;
    setTimeout(() => setDownloading(false), 3000);
  };

  const expiryStr = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-10 flex items-center gap-2 text-brand-green-400">
        <Music2 size={20} />
        <span className="text-xl font-bold tracking-tight">Stemfer</span>
      </div>

      <div className="w-full max-w-sm">
        {/* Loading */}
        {status === 'loading' && (
          <div className="card space-y-4 animate-pulse pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-surface-300 mx-auto" />
            <div className="h-5 w-40 bg-surface-300 rounded mx-auto" />
            <div className="h-4 w-28 bg-surface-300 rounded mx-auto" />
            <div className="h-px bg-surface-300" />
            <div className="h-11 bg-surface-300 rounded-lg" />
          </div>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <div className="card text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-brand-green-500/10 border border-brand-green-500/20 flex items-center justify-center mx-auto animate-pulse">
              <Download size={24} className="text-brand-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white mb-2">Preparing your files…</h2>
              <p className="text-zinc-500 text-sm">Files are being compressed. This page updates automatically.</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
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
        {status === 'ready' && (
          <div className="card space-y-5 animate-fade-in">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-brand-green-500/12 border border-brand-green-500/25 flex items-center justify-center">
                <Download size={24} className="text-brand-green-400" />
              </div>
            </div>

            <div className="text-center">
              <h2 className="text-lg font-bold text-white mb-1">Files ready</h2>
              {zipSize && (
                <p className="text-zinc-500 text-sm">{formatBytes(zipSize)} compressed archive</p>
              )}
            </div>

            {expiryStr && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-600 py-3 border-y border-surface-300">
                <Clock size={11} />
                Expires {expiryStr}
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="btn-primary w-full justify-center text-sm"
            >
              <Download size={15} />
              {downloading ? 'Starting download…' : 'Download Files'}
            </button>

            <p className="text-[10px] text-zinc-700 text-center">
              No account needed. Files auto-delete after expiry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
