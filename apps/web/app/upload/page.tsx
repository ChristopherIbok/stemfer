'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ChunkedUploader } from '@/components/upload/ChunkedUploader';
import type { Project } from '@stemfer/shared/types';

export default function UploadPage() {
  const [projectId, setProjectId] = useState('');
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn:  () => api.get('/projects'),
  });

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Upload Files</h1>
        <p className="text-zinc-500 text-sm mt-1">Upload audio or DAW project files to a project.</p>
      </div>

      <div>
        <label className="label">Destination Project</label>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="input"
        >
          <option value="">Select a project…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {projectId ? (
        <ChunkedUploader projectId={projectId} />
      ) : (
        <div className="card py-16 text-center text-zinc-600 text-sm border-dashed">
          Select a project above to enable upload.
        </div>
      )}
    </div>
  );
}
