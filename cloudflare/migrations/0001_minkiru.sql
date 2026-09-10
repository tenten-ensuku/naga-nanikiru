-- Cloudflare migration V232. Derived from the live schema on 2026-09-10.
-- Identity UUIDs and application IDs are preserved. No Supabase system tables.
PRAGMA foreign_keys=ON;

CREATE TABLE private_media_budget (
  "singleton" INTEGER NOT NULL DEFAULT 1 CHECK ("singleton" IN (0,1)),
  "used_bytes" INTEGER NOT NULL DEFAULT 0,
  "warning_bytes" INTEGER NOT NULL DEFAULT '7000000000',
  "limit_bytes" INTEGER NOT NULL DEFAULT '8000000000',
  "external_bytes" INTEGER NOT NULL DEFAULT 0,
  "inventory_checked_at" TEXT,
  "inventory_error" TEXT,
  CHECK ((external_bytes >= 0)),
  PRIMARY KEY (singleton),
  CHECK (singleton),
  CHECK ((used_bytes >= 0))
);

CREATE TABLE private_ops_capacity_control (
  "singleton" INTEGER NOT NULL DEFAULT 1 CHECK ("singleton" IN (0,1)),
  "armed" INTEGER NOT NULL DEFAULT 0 CHECK ("armed" IN (0,1)),
  "blocked" INTEGER NOT NULL DEFAULT 0 CHECK ("blocked" IN (0,1)),
  "reason" TEXT NOT NULL DEFAULT '',
  "checked_at" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (singleton),
  CHECK (singleton)
);

