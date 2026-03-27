-- Momentrix V2 D1 (SQLite) Schema
-- Migrated from 27 Google Sheets → D1 tables

-- ============================================================
-- CONFIG
-- ============================================================

CREATE TABLE IF NOT EXISTS config (
  market_id    TEXT PRIMARY KEY,
  fee_rate     REAL NOT NULL DEFAULT 0,
  amount_type  TEXT NOT NULL DEFAULT 'unit_price',
  extra        TEXT DEFAULT '{}'
);

INSERT OR IGNORE INTO config (market_id, fee_rate, amount_type) VALUES
  ('dailyshot', 0.08, 'unit_price'),
  ('kihya', 0, 'purchase_price');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

-- ============================================================
-- AUTH OTP
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_otp (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  otp_code   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_otp_user ON auth_otp (user_id, expires_at);

-- ============================================================
-- IMPORT_LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS import_log (
  import_id     TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  sales_date    TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'success' CHECK (upload_status IN ('success', 'error', 'cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at  TEXT,
  cancel_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_log_market ON import_log (market_id);
CREATE INDEX IF NOT EXISTS idx_import_log_date ON import_log (sales_date);

-- ============================================================
-- ORDER_ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS order_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id           TEXT NOT NULL REFERENCES import_log(import_id),
  market_id           TEXT NOT NULL,
  sales_date          TEXT NOT NULL,
  order_id            TEXT NOT NULL,
  market_product_key  TEXT,
  product_name_raw    TEXT,
  option_name_raw     TEXT,
  qty                 INTEGER NOT NULL DEFAULT 0,
  sales_amount        REAL NOT NULL DEFAULT 0,
  settlement_amount   REAL NOT NULL DEFAULT 0,
  master_sku          TEXT,
  internal_sku        TEXT,
  order_status        TEXT NOT NULL DEFAULT 'normal' CHECK (order_status IN ('normal', 'cancelled', 'refunded', 'rolled_back')),
  refund_amount       REAL DEFAULT 0,
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  refund_reason       TEXT,
  sub_order_id        TEXT,
  tracking_no         TEXT,
  recipient_name      TEXT,
  ship_date           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  -- Kihya extended fields
  customs_id          TEXT,
  phone               TEXT,
  mobile              TEXT,
  postal_code         TEXT,
  address             TEXT,
  order_note          TEXT,
  remark              TEXT,
  supplier_name       TEXT,
  -- Ecount status
  ec_status           TEXT
);

CREATE INDEX IF NOT EXISTS idx_oi_market ON order_items (market_id);
CREATE INDEX IF NOT EXISTS idx_oi_sales_date ON order_items (sales_date);
CREATE INDEX IF NOT EXISTS idx_oi_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_oi_master_sku ON order_items (master_sku);
CREATE INDEX IF NOT EXISTS idx_oi_status ON order_items (order_status);
CREATE INDEX IF NOT EXISTS idx_oi_import ON order_items (import_id);
CREATE INDEX IF NOT EXISTS idx_oi_sub_order ON order_items (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_oi_ship_date ON order_items (ship_date);

-- ============================================================
-- ORDER_ITEMS_ARCHIVE
-- ============================================================

CREATE TABLE IF NOT EXISTS order_items_archive (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id           TEXT,
  market_id           TEXT,
  sales_date          TEXT,
  order_id            TEXT,
  market_product_key  TEXT,
  product_name_raw    TEXT,
  option_name_raw     TEXT,
  qty                 INTEGER DEFAULT 0,
  sales_amount        REAL DEFAULT 0,
  settlement_amount   REAL DEFAULT 0,
  master_sku          TEXT,
  internal_sku        TEXT,
  order_status        TEXT DEFAULT 'normal',
  refund_amount       REAL DEFAULT 0,
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  refund_reason       TEXT,
  sub_order_id        TEXT,
  tracking_no         TEXT,
  recipient_name      TEXT,
  ship_date           TEXT,
  created_at          TEXT,
  updated_at          TEXT,
  customs_id          TEXT,
  phone               TEXT,
  mobile              TEXT,
  postal_code         TEXT,
  address             TEXT,
  order_note          TEXT,
  remark              TEXT,
  supplier_name       TEXT,
  ec_status           TEXT
);

-- ============================================================
-- ORDER_EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS order_events (
  event_id          TEXT PRIMARY KEY,
  occurred_at       TEXT NOT NULL DEFAULT (datetime('now')),
  event_type        TEXT NOT NULL CHECK (event_type IN ('cancel_order', 'refund_partial', 'rollback_import', 'upload_cancel')),
  market_id         TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  market_product_key TEXT,
  amount            REAL DEFAULT 0,
  reason            TEXT,
  ref_import_id     TEXT,
  operator          TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_type ON order_events (event_type);
CREATE INDEX IF NOT EXISTS idx_oe_date ON order_events (occurred_at);

-- ============================================================
-- SUMMARIES
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_summary (
  sales_date              TEXT PRIMARY KEY,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      REAL NOT NULL DEFAULT 0,
  settlement_amount_total REAL NOT NULL DEFAULT 0,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_summary (
  market_id               TEXT PRIMARY KEY,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      REAL NOT NULL DEFAULT 0,
  settlement_amount_total REAL NOT NULL DEFAULT 0,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sku_summary (
  master_sku              TEXT PRIMARY KEY,
  product_name_raw        TEXT,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      REAL NOT NULL DEFAULT 0,
  settlement_amount_total REAL NOT NULL DEFAULT 0,
  generated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SKU_MAP & SKU_MASTER
-- ============================================================

CREATE TABLE IF NOT EXISTS sku_map (
  dailyshot_product_key TEXT PRIMARY KEY,
  product_name_raw      TEXT,
  master_sku            TEXT
);

CREATE TABLE IF NOT EXISTS sku_master (
  master_sku        TEXT PRIMARY KEY,
  internal_sku      TEXT,
  product_name      TEXT NOT NULL,
  market_id         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  search_keyword_ja TEXT
);

-- ============================================================
-- COST_MASTER
-- ============================================================

CREATE TABLE IF NOT EXISTS cost_master (
  master_sku      TEXT PRIMARY KEY,
  product_name    TEXT,
  purchase_cost   REAL DEFAULT 0,
  shipping_cost   REAL DEFAULT 0,
  packaging_cost  REAL DEFAULT 0,
  tariff_cost     REAL DEFAULT 0,
  other_cost      REAL DEFAULT 0,
  total_cost      REAL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AUDIT_LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  log_id       TEXT PRIMARY KEY,
  timestamp    TEXT NOT NULL DEFAULT (datetime('now')),
  user_id      TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  target_sheet TEXT,
  target_id    TEXT,
  before_data  TEXT,
  after_data   TEXT,
  session_id   TEXT,
  result       TEXT,
  detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id);

-- ============================================================
-- AI_USAGE
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id       TEXT NOT NULL,
  month         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);

-- ============================================================
-- INVENTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory (
  master_sku      TEXT PRIMARY KEY,
  product_name    TEXT,
  stock           INTEGER NOT NULL DEFAULT 0,
  allocated       INTEGER NOT NULL DEFAULT 0,
  available       INTEGER NOT NULL DEFAULT 0,
  safety_stock    INTEGER NOT NULL DEFAULT 0,
  search_keyword  TEXT,
  last_sync       TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SUPPLIERS & SUPPLIER_PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT,
  url                TEXT,
  category           TEXT,
  contact            TEXT,
  shipping_threshold REAL,
  shipping_cost      REAL,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id      TEXT NOT NULL REFERENCES suppliers(supplier_id),
  master_sku       TEXT,
  product_name     TEXT,
  product_name_kr  TEXT,
  category         TEXT,
  category_kr      TEXT,
  purchase_price   REAL,
  currency         TEXT DEFAULT 'JPY',
  min_order_qty    INTEGER,
  max_order_qty    INTEGER,
  unit             TEXT,
  price_date       TEXT,
  product_url      TEXT,
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sp_supplier ON supplier_products (supplier_id);
CREATE INDEX IF NOT EXISTS idx_sp_sku ON supplier_products (master_sku);

-- ============================================================
-- PURCHASE_ORDERS & PO_ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id            TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
  supplier_id      TEXT REFERENCES suppliers(supplier_id),
  supplier_name    TEXT,
  requested_by     TEXT,
  requested_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ordered_at       TEXT,
  order_memo       TEXT,
  expected_arrival TEXT,
  received_at      TEXT,
  received_by      TEXT,
  receive_memo     TEXT,
  total_amount     REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders (status);

CREATE TABLE IF NOT EXISTS po_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id        TEXT NOT NULL REFERENCES purchase_orders(po_id),
  master_sku   TEXT,
  product_name TEXT,
  qty          INTEGER NOT NULL DEFAULT 0,
  unit_price   REAL DEFAULT 0,
  subtotal     REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_poi_po ON po_items (po_id);

-- ============================================================
-- PRICE_HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS price_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   TEXT,
  master_sku    TEXT,
  product_name  TEXT,
  original_name TEXT,
  qty           INTEGER,
  unit_price    REAL,
  total_price   REAL,
  currency      TEXT DEFAULT 'JPY',
  purchase_date TEXT,
  source        TEXT,
  source_ref    TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ph_sku ON price_history (master_sku);
CREATE INDEX IF NOT EXISTS idx_ph_supplier ON price_history (supplier_id);

-- ============================================================
-- MARKETING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS mkt_trends (
  run_id          TEXT NOT NULL,
  scanned_at      TEXT NOT NULL DEFAULT (datetime('now')),
  keyword         TEXT,
  category        TEXT,
  reason          TEXT,
  search_volume   TEXT,
  target_audience TEXT,
  season          TEXT,
  sources         TEXT,
  summary         TEXT,
  created_by      TEXT,
  PRIMARY KEY (run_id, keyword)
);

CREATE TABLE IF NOT EXISTS mkt_matches (
  run_id      TEXT NOT NULL,
  matched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  type        TEXT,
  trend       TEXT,
  product     TEXT,
  match_score REAL,
  dm_angle    TEXT,
  category    TEXT,
  reason      TEXT,
  urgency     TEXT,
  created_by  TEXT,
  PRIMARY KEY (run_id, trend, product)
);

CREATE TABLE IF NOT EXISTS mkt_dm_drafts (
  run_id       TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel      TEXT,
  subject      TEXT,
  preview      TEXT,
  body         TEXT,
  cta          TEXT,
  target_trend TEXT,
  persona      TEXT,
  status       TEXT DEFAULT 'draft',
  created_by   TEXT,
  PRIMARY KEY (run_id, channel, subject)
);

CREATE TABLE IF NOT EXISTS mkt_price_check (
  run_id                     TEXT NOT NULL,
  analyzed_at                TEXT NOT NULL DEFAULT (datetime('now')),
  name                       TEXT,
  category                   TEXT,
  korean_retail_min          REAL,
  korean_retail_avg          REAL,
  competitor_count           INTEGER,
  competitiveness            TEXT,
  recommended_purchase_price REAL,
  import_note                TEXT,
  verdict                    TEXT,
  summary                    TEXT,
  created_by                 TEXT,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS mkt_products (
  product_name TEXT PRIMARY KEY,
  source       TEXT,
  category     TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);

-- ============================================================
-- DRUNKEN MONKEY
-- ============================================================

CREATE TABLE IF NOT EXISTS dmonkey_catalog (
  goods_id      TEXT PRIMARY KEY,
  product_name  TEXT NOT NULL,
  selling_price REAL,
  brand         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dmonkey_product_map (
  order_product_name   TEXT PRIMARY KEY,
  catalog_product_name TEXT,
  selling_price        REAL,
  goods_id             TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- ONLINE CATALOG (from GAS migration)
-- ============================================================

CREATE TABLE IF NOT EXISTS online_catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT NOT NULL,
  sku           TEXT,
  title         TEXT,
  price         REAL,
  compare_price REAL,
  available     TEXT,
  product_type  TEXT,
  vendor        TEXT,
  tags          TEXT,
  image_url     TEXT,
  handle        TEXT,
  product_url   TEXT,
  synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oc_source ON online_catalog (source_id);

CREATE TABLE IF NOT EXISTS catalog_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL,
  change_type TEXT NOT NULL,
  sku         TEXT,
  title       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_source ON catalog_changes (source_id);
