-- The Dashboard screen keeps one row per day (how full the week was, views per channel) for its trend lines,
-- and the last snapshot it showed so the screen is not empty right after the app starts.
CREATE TABLE IF NOT EXISTS dashboard_daily (
  date TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  filled INTEGER NOT NULL,
  total INTEGER NOT NULL,
  channel_views TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
