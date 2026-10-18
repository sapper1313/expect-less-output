-- A channel can be on hold (not producing or scheduling while a decision is made) apart from paused.
ALTER TABLE channel_rules ADD COLUMN on_hold INTEGER NOT NULL DEFAULT 0;
-- The Complaint Department is on hold until it is relaunched.
UPDATE channel_rules SET on_hold = 1 WHERE brand_id IN (SELECT id FROM brands WHERE slug = 'complaint-department');
