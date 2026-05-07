export type Plan = 'free' | 'pro' | 'studio';
export type FileType = 'audio' | 'daw_project' | 'document' | 'other';
export type DAWType = 'logic' | 'ableton' | 'studio_one' | 'protools' | 'reaper' | null;
export type ProcessingStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'deleted';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: 'user' | 'admin';
  plan: Plan;
  storage_used: number;
  storage_limit_bytes: number;
  created_at: string;
}

export interface Project {
  id: string;
  owner_id: string;
  team_id?: string;
  name: string;
  description?: string;
  color: string;
  bpm?: number;
  time_sig: string;
  sample_rate: number;
  status: 'active' | 'archived' | 'deleted';
  member_role: 'owner' | 'admin' | 'editor' | 'viewer';
  file_count: number;
  session_count: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  bpm?: number;
  time_sig?: string;
  sample_rate: number;
  status: 'draft' | 'active' | 'completed';
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface AudioFile {
  id: string;
  project_id: string;
  session_id?: string;
  uploaded_by: string;
  uploader_name?: string;

  // Storage
  r2_key: string;
  file_url: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;

  // Type
  file_type: FileType;
  daw_type?: DAWType;

  // Audio metadata
  duration_ms?: number;
  sample_rate?: number;
  bit_depth?: number;
  channels?: number;
  bpm?: number;
  time_signature?: string;

  // Timeline
  start_timecode: string;
  offset_ms: number;
  timeline_track: number;
  is_locked: boolean;
  is_muted: boolean;
  group_id?: string;

  // Analysis
  analyzed: boolean;
  leading_silence_ms?: number;
  first_transient_ms?: number;
  waveform_data?: number[];
  bwf_timecode?: string;

  // Version
  version: number;
  parent_file_id?: string;

  // Access
  download_count: number;
  download_limit?: number;
  expires_at?: string;

  processing_status: ProcessingStatus;
  processing_error?: string;

  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: Plan;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  storage_limit_bytes: number;
  upload_limit_bytes: number;
  max_projects: number;
  team_seats: number;
  current_period_end?: string;
  cancel_at_period_end: boolean;
}

export interface ActivityLog {
  id: string;
  project_id?: string;
  user_id?: string;
  user_name?: string;
  avatar_url?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface TimelineClip {
  fileId: string;
  track: number;
  offsetMs: number;
  durationMs: number;
  startTimecode: string;
  label: string;
  waveformData: number[];
  color?: string;
  isLocked: boolean;
  isMuted: boolean;
  groupId?: string;
}

export interface ChunkUploadState {
  fileId: string;
  uploadId: string;
  r2Key: string;
  totalChunks: number;
  uploadedChunks: Set<number>;
  progress: number;
  status: 'idle' | 'uploading' | 'paused' | 'complete' | 'error';
  error?: string;
}
