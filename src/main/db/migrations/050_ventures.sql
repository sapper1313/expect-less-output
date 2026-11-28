-- ELS Ventures: a local cache of each storefront (Etsy first). Every table carries the storefront id so a second
-- storefront shares them. Money is whole cents. Times are UTC. Buyers are kept by username only.
CREATE TABLE venture_listings (
  storefront TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumb_url TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  views INTEGER NOT NULL DEFAULT 0,
  favorites INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft',
  url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  sales INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (storefront, id)
);
CREATE TABLE venture_listing_images (
  storefront TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (storefront, listing_id, position)
);
CREATE TABLE venture_price_history (
  storefront TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  at TEXT NOT NULL,
  cents INTEGER NOT NULL
);
CREATE INDEX venture_price_history_idx ON venture_price_history (storefront, listing_id, at);
CREATE TABLE venture_orders (
  storefront TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  placed_at TEXT NOT NULL,
  buyer_username TEXT NOT NULL DEFAULT '',
  fees_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY (storefront, receipt_id)
);
CREATE INDEX venture_orders_at ON venture_orders (storefront, placed_at);
CREATE TABLE venture_order_items (
  storefront TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  listing_id TEXT NOT NULL,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (storefront, receipt_id, position)
);
CREATE TABLE venture_reviews (
  storefront TEXT NOT NULL,
  id TEXT NOT NULL,
  listing_id TEXT,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  buyer_username TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (storefront, id)
);
CREATE TABLE venture_ledger (
  storefront TEXT NOT NULL,
  id TEXT NOT NULL,
  receipt_id TEXT,
  at TEXT NOT NULL,
  cents INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (storefront, id)
);
-- Buyer messages read from Etsy notification emails. Never the full body, never an email address.
CREATE TABLE venture_messages (
  storefront TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (storefront, dedupe_key)
);
CREATE TABLE venture_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storefront TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  UNIQUE (storefront, dedupe_key)
);
CREATE TABLE venture_state (
  storefront TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (storefront, key)
);
