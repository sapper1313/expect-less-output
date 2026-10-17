-- One token per bot, so the app knows which bot is calling. Tokens are stored as SHA-256 hashes, never in the clear.
CREATE TABLE agent_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  channels_json TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'writer' CHECK (role IN ('writer','orchestrator')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_agent_bots_name ON agent_bots(name);
