-- An orchestrator bot (beth) works on every channel, now and later. The shared token is named elo-beth-grok.
UPDATE agent_bots SET channels_json = '["*"]' WHERE role = 'orchestrator' AND revoked_at IS NULL;