CREATE TABLE answer_attempts (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "client_attempt_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "question_id" TEXT NOT NULL,
  "answer" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("answer")),
  "grade" TEXT NOT NULL,
  "elapsed_ms" INTEGER,
  "answered_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (((elapsed_ms IS NULL) OR ((elapsed_ms >= 0) AND (elapsed_ms <= 86400000)))),
  CHECK ((grade IN ('💮', '◎', '〇', '△', '×'))),
  PRIMARY KEY (id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE (user_id, client_attempt_id),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE class_members (
  "class_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "joined_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, user_id),
  CHECK ((role IN ('teacher', 'student'))),
  CHECK ((status IN ('invited', 'active', 'suspended'))),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE classes (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "workspace_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT,
  CHECK (((length(name) >= 1) AND (length(name) <= 100))),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE collection_access_notifications (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "recipient_id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "request_id" TEXT,
  "actor_id" TEXT,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("payload")),
  "read_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CHECK ((kind IN ('access_requested', 'access_approved', 'access_rejected', 'access_revoked'))),
  PRIMARY KEY (id),
  FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES collection_access_requests(id) ON DELETE CASCADE
);

CREATE TABLE collection_access_requests (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "collection_id" TEXT NOT NULL,
  "requester_id" TEXT NOT NULL,
  "requested_role" TEXT NOT NULL DEFAULT 'viewer',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "message" TEXT NOT NULL DEFAULT '',
  "reviewed_by" TEXT,
  "reviewed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CHECK ((length(message) <= 1000)),
  PRIMARY KEY (id),
  CHECK ((requested_role IN ('viewer', 'editor'))),
  FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK ((status IN ('pending', 'approved', 'rejected', 'cancelled')))
);

CREATE TABLE collection_members (
  "collection_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "status" TEXT NOT NULL DEFAULT 'active',
  "granted_by" TEXT,
  "granted_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "revoked_at" TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (collection_id, user_id),
  CHECK ((role IN ('viewer', 'editor'))),
  CHECK ((status IN ('active', 'revoked'))),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE collections (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "owner_id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "share_slug" TEXT NOT NULL DEFAULT (lower(hex(randomblob(12)))),
  "allow_comments" INTEGER NOT NULL DEFAULT 1 CHECK ("allow_comments" IN (0,1)),
  "allow_contributions" INTEGER NOT NULL DEFAULT 1 CHECK ("allow_contributions" IN (0,1)),
  "published_at" TEXT,
  "archived_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "series_key" TEXT,
  "series_parent_id" TEXT,
  "volume_number" INTEGER,
  "volume_start" INTEGER,
  "volume_end" INTEGER,
  CHECK ((length(description) <= 3000)),
  FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  PRIMARY KEY (id),
  FOREIGN KEY (series_parent_id) REFERENCES collections(id) ON DELETE CASCADE,
  UNIQUE (share_slug),
  CHECK (((length(title) >= 1) AND (length(title) <= 120))),
  CHECK ((visibility IN ('private', 'request', 'limited', 'public', 'unlisted', 'workspace'))),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE TABLE comment_reactions (
  "question_id" TEXT NOT NULL,
  "comment_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reaction_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (((length(comment_id) >= 1) AND (length(comment_id) <= 200))),
  PRIMARY KEY (question_id, comment_id, user_id, reaction_key),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE comments (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "collection_id" TEXT NOT NULL,
  "question_id" TEXT,
  "user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "deleted_at" TEXT,
  "attachments" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("attachments")),
  CHECK (((json_type(attachments) = 'array') AND (json_array_length(attachments) <= 4))),
  CHECK (((length(body) <= 4000) AND ((length(trim(body)) >= 1) OR (json_array_length(attachments) >= 1)))),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE custom_reactions (
  "reaction_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "creator_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "image_path" TEXT,
  "icon_type" TEXT NOT NULL DEFAULT 'emoji',
  CHECK (((length(trim(icon)) > 0) OR (image_path IS NOT NULL))),
  FOREIGN KEY (creator_user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CHECK (((length(trim(icon)) >= 0) AND (length(trim(icon)) <= 8))),
  CHECK ((((image_path IS NULL) AND (icon_type = 'emoji')) OR ((image_path IS NOT NULL) AND (icon_type = 'image')))),
  CHECK (image_path IS NULL OR (substr(image_path,1,length(creator_user_id)+11)=creator_user_id||'/reactions/' AND length(image_path)<=248 AND instr(image_path,'..')=0 AND instr(image_path,'%')=0 AND instr(image_path,'?')=0 AND instr(image_path,'#')=0 AND instr(image_path,char(92))=0)),
  CHECK (((length(trim(label)) >= 1) AND (length(trim(label)) <= 24))),
  PRIMARY KEY (reaction_key),
  CHECK (length(reaction_key)=39 AND substr(reaction_key,1,7)='custom_' AND substr(reaction_key,8) NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE generation_candidates (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "job_id" TEXT NOT NULL,
  "scene_tw" INTEGER NOT NULL,
  "scene_ts" INTEGER NOT NULL,
  "scene_tv" INTEGER NOT NULL,
  "decision_type" TEXT NOT NULL,
  "actual_choice" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("actual_choice")),
  "model_scores" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("model_scores")),
  "candidate_payload" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("candidate_payload")),
  "selected" INTEGER NOT NULL DEFAULT 0 CHECK ("selected" IN (0,1)),
  "created_question_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (created_question_id) REFERENCES questions(id) ON DELETE SET NULL,
  CHECK ((decision_type IN ('discard', 'call', 'riichi', 'combined'))),
  FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, scene_ts, scene_tv, decision_type),
  PRIMARY KEY (id),
  CHECK ((scene_ts >= 0)),
  CHECK ((scene_tv >= 0)),
  CHECK (((scene_tw >= 0) AND (scene_tw <= 3)))
);

CREATE TABLE generation_jobs (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "requested_by" TEXT NOT NULL,
  "collection_id" TEXT,
  "source_kind" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_report_id" TEXT NOT NULL,
  "target_player_seat" INTEGER,
  "target_player_name" TEXT,
  "extraction_preset" TEXT NOT NULL DEFAULT 'bad_moves',
  "extraction_config" TEXT NOT NULL DEFAULT '{"modelRule": "any", "decisionTypes": ["discard", "call", "riichi"], "maxCandidates": 100, "thresholdPercent": 5}' CHECK (json_valid("extraction_config")),
  "status" TEXT NOT NULL DEFAULT 'queued',
  "error_message" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "started_at" TEXT,
  "completed_at" TEXT,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  CHECK ((extraction_preset IN ('bad_moves', 'custom'))),
  PRIMARY KEY (id),
  FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE,
  CHECK ((source_kind IN ('naga_scene', 'naga_match'))),
  CHECK ((status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))),
  CHECK (((target_player_seat >= 0) AND (target_player_seat <= 3)))
);

CREATE TABLE media_assets (
  "object_key" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "owner_id" TEXT,
  "collection_id" TEXT,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "provider" TEXT NOT NULL DEFAULT 'r2',
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((bucket IN ('naga-question-assets', 'comment-assets', 'reaction-assets', 'question-assets'))),
  UNIQUE (bucket, path),
  CHECK ((object_key = ((bucket || '/') || path))),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  CHECK ((content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))),
  FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK (length(path) BETWEEN 1 AND 1024 AND instr('/'||path||'/','/../')=0 AND instr('/'||path||'/','/./')=0 AND instr(path,char(92))=0 AND instr(path,'%')=0 AND instr(path,'?')=0 AND instr(path,'#')=0),
  PRIMARY KEY (object_key),
  CHECK ((provider = 'r2')),
  CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (((size_bytes >= 1) AND (size_bytes <= 10485760))),
  CHECK ((state IN ('pending', 'ready', 'deleting', 'deleted')))
);

CREATE TABLE profiles (
  "id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL DEFAULT 'プレイヤー',
  "discord_user_id" TEXT,
  "avatar_url" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (discord_user_id),
  CHECK (((length(display_name) >= 1) AND (length(display_name) <= 80))),
  PRIMARY KEY (id)
);

CREATE TABLE question_audit_events (
  "id" INTEGER NOT NULL,
  "question_id" TEXT,
  "collection_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "event_type" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  snapshot TEXT CHECK (snapshot IS NULL OR json_valid(snapshot)),
  archive_key TEXT,
  snapshot_sha256 TEXT,
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CHECK ((event_type IN ('created', 'updated', 'trashed', 'restored', 'deletion_requested', 'deletion_request_resolved', 'permanently_deleted'))),
  PRIMARY KEY (id)
);

CREATE TABLE question_deletion_requests (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "question_id" TEXT NOT NULL,
  "requester_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resolved_by" TEXT,
  "resolved_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE (question_id, requester_id, status),
  CHECK ((length(reason) <= 1000)),
  FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK ((status IN ('pending', 'approved', 'rejected', 'cancelled')))
);

CREATE TABLE question_reactions (
  "question_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reaction_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (question_id, user_id, reaction_key),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE questions (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "collection_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_by_name" TEXT NOT NULL DEFAULT 'プレイヤー',
  "updated_by_name" TEXT,
  "title" TEXT NOT NULL DEFAULT '',
  "legacy_key" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "source_kind" TEXT NOT NULL DEFAULT 'manual',
  "source_report_id" TEXT,
  "source_url" TEXT,
  "scene_tw" INTEGER,
  "scene_ts" INTEGER,
  "scene_tv" INTEGER,
  "decision_type" TEXT NOT NULL DEFAULT 'discard',
  "payload" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("payload")),
  "deleted_at" TEXT,
  "deleted_by" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  UNIQUE (collection_id, legacy_key),
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT,
  CHECK (((length(created_by_name) >= 1) AND (length(created_by_name) <= 80))),
  CHECK ((decision_type IN ('discard', 'call', 'riichi', 'combined'))),
  FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  CHECK ((scene_ts >= 0)),
  CHECK ((scene_tv >= 0)),
  CHECK (((scene_tw >= 0) AND (scene_tw <= 3))),
  CHECK ((source_kind IN ('manual', 'discord', 'naga_scene', 'naga_match'))),
  CHECK ((length(title) <= 160)),
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK (((updated_by_name IS NULL) OR ((length(updated_by_name) >= 1) AND (length(updated_by_name) <= 80))))
);

