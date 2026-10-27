-- Branding: logo, accent color and background, as JSON. Each presentation can opt out.
ALTER TABLE users ADD COLUMN brand TEXT;
ALTER TABLE polls ADD COLUMN branded INTEGER NOT NULL DEFAULT 1;

-- Presentations shared by their owners in the community templates. Questions are a copy, never answers.
CREATE TABLE shared_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  questions TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX shared_templates_rank ON shared_templates(reports, uses DESC);

CREATE TABLE template_reports (
  template_id TEXT NOT NULL REFERENCES shared_templates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (template_id, user_id)
);
