-- Named brands an owner reuses across presentations.
CREATE TABLE brand_kits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX brand_kits_user ON brand_kits(user_id);
