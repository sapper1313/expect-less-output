-- A bot may ask for an exact time in a drop's sidecar (scheduled_at). It is kept here until the drop is scheduled.
ALTER TABLE drops ADD COLUMN requested_at TEXT;
