-- Additive generation/upload guardrails. Never rewrites existing questions.
CREATE TABLE private_generation_usage (
  day TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
  PRIMARY KEY(day,kind,subject)
);
CREATE INDEX generation_owner_time_v241 ON generation_jobs(requested_by,created_at);
CREATE TABLE media_question_links (
  object_key TEXT NOT NULL REFERENCES media_assets(object_key),
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY(object_key,question_id)
);
CREATE TRIGGER question_media_link_v241 AFTER INSERT ON questions
BEGIN
  INSERT OR IGNORE INTO media_question_links(object_key,question_id)
    SELECT m.object_key,NEW.id FROM json_tree(NEW.payload) j
    JOIN media_assets m ON m.object_key=substr(j.value,instr(j.value,'/v1/private/')+12)
    WHERE j.type='text' AND instr(j.value,'/v1/private/')>0 AND m.state='ready';
END;
-- Reserving bytes and the ledger insert are one SQLite transaction, including
-- concurrent uploads. Pending files still consume budget after an interruption.
CREATE TRIGGER media_reserve_v241 BEFORE INSERT ON media_assets
WHEN NEW.state IN ('pending','ready') AND NOT EXISTS(SELECT 1 FROM media_assets WHERE object_key=NEW.object_key)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM private_media_budget WHERE singleton=1
    AND inventory_error IS NULL AND inventory_checked_at IS NOT NULL
    AND julianday(inventory_checked_at)>julianday('now','-2 days')
    AND used_bytes+external_bytes+NEW.size_bytes<=limit_bytes)
    THEN RAISE(ABORT,'media_capacity_unavailable') END;
  UPDATE private_media_budget SET used_bytes=used_bytes+NEW.size_bytes WHERE singleton=1;
END;
-- Deletion remains separately controlled; this release exposes no delete API.
CREATE TRIGGER media_release_v241 AFTER UPDATE OF state ON media_assets
WHEN NEW.state='deleted' AND OLD.state<>'deleted'
BEGIN
  UPDATE private_media_budget SET used_bytes=MAX(0,used_bytes-OLD.size_bytes) WHERE singleton=1;
END;
