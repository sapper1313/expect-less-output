-- The iMessage alert number used to be a built-in default (the first owner's phone). A new install must start empty.
-- An install that is already in use keeps sending alerts to the number it has been using, so it is saved explicitly.
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'alertIMessageEnabled', 'true'
WHERE EXISTS (SELECT 1 FROM activity_log WHERE message LIKE '%iMessage%')
   OR EXISTS (SELECT 1 FROM posts);
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'alertIMessageNumber', '"+18046340444"'
WHERE EXISTS (SELECT 1 FROM activity_log WHERE message LIKE '%iMessage%')
   OR EXISTS (SELECT 1 FROM posts);
