'use client';

import { useCallback, useState, useRef } from 'react';
import { useDropzone }  from 'react-dropzone';
import { useUploadStore } from '@/store/useUploadStore';
import {
  Upload, X, Pause, Play, CheckCircle2, AlertCircle, Music, File,
  Wifi, WifiOff,
} from 'lucide-react';

interface Props {
  projectId: string;
  sessionId?: string;
  onUploadComplete?: (fileId: string) => void;
}


export function ChunkedUploader({ projectId, sessionId, onUploadComplete }: Props) {
  const { uploads, startUpload, pauseUpload, resumeUpload, abortUpload } = useUploadStore();

  /* Map fileId → File object so we can resume with the original File */
  const fileMapRef = useRef<Map<string, File>>(new Map());

  const onDrop = useCallback(async (accepted: File[]) => {
    /* Sequential starts — initUpload is fast, actual uploading is parallel */
    for (const file of accepted) {
      try {
        const fileId = await startUpload(file, projectId, sessionId);
        fileMapRef.current.set(fileId, file);
        onUploadComplete?.(fileId);
      } catch {
        /* Error is tracked in upload state */
      }
    }
  }, [startUpload, projectId, sessionId, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const activeUploads = Array.from(uploads.entries());
  const hasActive     = activeUploads.some(([, s]) => s.status === 'uploading' || s.status === 'paused');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer ${
          isDragActive
            ? 'border-brand-green-500 bg-brand-green-500/8'
            : 'border-surface-400 hover:border-brand-green-500/40 hover:bg-surface-200/40'
        }`}
        style={{ transition: 'border-color var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out)' }}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          <div
            className={`p-4 rounded-full ${isDragActive ? 'bg-brand-green-500/20' : 'bg-surface-300'}`}
            style={{ transition: 'background-color var(--duration-base) var(--ease-out)' }}
          >
            <Upload
              size={26}
              className={isDragActive ? 'text-brand-green-400' : 'text-zinc-500'}
              style={{ transition: 'color var(--duration-base) var(--ease-out)' }}
            />
          </div>
          <div>
            <p className="text-white font-medium text-sm">
              {isDragActive ? 'Drop to upload' : 'Drag & drop any file'}
            </p>
            <p className="text-zinc-600 text-xs mt-1">
              All file types are supported
            </p>
          </div>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={e => e.stopPropagation()}
          >
            Browse Files
          </button>
        </div>
      </div>

      {/* Active uploads */}
      {activeUploads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-widest">
              Uploads
            </h3>
            {hasActive && (
              <span className="flex items-center gap-1 text-[10px] text-brand-green-400">
                <Wifi size={10} />
                Uploading
              </span>
            )}
          </div>

          {activeUploads.map(([fileId, state]) => (
            <UploadItem
              key={fileId}
              state={state}
              fileId={fileId}
              onPause={() => pauseUpload(fileId)}
              onResume={async () => {
                const file = fileMapRef.current.get(fileId);
                if (file) await resumeUpload(fileId, file);
              }}
              onAbort={() => abortUpload(fileId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Single upload item ─────────────────────────────────────────────────── */
function UploadItem({
  state,
  fileId,
  onPause,
  onResume,
  onAbort,
}: {
  state: any;
  fileId: string;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
}) {
  const isAudio  = /\.(wav|mp3|aiff|flac|ogg|m4a)$/i.test(state.r2Key ?? '');
  const fileName = state.r2Key?.split('/').pop() ?? fileId;

  const statusColor =
    state.status === 'complete' ? 'bg-brand-green-500' :
    state.status === 'error'    ? 'bg-red-500' :
    state.status === 'paused'   ? 'bg-amber-500' :
    'bg-brand-green-400';

  return (
    <div className="card flex items-center gap-3 py-2.5 px-3">
      {/* Icon */}
      <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
        {isAudio
          ? <Music size={14} className="text-brand-green-400" />
          : <File  size={14} className="text-brand-purple-400" />}
      </div>

      {/* Progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-white truncate max-w-[200px]">{fileName}</span>
          <span className="text-[10px] text-zinc-500 ml-2 flex-shrink-0 tabular-nums">
            {state.status === 'complete' ? 'Done'
              : state.status === 'error' ? 'Error'
              : state.status === 'paused' ? 'Paused'
              : `${state.progress}%`}
          </span>
        </div>
        <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
          <div
            className={`upload-bar ${statusColor}`}
            style={{ width: `${state.progress}%` }}
          />
        </div>
        {state.error && <p className="text-[10px] text-red-400 mt-1">{state.error}</p>}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {state.status === 'complete' && <CheckCircle2 size={16} className="text-brand-green-400" />}
        {state.status === 'error'    && <AlertCircle  size={16} className="text-red-400" />}
        {state.status === 'uploading' && (
          <button
            onClick={onPause}
            className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white"
            title="Pause"
            style={{ transition: 'background-color var(--duration-fast)' }}
          >
            <Pause size={13} />
          </button>
        )}
        {state.status === 'paused' && (
          <button
            onClick={onResume}
            className="p-1.5 rounded hover:bg-surface-300 text-zinc-400 hover:text-white"
            title="Resume"
            style={{ transition: 'background-color var(--duration-fast)' }}
          >
            <Play size={13} />
          </button>
        )}
        {state.status !== 'complete' && (
          <button
            onClick={onAbort}
            className="p-1.5 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400"
            title="Cancel"
            style={{ transition: 'background-color var(--duration-fast), color var(--duration-fast)' }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
