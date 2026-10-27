-- Indexes for the daily clean-up, so it never scans whole tables.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS pending_signups_expires ON pending_signups(expires_at);
CREATE INDEX IF NOT EXISTS reset_tokens_expires ON reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);
