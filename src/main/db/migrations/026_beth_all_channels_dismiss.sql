-- The operator bot (beth) works on every channel, now and later. "*" means all channels.
UPDATE agent_bots SET channels_json = '["*"]' WHERE name = 'beth' AND revoked_at IS NULL;
-- An issue the owner dismissed stays hidden until the problem goes away and comes back.
ALTER TABLE reconcile_issues ADD COLUMN dismissed_at TEXT;
