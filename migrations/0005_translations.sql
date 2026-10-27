-- Machine translations of presentation text, kept so each text is translated once per language.
CREATE TABLE translations (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
