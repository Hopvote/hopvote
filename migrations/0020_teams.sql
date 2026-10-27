-- Teams: an account invites other people. Each keeps their own account; the team shares its presentations.
-- One row per invitation, `user_id` set once it is accepted.
CREATE TABLE team_members (
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT,
  token_hash TEXT,
  invited_at INTEGER NOT NULL,
  joined_at INTEGER,
  PRIMARY KEY (owner_id, email)
);
-- A person belongs to one team at most.
CREATE UNIQUE INDEX team_members_user ON team_members (user_id);
CREATE INDEX team_members_token ON team_members (token_hash);
