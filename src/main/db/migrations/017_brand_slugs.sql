-- A short stable name for each channel. Bots use it in sidecars ("channel": "clock-out-early"). The name stays the display name.
ALTER TABLE brands ADD COLUMN slug TEXT;
UPDATE brands SET slug = 'trash-panda' WHERE name LIKE 'Trash Panda%' AND slug IS NULL;
UPDATE brands SET slug = 'clock-out-early' WHERE name LIKE 'Clock Out Early%' AND slug IS NULL;
UPDATE brands SET slug = 'teach-your-parents-tech' WHERE name LIKE 'Teach Your Parents%' AND slug IS NULL;
UPDATE brands SET slug = 'math-of-it' WHERE name LIKE '%Math of It%' AND slug IS NULL;
UPDATE brands SET slug = 'wonder-hollow' WHERE name LIKE 'Wonder Hollow%' AND slug IS NULL;
UPDATE brands SET slug = 'backup-heroes' WHERE name LIKE 'Backup Heroes%' AND slug IS NULL;
UPDATE brands SET slug = 'complaint-department' WHERE name LIKE '%Complaint Department%' AND slug IS NULL;
CREATE UNIQUE INDEX idx_brands_slug ON brands(slug) WHERE slug IS NOT NULL;
