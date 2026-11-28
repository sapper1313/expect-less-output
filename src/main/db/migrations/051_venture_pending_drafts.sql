-- Draft listings B.E.T.H. (or the owner) sent while no Etsy shop was connected. They wait here and are pushed to Etsy,
-- always as drafts, once the shop is connected.
CREATE TABLE venture_pending_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storefront TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'create' or 'update'
  target_id TEXT NOT NULL,       -- the local id (pending-N) for a create, the Etsy listing id for an update
  payload_json TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);
