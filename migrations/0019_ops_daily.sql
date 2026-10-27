-- Daily counters: emails sent, and the caps on sign-in attempts, emails and template uses (worker/ops.ts).
CREATE TABLE ops_daily (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
