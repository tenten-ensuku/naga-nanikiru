-- Additive only. Existing IDs, source numbers, answers and images are untouched.
ALTER TABLE collections ADD COLUMN book_tone TEXT
  CHECK (book_tone IS NULL OR book_tone IN ('walnut','navy','forest','burgundy','ivory','plum','teal','ochre'));
-- Manual questions have no NAGA scene. NULL is not a shared scene identifier.
DROP INDEX questions_source_scene_unique;
CREATE UNIQUE INDEX questions_source_scene_unique ON questions(collection_id,source_report_id,coalesce(scene_tw,-1),coalesce(scene_ts,-1),coalesce(scene_tv,-1)) WHERE source_report_id IS NOT NULL;
CREATE UNIQUE INDEX collections_one_volume ON collections(series_parent_id,volume_number)
  WHERE series_parent_id IS NOT NULL AND volume_number IS NOT NULL;
CREATE TRIGGER questions_capacity_insert_v235 BEFORE INSERT ON questions
WHEN NEW.deleted_at IS NULL AND (SELECT COUNT(*) FROM questions WHERE collection_id=NEW.collection_id AND deleted_at IS NULL)>=200
BEGIN SELECT RAISE(ABORT,'collection_capacity_reached'); END;
CREATE TRIGGER questions_capacity_move_v235 BEFORE UPDATE OF collection_id,deleted_at ON questions
WHEN NEW.deleted_at IS NULL AND (OLD.collection_id<>NEW.collection_id OR OLD.deleted_at IS NOT NULL)
 AND (SELECT COUNT(*) FROM questions WHERE collection_id=NEW.collection_id AND deleted_at IS NULL AND id<>NEW.id)>=200
BEGIN SELECT RAISE(ABORT,'collection_capacity_reached'); END;
