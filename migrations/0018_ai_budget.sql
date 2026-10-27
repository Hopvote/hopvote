-- Workers AI neurons spent per day (UTC), so AI pauses once the daily budget set in worker/ai-budget.ts is spent.
CREATE TABLE ai_budget (
  day TEXT PRIMARY KEY,
  neurons INTEGER NOT NULL DEFAULT 0
);
