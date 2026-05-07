'use client';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Folder, AudioFile } from '@stemfer/shared/types';
import {
  FolderOpen, FolderPlus, ChevronRight, Home,
  Trash2, Music2, GitBranch, File, Download,
  MoreHorizontal, FolderInput, Check, X,
} from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { formatDuration } from '@stemfer/shared/utils/timecode';

interface Props {
  projectId: string;
  memberRole: string;
}

interface Breadcrumb {
  id: string | null;
  name: string;
}

export function FolderBrowser({ projectId, memberRole }: Props) {
  const qc = useQueryClient();
  const canEdit = ['owner', 'admin', 'editor'].includes(memberRole);

  // Navigation state
  const [folderId, setFolderId]       = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: 'Root' }]);

  // UI state
  const [creating, setCreating]       = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteFolder, setDeleteFolder]   = useState<Folder | null>(null);
  const [deleteFile, setDeleteFile]       = useState<AudioFile | null>(null);
  const [movingFileId, setMovingFileId]   = useState<string | null>(null);

  // Queries
  const { data: folders = [], isLoading: loadingFolders } = useQuery<Folder[]>({
    queryKey: ['folders', projectId, folderId],
    queryFn:  () => api.get('/folders', { projectId, ...(folderId ? { parentId: folderId } : {}) }),
    staleTime: 60_000,
  });

  const { data: files = [], isLoading: loadingFiles } = useQuery<AudioFile[]>({
    queryKey: ['files', projectId, 'folder', folderId ?? 'root'],
    queryFn:  () => api.get('/files', { projectId, folderId: folderId ?? 'root' }),
    staleTime: 60_000,
  });

  // Mutations
  const createFolder = useMutation({
    mutationFn: (name: string) =>
      api.post('/folders', { projectId, parentId: folderId, name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders', projectId, folderId] });
      setCreating(false);
      setNewFolderName('');
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/folders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders', projectId, folderId] });
      qc.invalidateQueries({ queryKey: ['files', projectId, 'folder', folderId ?? 'root'] });
      setDeleteFolder(null);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/files/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', projectId, 'folder', folderId ?? 'root'] });
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      setDeleteFile(null);
    },
  });

  const moveFileMutation = useMutation({
    mutationFn: ({ fileId, targetFolderId }: { fileId: string; targetFolderId: string | null }) =>
      api.patch(`/files/${fileId}`, { folder_id: targetFolderId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      setMovingFileId(null);
    },
  });

  // Navigation
  const navigateInto = useCallback((folder: Folder) => {
    setFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
  }, []);

  const navigateTo = useCallback((crumb: Breadcrumb, index: number) => {
    setFolderId(crumb.id);
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }, []);

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder.mutate(name);
  }, [newFolderName, createFolder]);

  const isLoading = loadingFolders || loadingFiles;
  const isEmpty = !isLoading && folders.length === 0 && files.length === 0;

  return (
    <div className="space-y-4">
      {/* Breadcrumb nav */}
      <div className="flex items-center gap-1 flex-wrap">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-zinc-600" />}
            <button
              onClick={() => navigateTo(crumb, i)}
              className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 transition-colors ${
                i === breadcrumbs.length - 1
                  ? 'text-white font-medium'
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {i === 0 && <Home size={11} />}
              {crumb.name}
            </button>
          </span>
        ))}

        {/* New folder button */}
        {canEdit && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500 hover:text-brand-green-400 transition-colors"
          >
            <FolderPlus size={14} />
            New folder
          </button>
        )}
      </div>

      {/* Create folder inline input */}
      {creating && (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-surface-300">
            <FolderOpen size={14} className="text-brand-green-400" />
          </div>
          <input
            autoFocus
            type="text"
            placeholder="Folder name"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setCreating(false); setNewFolderName(''); }
            }}
            className="input h-8 text-sm flex-1 max-w-xs"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || createFolder.isPending}
            className="p-1.5 rounded bg-brand-green-500/15 text-brand-green-400 hover:bg-brand-green-500/25 transition-colors disabled:opacity-40"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => { setCreating(false); setNewFolderName(''); }}
            className="p-1.5 rounded hover:bg-surface-300 text-zinc-600 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Column header */}
      {!isEmpty && (
        <div
          className="grid gap-4 px-4 py-1.5 text-[10px] text-zinc-600 uppercase tracking-widest font-medium"
          style={{ gridTemplateColumns: 'auto 1fr auto auto' }}
        >
          <span />
          <span>Name</span>
          <span>Items</span>
          <span />
        </div>
      )}

      {isLoading && (
        <div className="space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-11 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Folders */}
      {!isLoading && folders.map(folder => (
        <div
          key={folder.id}
          className="grid gap-4 items-center px-4 py-2.5 rounded-lg hover:bg-surface-200 group cursor-pointer"
          style={{ gridTemplateColumns: 'auto 1fr auto auto' }}
          onClick={() => navigateInto(folder)}
        >
          <div className="p-1.5 rounded bg-brand-green-500/10 flex-shrink-0">
            <FolderOpen size={14} className="text-brand-green-400" />
          </div>
          <span className="text-sm text-white font-medium truncate">{folder.name}</span>
          <span className="text-xs text-zinc-500">
            {folder.file_count + folder.child_count > 0
              ? `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}${folder.child_count > 0 ? `, ${folder.child_count} folder${folder.child_count !== 1 ? 's' : ''}` : ''}`
              : 'Empty'}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <button
                onClick={e => { e.stopPropagation(); setDeleteFolder(folder); }}
                className="p-1.5 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400 transition-colors"
                title="Delete folder"
              >
                <Trash2 size={12} />
              </button>
            )}
            <ChevronRight size={14} className="text-zinc-600 ml-1" />
          </div>
        </div>
      ))}

      {/* Files */}
      {!isLoading && files.map(file => (
        <FileRow
          key={file.id}
          file={file}
          projectId={projectId}
          canEdit={canEdit}
          folders={folders}
          folderId={folderId}
          movingFileId={movingFileId}
          setMovingFileId={setMovingFileId}
          onDelete={() => setDeleteFile(file)}
          onMove={(targetId) => moveFileMutation.mutate({ fileId: file.id, targetFolderId: targetId })}
        />
      ))}

      {isEmpty && (
        <div className="text-center py-12 text-zinc-600">
          <FolderOpen size={32} className="mx-auto mb-3 text-zinc-700" />
          <p className="text-sm text-zinc-500">This folder is empty</p>
          {canEdit && (
            <p className="text-xs text-zinc-600 mt-1">
              Upload files or create a subfolder above.
            </p>
          )}
        </div>
      )}

      {/* Confirm delete folder */}
      <ConfirmModal
        open={!!deleteFolder}
        title={`Delete "${deleteFolder?.name}"?`}
        description="Files inside will be moved to the current folder. Subfolders will also be deleted."
        confirmLabel="Delete folder"
        danger
        loading={deleteFolderMutation.isPending}
        onConfirm={() => deleteFolder && deleteFolderMutation.mutate(deleteFolder.id)}
        onCancel={() => setDeleteFolder(null)}
      />

      {/* Confirm delete file */}
      <ConfirmModal
        open={!!deleteFile}
        title={`Delete "${deleteFile?.original_name}"?`}
        description="This will permanently remove the file and its R2 storage object. This cannot be undone."
        confirmLabel="Delete file"
        danger
        loading={deleteFileMutation.isPending}
        onConfirm={() => deleteFile && deleteFileMutation.mutate(deleteFile.id)}
        onCancel={() => setDeleteFile(null)}
      />
    </div>
  );
}

