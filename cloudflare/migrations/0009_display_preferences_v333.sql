CREATE TABLE display_preferences (
 user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 dora_sheen INTEGER NOT NULL DEFAULT 1 CHECK (dora_sheen IN (0,1))
);
