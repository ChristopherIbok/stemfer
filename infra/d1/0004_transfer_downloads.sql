-- Migration: 0004_transfer_downloads
-- Tracks individual download events per transfer

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS transfer_downloads (
  id            TEXT PRIMARY KEY,
  transfer_id   TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  downloaded_at TEXT DEFAULT (datetime('now')),
  ip            TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_transfer_downloads_tid ON transfer_downloads(transfer_id);
