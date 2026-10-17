-- New installs start with the Claude API and Studio production OFF (writing comes from bots).
-- An install that is already in use keeps working exactly as before until the owner turns them off.
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'claudeApiEnabled', 'true'
WHERE EXISTS (SELECT 1 FROM posts) OR EXISTS (SELECT 1 FROM activity_log);
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'studioProductionEnabled', 'true'
WHERE EXISTS (SELECT 1 FROM posts) OR EXISTS (SELECT 1 FROM activity_log);
