-- Upcoming episodes: ELO keeps a cached copy of the shared file (for display, history and the reconcile check).
CREATE TABLE upcoming_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL DEFAULT '',
  json TEXT NOT NULL DEFAULT '',
  loaded_at TEXT,
  invalid_since TEXT,
  invalid_reason TEXT,
  invalid_alerted INTEGER NOT NULL DEFAULT 0,
  violations_json TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO upcoming_state (id) VALUES (1);

CREATE TABLE upcoming_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE upcoming_moved_ideas (
  idea_id INTEGER PRIMARY KEY,
  moved_at TEXT NOT NULL
);
