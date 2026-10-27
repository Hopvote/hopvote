-- Sign-ups by email wait here until the link in the confirmation email is opened; the account is created then.
CREATE TABLE pending_signups (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pending_signups_email ON pending_signups(email);

-- Password reset links: one hour, single use.
CREATE TABLE reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX reset_tokens_user ON reset_tokens(user_id);
