-- The brand now belongs to each presentation. users.brand keeps the last one used, to prefill new presentations.
ALTER TABLE polls ADD COLUMN brand TEXT;
UPDATE polls SET brand = (SELECT brand FROM users WHERE users.id = polls.user_id) WHERE branded = 1;