CREATE TABLE user_question_state (
  "user_id" TEXT NOT NULL,
  "question_id" TEXT NOT NULL,
  "favorite" INTEGER NOT NULL DEFAULT 0 CHECK ("favorite" IN (0,1)),
  "state" TEXT NOT NULL DEFAULT 'active',
  "snoozed_until" TEXT,
  "next_review_at" TEXT,
  "last_grade" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (((last_grade IS NULL) OR (last_grade IN ('💮', '◎', '〇', '△', '×')))),
  PRIMARY KEY (user_id, question_id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CHECK ((state IN ('active', 'snoozed', 'trash', 'hidden_forever'))),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE workspace_members (
  "workspace_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "joined_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, user_id),
  CHECK ((role IN ('owner', 'teacher', 'student'))),
  CHECK ((status IN ('invited', 'active', 'suspended'))),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE workspaces (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (((length(name) >= 1) AND (length(name) <= 100))),
  FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX questions_source_scene_unique ON questions(collection_id, coalesce(source_report_id,''), source_report_id IS NULL, coalesce(scene_tw,-1),coalesce(scene_ts,-1),coalesce(scene_tv,-1));
CREATE INDEX questions_collection_order ON questions(collection_id,deleted_at,sort_order,created_at,id);
CREATE INDEX answer_attempts_user_time ON answer_attempts(user_id,answered_at DESC);
CREATE INDEX answer_attempts_question ON answer_attempts(question_id,answered_at DESC);
CREATE INDEX comments_question_time ON comments(question_id,created_at) WHERE deleted_at IS NULL;
CREATE INDEX comments_collection_time ON comments(collection_id,created_at) WHERE deleted_at IS NULL;
CREATE INDEX members_user ON collection_members(user_id,collection_id) WHERE status='active';
CREATE INDEX workspace_members_user ON workspace_members(user_id,workspace_id) WHERE status='active';
CREATE INDEX media_collection ON media_assets(collection_id,state);
CREATE INDEX media_owner ON media_assets(owner_id,state);
CREATE INDEX audit_question ON question_audit_events(question_id,created_at DESC);
-- Historical snapshots remain immutable in private R2; one catalog row per chunk.
CREATE TABLE audit_archives (
  object_key TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes>0),
  row_count INTEGER NOT NULL CHECK (row_count>0),
  first_id INTEGER NOT NULL,
  last_id INTEGER NOT NULL,
  first_created_at TEXT NOT NULL,
  last_created_at TEXT NOT NULL,
  question_ids TEXT NOT NULL CHECK (json_valid(question_ids) AND json_type(question_ids)='array'),
  CHECK (last_id>=first_id)
);
CREATE INDEX collections_series ON collections(series_parent_id,volume_number);
CREATE INDEX access_notifications_user ON collection_access_notifications(recipient_id,read_at,created_at DESC);
CREATE UNIQUE INDEX access_pending_unique ON collection_access_requests(collection_id,requester_id) WHERE status='pending';
CREATE INDEX generation_jobs_user ON generation_jobs(requested_by,created_at DESC);
CREATE TABLE auth_identities (
  user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL UNIQUE CHECK (length(discord_user_id) BETWEEN 15 AND 22 AND discord_user_id NOT GLOB '*[^0-9]*'),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1))
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_identities(user_id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  redirect_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE migration_batches (
  batch_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
