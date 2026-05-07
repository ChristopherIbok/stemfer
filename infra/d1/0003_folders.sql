-- Migration: 0003_folders
-- Adds folder support for organising files within projects

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, parent_id, name)
);

CREATE INDEX idx_folders_project ON folders(project_id);
CREATE INDEX idx_folders_parent  ON folders(parent_id);

-- Add folder_id column to files
ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_files_folder ON files(folder_id);
