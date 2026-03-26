-- Momentrix V2 PostgreSQL Schema
-- Migrated from 27 Google Sheets → PostgreSQL tables

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE order_status AS ENUM ('normal', 'cancelled', 'refunded', 'rolled_back');
CREATE TYPE event_type AS ENUM ('cancel_order', 'refund_partial', 'rollback_import', 'upload_cancel');
CREATE TYPE user_role AS ENUM ('admin', 'operator');
CREATE TYPE user_status AS ENUM ('pending', 'active', 'inactive');
CREATE TYPE po_status AS ENUM ('draft', 'ordered', 'received', 'cancelled');
CREATE TYPE upload_status AS ENUM ('success', 'error', 'cancelled');

-- ============================================================
-- UTILITY: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- CONFIG
-- ============================================================

CREATE TABLE config (
  market_id    TEXT PRIMARY KEY,
  fee_rate     NUMERIC(5,4) NOT NULL DEFAULT 0,
  amount_type  TEXT NOT NULL DEFAULT 'unit_price',
  extra        JSONB DEFAULT '{}'
);

INSERT INTO config (market_id, fee_rate, amount_type) VALUES
  ('dailyshot', 0.08, 'unit_price'),
  ('kihya', 0, 'purchase_price');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'operator',
  status        user_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- ============================================================
-- AUTH OTP (replaces CacheService)
-- ============================================================

