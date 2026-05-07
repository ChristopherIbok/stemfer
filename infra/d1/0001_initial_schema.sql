-- Stemfer D1 Database Schema
-- Migration: 0001_initial_schema

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- nanoid
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  password_hash TEXT,                      -- NULL for OAuth users
  provider      TEXT DEFAULT 'email',      -- email | google | apple
  provider_id   TEXT,
  role          TEXT DEFAULT 'user',       -- user | admin
  verified      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);

-- ─────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                  TEXT DEFAULT 'free',   -- free | pro | studio
  status                TEXT DEFAULT 'active', -- active | trialing | past_due | canceled | paused
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id       TEXT,
  current_period_start  TEXT,
  current_period_end    TEXT,
  cancel_at_period_end  INTEGER DEFAULT 0,
  storage_limit_bytes   INTEGER DEFAULT 5368709120,   -- 5 GB free
  upload_limit_bytes    INTEGER DEFAULT 524288000,    -- 500 MB free
  max_projects          INTEGER DEFAULT 3,
  team_seats            INTEGER DEFAULT 1,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_customer_id);

-- ─────────────────────────────────────────
-- TEAMS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'member',  -- owner | admin | member
  joined_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);

-- ─────────────────────────────────────────
-- PROJECTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#22c55e',
  bpm         REAL,
  time_sig    TEXT DEFAULT '4/4',
  sample_rate INTEGER DEFAULT 48000,
  status      TEXT DEFAULT 'active',  -- active | archived | deleted
  is_public   INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_team  ON projects(team_id);

-- ─────────────────────────────────────────
-- PROJECT MEMBERS (collaborators)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'viewer',  -- owner | editor | viewer
  added_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

-- ─────────────────────────────────────────
-- SESSIONS (studio sessions within projects)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  bpm         REAL,
  time_sig    TEXT,
  sample_rate INTEGER DEFAULT 48000,
  status      TEXT DEFAULT 'draft',   -- draft | active | completed
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_project ON sessions(project_id);

-- ─────────────────────────────────────────
-- FILES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  uploaded_by      TEXT NOT NULL REFERENCES users(id),

  -- Storage
  r2_key           TEXT NOT NULL UNIQUE,
  file_url         TEXT NOT NULL,
  filename         TEXT NOT NULL,
  original_name    TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER NOT NULL,

  -- Type classification
  file_type        TEXT DEFAULT 'audio',  -- audio | daw_project | document | other
  daw_type         TEXT,                  -- logic | ableton | studio_one | protools | reaper

  -- Audio metadata
  duration_ms      INTEGER,
  sample_rate      INTEGER,
  bit_depth        INTEGER,
  channels         INTEGER,
  bpm              REAL,
  time_signature   TEXT,

  -- Timeline / Timecode
  start_timecode   TEXT DEFAULT '00:00:00:000',  -- HH:MM:SS:MS
  offset_ms        INTEGER DEFAULT 0,
  timeline_track   INTEGER DEFAULT 0,
  is_locked        INTEGER DEFAULT 0,
  is_muted         INTEGER DEFAULT 0,
  group_id         TEXT,

  -- Analysis results
  analyzed         INTEGER DEFAULT 0,
  leading_silence_ms INTEGER,
  first_transient_ms INTEGER,
  waveform_data    TEXT,   -- JSON array of peak values for rendering
  bwf_timecode     TEXT,   -- Timecode embedded in BWF header

  -- Version control
  version          INTEGER DEFAULT 1,
  parent_file_id   TEXT REFERENCES files(id),

  -- Access
  is_public        INTEGER DEFAULT 0,
  download_limit   INTEGER,            -- NULL = unlimited
  download_count   INTEGER DEFAULT 0,
  expires_at       TEXT,

  -- Processing state
  processing_status TEXT DEFAULT 'pending',  -- pending | processing | complete | failed
  processing_error  TEXT,

  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_files_project   ON files(project_id);
CREATE INDEX idx_files_session   ON files(session_id);
CREATE INDEX idx_files_r2_key    ON files(r2_key);
CREATE INDEX idx_files_uploader  ON files(uploaded_by);
CREATE INDEX idx_files_parent    ON files(parent_file_id);

-- ─────────────────────────────────────────
-- UPLOAD CHUNKS (for resumable uploads)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_chunks (
  id          TEXT PRIMARY KEY,
  upload_id   TEXT NOT NULL,   -- multipart upload ID from R2
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  etag        TEXT,
  size_bytes  INTEGER,
  uploaded    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (upload_id, chunk_index)
);

CREATE INDEX idx_chunks_upload ON upload_chunks(upload_id);

-- ─────────────────────────────────────────
-- SHARE LINKS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS share_links (
  id             TEXT PRIMARY KEY,
  file_id        TEXT REFERENCES files(id) ON DELETE CASCADE,
  project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_by     TEXT NOT NULL REFERENCES users(id),
  token          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,
  download_limit INTEGER,
  download_count INTEGER DEFAULT 0,
  expires_at     TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_share_token ON share_links(token);

-- ─────────────────────────────────────────
-- CONVERSIONS / STEM EXTRACTION JOBS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversions (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  requested_by   TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,  -- stem_extract | format_convert | export
  status         TEXT DEFAULT 'queued',  -- queued | processing | complete | failed
  progress       INTEGER DEFAULT 0,
  input_r2_key   TEXT,
  output_r2_key  TEXT,
  output_url     TEXT,
  metadata       TEXT,           -- JSON: extracted BPM, stems list, etc.
  error          TEXT,
  started_at     TEXT,
  completed_at   TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_conversions_file    ON conversions(file_id);
CREATE INDEX idx_conversions_project ON conversions(project_id);
CREATE INDEX idx_conversions_status  ON conversions(status);

-- ─────────────────────────────────────────
-- ACTIVITY LOGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  action     TEXT NOT NULL,   -- file_upload | file_delete | project_create | member_add …
  entity_type TEXT,           -- file | project | session | member
  entity_id  TEXT,
  metadata   TEXT,            -- JSON extra info
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_project ON activity_logs(project_id);
CREATE INDEX idx_activity_user    ON activity_logs(user_id);
CREATE INDEX idx_activity_created ON activity_logs(created_at);

-- ─────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, read);

-- ─────────────────────────────────────────
-- TIMELINE GROUPS (for multi-track locking)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timeline_groups (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT '#a855f7',
  is_locked  INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_timeline_groups_project ON timeline_groups(project_id);
