-- Additive metadata only. Existing question IDs, histories and comments remain.
CREATE TABLE private_discord_sync (
 target TEXT NOT NULL CHECK(target IN ('nima','pierre')), thread_id TEXT NOT NULL,
 question_id TEXT NOT NULL REFERENCES questions(id), fingerprint TEXT NOT NULL,
 last_message_id TEXT, source_updated_at TEXT, synced_at TEXT NOT NULL,
 PRIMARY KEY(target,thread_id)
);
CREATE TABLE private_discord_bot_status (
 target TEXT PRIMARY KEY CHECK(target IN ('nima','pierre')),
 checked_at TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL, last_error TEXT
);
CREATE INDEX questions_legacy_lookup_v242 ON questions(legacy_key);
