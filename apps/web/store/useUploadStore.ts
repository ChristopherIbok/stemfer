'use client';
import { create } from 'zustand';
import { api } from '@/lib/api/client';
import type { ChunkUploadState } from '@stemfer/shared/types';

const CHUNK_SIZE  = 5 * 1024 * 1024;
const CONCURRENCY = 3;
const MAX_RETRIES = 3;

interface UploadStore {
  uploads: Map<string, ChunkUploadState>;
  addUpload:    (fileId: string, state: ChunkUploadState) => void;
  updateUpload: (fileId: string, partial: Partial<ChunkUploadState>) => void;
  removeUpload: (fileId: string) => void;
  startUpload:  (file: File, projectId: string, sessionId?: string, folderId?: string | null) => Promise<string>;
  pauseUpload:  (fileId: string) => void;
  resumeUpload: (fileId: string, file: File) => Promise<void>;
  abortUpload:  (fileId: string) => Promise<void>;
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  uploads: new Map(),

  addUpload(fileId, state) {
    set(s => { const m = new Map(s.uploads); m.set(fileId, state); return { uploads: m }; });
  },

  updateUpload(fileId, partial) {
    set(s => {
      const m = new Map(s.uploads);
      const existing = m.get(fileId);
      if (existing) m.set(fileId, { ...existing, ...partial });
      return { uploads: m };
    });
  },

  removeUpload(fileId) {
    set(s => { const m = new Map(s.uploads); m.delete(fileId); return { uploads: m }; });
  },

  async startUpload(file, projectId, sessionId, folderId) {
    const init = await api.post<{ uploadId: string; fileId: string; r2Key: string; totalChunks: number }>('/upload/init', {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size:     file.size,
      projectId,
      sessionId,
      ...(folderId != null ? { folderId } : {}),
    });

    const state: ChunkUploadState = {
      fileId:         init.fileId,
      uploadId:       init.uploadId,
      r2Key:          init.r2Key,
      totalChunks:    init.totalChunks,
      uploadedChunks: new Set(),
      progress:       0,
      status:         'uploading',
    };
    get().addUpload(init.fileId, state);

    await uploadParallel(file, init.fileId, init.uploadId, init.totalChunks, get);
    return init.fileId;
  },

  pauseUpload(fileId) {
    get().updateUpload(fileId, { status: 'paused' });
  },

  async resumeUpload(fileId, file) {
    const state = get().uploads.get(fileId);
    if (!state || state.status !== 'paused') return;
    get().updateUpload(fileId, { status: 'uploading' });
    await uploadParallel(file, fileId, state.uploadId, state.totalChunks, get);
  },

  async abortUpload(fileId) {
    const state = get().uploads.get(fileId);
    if (!state) return;
    await api.post('/upload/abort', { uploadId: state.uploadId, fileId }).catch(() => {});
    get().removeUpload(fileId);
  },
}));

async function uploadChunkWithRetry(
  file: File,
  chunkIndex: number,
  uploadId: string,
  fileId: string,
  retries = MAX_RETRIES
): Promise<{ partNumber: number; etag: string }> {
  const start  = chunkIndex * CHUNK_SIZE;
  const end    = Math.min(start + CHUNK_SIZE, file.size);
  const buffer = await file.slice(start, end).arrayBuffer();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await api.rawPost<{ etag: string; partNumber: number }>(
        '/upload/chunk',
        buffer,
        {
          'Content-Type':  'application/octet-stream',
          'X-Upload-Id':   uploadId,
          'X-Chunk-Index': String(chunkIndex),
          'X-File-Id':     fileId,
        }
      );
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error('Upload chunk failed after retries');
}

async function uploadParallel(
  file: File,
  fileId: string,
  uploadId: string,
  totalChunks: number,
  get: () => UploadStore
) {
  const parts: { partNumber: number; etag: string }[] = new Array(totalChunks);
  let uploaded = 0;
  let chunkIdx = 0;

  const worker = async () => {
    while (chunkIdx < totalChunks) {
      const state = get().uploads.get(fileId);
      if (state?.status === 'paused') return;

      const i = chunkIdx++;
      try {
        const res = await uploadChunkWithRetry(file, i, uploadId, fileId);
        parts[i] = res;
        uploaded++;
        const progress = Math.round((uploaded / totalChunks) * 100);
        get().updateUpload(fileId, { progress });
      } catch {
        get().updateUpload(fileId, { status: 'error', error: `Chunk ${i} failed` });
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalChunks) }, worker));

  const state = get().uploads.get(fileId);
  if (state?.status !== 'paused' && state?.status !== 'error' && uploaded === totalChunks) {
    await api.post('/upload/complete', { uploadId, fileId, parts });
    get().updateUpload(fileId, { status: 'complete', progress: 100 });
  }
}
