-- Presentations hold several questions. `question` keeps the title for older rows.
ALTER TABLE polls ADD COLUMN questions TEXT;
