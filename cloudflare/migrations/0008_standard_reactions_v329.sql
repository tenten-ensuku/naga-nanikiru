-- One shared catalog. Existing reaction records and their keys remain intact.
CREATE TABLE IF NOT EXISTS standard_reaction_catalog (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
  rows_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rows_json)),
  updated_at TEXT,
  updated_by TEXT
);
INSERT OR IGNORE INTO standard_reaction_catalog(singleton) VALUES(1);
