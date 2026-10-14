CREATE TABLE IF NOT EXISTS collection_study_models (
 collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
 default_model TEXT NOT NULL CHECK(default_model IN ('ニシキ','ヒバカリ','カガシ','アナンタ','ウロボロス','ガンマ','オメガ'))
);
CREATE TABLE IF NOT EXISTS study_model_preferences (
 user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 model TEXT NOT NULL CHECK(model IN ('ニシキ','ヒバカリ','カガシ','アナンタ','ウロボロス','ガンマ','オメガ')),
 PRIMARY KEY(user_id,collection_id)
);
