-- Migration: 0002_transfers
-- Adds Transfer module tables

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────
-- TRANSFERS  (one record per send action)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id               TEXT PRIMARY KEY,       -- nanoid
  sender_email     TEXT NOT NULL,
  recipient_email  TEXT,
  message          TEXT,

  -- State machine: uploading → processing → ready | failed | deleted
  status           TEXT DEFAULT 'uploading' NOT NULL,
  error            TEXT,

  -- ZIP output
  zip_r2_key       TEXT,
  zip_size_bytes   INTEGER,

  -- Download control
  download_token   TEXT UNIQUE,
  download_count   INTEGER DEFAULT 0,
  max_downloads    INTEGER DEFAULT 50,

  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(sender_email);
CREATE INDEX IF NOT EXISTS idx_transfers_token  ON transfers(download_token);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_expiry ON transfers(expires_at);

-- ─────────────────────────────────────────────────────────────
-- TRANSFER_FILES  (one record per uploaded file)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_files (
  id             TEXT PRIMARY KEY,
  transfer_id    TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL,
  upload_id      TEXT,                     -- multipart upload ID during upload
  original_name  TEXT NOT NULL,
  mime_type      TEXT DEFAULT 'application/octet-stream',
  size_bytes     INTEGER NOT NULL,
  status         TEXT DEFAULT 'uploading', -- uploading | uploaded | error
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transfer_files_tid ON transfer_files(transfer_id);