/* ── FileRow ─────────────────────────────────────────────────────────────── */
function FileRow({
  file, projectId, canEdit, folders, folderId,
  movingFileId, setMovingFileId, onDelete, onMove,
}: {
  file: AudioFile;
  projectId: string;
  canEdit: boolean;
  folders: Folder[];
  folderId: string | null;
  movingFileId: string | null;
  setMovingFileId: (id: string | null) => void;
  onDelete: () => void;
  onMove: (targetFolderId: string | null) => void;
}) {
  const isAudio = file.file_type === 'audio';
  const isDaw   = file.file_type === 'daw_project';

  return (
    <div
      className="grid gap-4 items-center px-4 py-2.5 rounded-lg hover:bg-surface-200 group"
      style={{ gridTemplateColumns: 'auto 1fr auto auto' }}
    >
      <div className="p-1.5 rounded bg-surface-300 flex-shrink-0">
        {isAudio ? <Music2 size={13} className="text-brand-green-400" /> :
         isDaw    ? <GitBranch size={13} className="text-purple-400" /> :
                    <File size={13} className="text-zinc-500" />}
      </div>

      <div className="min-w-0">
        <p className="text-sm text-white truncate font-medium">{file.original_name}</p>
        <p className="text-[10px] text-zinc-500 mt-0.5">
          {file.duration_ms ? formatDuration(file.duration_ms) : '—'}
          {' · '}{formatFileSize(file.size_bytes)}
        </p>
      </div>

      {/* Move to folder dropdown */}
      {movingFileId === file.id && (
        <div className="relative">
          <select
            autoFocus
            className="input text-xs py-1 h-auto pr-6 max-w-[140px]"
            defaultValue=""
            onChange={e => {
              const val = e.target.value;
              onMove(val === '__root__' ? null : val || null);
            }}
            onBlur={() => setMovingFileId(null)}
          >
            <option value="" disabled>Move to…</option>
            {folderId && <option value="__root__">↑ Root</option>}
            {folders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={`${process.env.NEXT_PUBLIC_API_URL}/files/${file.id}/download`}
          className="p-1.5 rounded hover:bg-surface-300 text-zinc-600 hover:text-white transition-colors"
          title="Download"
          onClick={e => e.stopPropagation()}
        >
          <Download size={12} />
        </a>
        {canEdit && (
          <>
            <button
              onClick={() => setMovingFileId(movingFileId === file.id ? null : file.id)}
              className="p-1.5 rounded hover:bg-surface-300 text-zinc-600 hover:text-white transition-colors"
              title="Move to folder"
            >
              <FolderInput size={12} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded hover:bg-red-500/15 text-zinc-600 hover:text-red-400 transition-colors"
              title="Delete file"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
