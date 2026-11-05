-- Keep deleted volumes and their content intact; only live volumes reserve a number.
DROP INDEX collections_one_volume;
CREATE UNIQUE INDEX collections_one_volume ON collections(series_parent_id,volume_number)
  WHERE series_parent_id IS NOT NULL AND volume_number IS NOT NULL AND archived_at IS NULL;
CREATE INDEX collections_volume_history_v357 ON collections(series_parent_id,volume_number,archived_at);
