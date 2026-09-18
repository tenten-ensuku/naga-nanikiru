-- Book managers are separate from viewing/editor membership. Revoking management
-- must not erase an independently granted viewing or editing permission.
CREATE TABLE collection_managers (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT,
  PRIMARY KEY (collection_id,user_id)
);
CREATE INDEX collection_managers_user ON collection_managers(user_id,collection_id) WHERE status='active';