CREATE TABLE auth_otp (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  otp_code   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_otp_user ON auth_otp (user_id, expires_at DESC);

-- ============================================================
-- IMPORT_LOG
-- ============================================================

CREATE TABLE import_log (
  import_id     TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  sales_date    DATE NOT NULL,
  upload_status upload_status NOT NULL DEFAULT 'success',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT
);

CREATE INDEX idx_import_log_market ON import_log (market_id);
CREATE INDEX idx_import_log_date ON import_log (sales_date DESC);

-- ============================================================
-- ORDER_ITEMS
-- ============================================================

CREATE TABLE order_items (
  id                  BIGSERIAL PRIMARY KEY,
  import_id           TEXT NOT NULL REFERENCES import_log(import_id),
  market_id           TEXT NOT NULL,
  sales_date          DATE NOT NULL,
  order_id            TEXT NOT NULL,
  market_product_key  TEXT,
  product_name_raw    TEXT,
  option_name_raw     TEXT,
  qty                 INTEGER NOT NULL DEFAULT 0,
  sales_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  settlement_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  master_sku          TEXT,
  internal_sku        TEXT,
  order_status        order_status NOT NULL DEFAULT 'normal',
  refund_amount       NUMERIC(12,2) DEFAULT 0,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  refund_reason       TEXT,
  sub_order_id        TEXT,
  tracking_no         TEXT,
  recipient_name      TEXT,
  ship_date           DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

CREATE INDEX idx_oi_market ON order_items (market_id);
CREATE INDEX idx_oi_sales_date ON order_items (sales_date DESC);
CREATE INDEX idx_oi_order_id ON order_items (order_id);
CREATE INDEX idx_oi_master_sku ON order_items (master_sku);
CREATE INDEX idx_oi_status ON order_items (order_status);
CREATE INDEX idx_oi_import ON order_items (import_id);
CREATE INDEX idx_oi_sub_order ON order_items (sub_order_id) WHERE sub_order_id IS NOT NULL;
CREATE INDEX idx_oi_ship_date ON order_items (ship_date) WHERE ship_date IS NOT NULL;

CREATE TRIGGER trg_order_items_updated
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ORDER_ITEMS_ARCHIVE (same schema)
-- ============================================================

CREATE TABLE order_items_archive (LIKE order_items INCLUDING ALL);

CREATE TRIGGER trg_order_items_archive_updated
  BEFORE UPDATE ON order_items_archive
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ORDER_EVENTS
-- ============================================================

CREATE TABLE order_events (
  event_id          TEXT PRIMARY KEY,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type        event_type NOT NULL,
  market_id         TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  market_product_key TEXT,
  amount            NUMERIC(12,2) DEFAULT 0,
  reason            TEXT,
  ref_import_id     TEXT,
  operator          TEXT
);

CREATE INDEX idx_oe_type ON order_events (event_type);
CREATE INDEX idx_oe_date ON order_events (occurred_at DESC);

-- ============================================================
-- SUMMARIES
-- ============================================================

CREATE TABLE daily_summary (
  sales_date              DATE PRIMARY KEY,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  settlement_amount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE market_summary (
  market_id               TEXT PRIMARY KEY,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  settlement_amount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sku_summary (
  master_sku              TEXT PRIMARY KEY,
  product_name_raw        TEXT,
  order_count             INTEGER NOT NULL DEFAULT 0,
  qty_total               INTEGER NOT NULL DEFAULT 0,
  sales_amount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  settlement_amount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SKU_MAP & SKU_MASTER
-- ============================================================

CREATE TABLE sku_map (
  dailyshot_product_key TEXT PRIMARY KEY,
  product_name_raw      TEXT,
  master_sku            TEXT
);

CREATE TABLE sku_master (
  master_sku        TEXT PRIMARY KEY,
  internal_sku      TEXT,
  product_name      TEXT NOT NULL,
  market_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_keyword_ja TEXT
);

-- ============================================================
-- COST_MASTER
-- ============================================================

CREATE TABLE cost_master (
  master_sku      TEXT PRIMARY KEY,
  product_name    TEXT,
  purchase_cost   NUMERIC(12,2) DEFAULT 0,
  shipping_cost   NUMERIC(12,2) DEFAULT 0,
  packaging_cost  NUMERIC(12,2) DEFAULT 0,
  tariff_cost     NUMERIC(12,2) DEFAULT 0,
  other_cost      NUMERIC(12,2) DEFAULT 0,
  total_cost      NUMERIC(12,2) DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_cost_master_updated
  BEFORE UPDATE ON cost_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUDIT_LOG
-- ============================================================

CREATE TABLE audit_log (
  log_id       TEXT PRIMARY KEY,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id      TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  target_sheet TEXT,
  target_id    TEXT,
  before_data  JSONB,
  after_data   JSONB,
  session_id   TEXT,
  result       TEXT,
  detail       TEXT
);

CREATE INDEX idx_audit_ts ON audit_log (timestamp DESC);
CREATE INDEX idx_audit_user ON audit_log (user_id);

-- ============================================================
-- AI_USAGE
-- ============================================================

CREATE TABLE ai_usage (
  user_id       TEXT NOT NULL,
  month         TEXT NOT NULL,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(8,4) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);

-- ============================================================
-- INVENTORY
-- ============================================================

CREATE TABLE inventory (
  master_sku      TEXT PRIMARY KEY,
  product_name    TEXT,
  stock           INTEGER NOT NULL DEFAULT 0,
  allocated       INTEGER NOT NULL DEFAULT 0,
  available       INTEGER NOT NULL DEFAULT 0,
  safety_stock    INTEGER NOT NULL DEFAULT 0,
  search_keyword  TEXT,
  last_sync       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_inventory_updated
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SUPPLIERS & SUPPLIER_PRODUCTS
-- ============================================================

CREATE TABLE suppliers (
  supplier_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT,
  url                TEXT,
  category           TEXT,
  contact            TEXT,
  shipping_threshold NUMERIC(12,2),
  shipping_cost      NUMERIC(12,2),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_products (
  id               BIGSERIAL PRIMARY KEY,
  supplier_id      TEXT NOT NULL REFERENCES suppliers(supplier_id),
  master_sku       TEXT,
  product_name     TEXT,
  product_name_kr  TEXT,
  category         TEXT,
  category_kr      TEXT,
  purchase_price   NUMERIC(12,2),
  currency         TEXT DEFAULT 'JPY',
  min_order_qty    INTEGER,
  max_order_qty    INTEGER,
  unit             TEXT,
  price_date       DATE,
  product_url      TEXT,
  notes            TEXT
);

CREATE INDEX idx_sp_supplier ON supplier_products (supplier_id);
CREATE INDEX idx_sp_sku ON supplier_products (master_sku) WHERE master_sku IS NOT NULL;

-- ============================================================
-- PURCHASE_ORDERS & PO_ITEMS
-- ============================================================

CREATE TABLE purchase_orders (
  po_id            TEXT PRIMARY KEY,
  status           po_status NOT NULL DEFAULT 'draft',
  supplier_id      TEXT REFERENCES suppliers(supplier_id),
  supplier_name    TEXT,
  requested_by     TEXT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ordered_at       TIMESTAMPTZ,
  order_memo       TEXT,
  expected_arrival DATE,
  received_at      TIMESTAMPTZ,
  received_by      TEXT,
  receive_memo     TEXT,
  total_amount     NUMERIC(14,2) DEFAULT 0
);

CREATE INDEX idx_po_status ON purchase_orders (status);

CREATE TABLE po_items (
  id           BIGSERIAL PRIMARY KEY,
  po_id        TEXT NOT NULL REFERENCES purchase_orders(po_id),
  master_sku   TEXT,
  product_name TEXT,
  qty          INTEGER NOT NULL DEFAULT 0,
  unit_price   NUMERIC(12,2) DEFAULT 0,
  subtotal     NUMERIC(14,2) DEFAULT 0
);

CREATE INDEX idx_poi_po ON po_items (po_id);

-- ============================================================
-- PRICE_HISTORY
-- ============================================================

CREATE TABLE price_history (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   TEXT,
  master_sku    TEXT,
  product_name  TEXT,
  original_name TEXT,
  qty           INTEGER,
  unit_price    NUMERIC(12,2),
  total_price   NUMERIC(14,2),
  currency      TEXT DEFAULT 'JPY',
  purchase_date DATE,
  source        TEXT,
  source_ref    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ph_sku ON price_history (master_sku) WHERE master_sku IS NOT NULL;
CREATE INDEX idx_ph_supplier ON price_history (supplier_id) WHERE supplier_id IS NOT NULL;

-- ============================================================
-- MARKETING TABLES
-- ============================================================

CREATE TABLE mkt_trends (
  run_id          TEXT NOT NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

CREATE TABLE mkt_matches (
  run_id      TEXT NOT NULL,
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type        TEXT,
  trend       TEXT,
  product     TEXT,
  match_score NUMERIC(5,2),
  dm_angle    TEXT,
  category    TEXT,
  reason      TEXT,
  urgency     TEXT,
  created_by  TEXT,
  PRIMARY KEY (run_id, trend, product)
);

CREATE TABLE mkt_dm_drafts (
  run_id       TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

CREATE TABLE mkt_price_check (
  run_id                     TEXT NOT NULL,
  analyzed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name                       TEXT,
  category                   TEXT,
  korean_retail_min          NUMERIC(12,2),
  korean_retail_avg          NUMERIC(12,2),
  competitor_count           INTEGER,
  competitiveness            TEXT,
  recommended_purchase_price NUMERIC(12,2),
  import_note                TEXT,
  verdict                    TEXT,
  summary                    TEXT,
  created_by                 TEXT,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE mkt_products (
  product_name TEXT PRIMARY KEY,
  source       TEXT,
  category     TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT
);

-- ============================================================
-- DRUNKEN MONKEY
-- ============================================================

CREATE TABLE dmonkey_catalog (
  goods_id      TEXT PRIMARY KEY,
  product_name  TEXT NOT NULL,
  selling_price NUMERIC(12,2),
  brand         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dmonkey_product_map (
  order_product_name   TEXT PRIMARY KEY,
  catalog_product_name TEXT,
  selling_price        NUMERIC(12,2),
  goods_id             TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (basic setup — detailed policies in Phase 1)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
