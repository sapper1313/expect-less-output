-- Posted videos are kept 30 days instead of 60. An install that still has the old default moves to the new one.
UPDATE settings SET value_json = json_set(value_json, '$.retentionDays', 30)
WHERE key = 'studio.config' AND json_valid(value_json) AND json_extract(value_json, '$.retentionDays') = 60;
