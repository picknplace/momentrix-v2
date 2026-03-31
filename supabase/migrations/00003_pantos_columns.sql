-- Pantos 배송추적용 컬럼 추가
ALTER TABLE order_items ADD COLUMN pantos_ord_id TEXT;
ALTER TABLE order_items ADD COLUMN hawb_no TEXT;
ALTER TABLE order_items ADD COLUMN delivery_status TEXT;
ALTER TABLE order_items ADD COLUMN delivery_status_dt TEXT;

CREATE INDEX IF NOT EXISTS idx_oi_delivery_status ON order_items (delivery_status);
CREATE INDEX IF NOT EXISTS idx_oi_pantos_ord ON order_items (pantos_ord_id);

-- order_items_archive에도 동일 컬럼
ALTER TABLE order_items_archive ADD COLUMN pantos_ord_id TEXT;
ALTER TABLE order_items_archive ADD COLUMN hawb_no TEXT;
ALTER TABLE order_items_archive ADD COLUMN delivery_status TEXT;
ALTER TABLE order_items_archive ADD COLUMN delivery_status_dt TEXT;

-- Pantos config 저장 (CONFIG 테이블 확장 — key-value)
CREATE TABLE IF NOT EXISTS config_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO config_kv (key, value) VALUES
  ('PANTOS_ENV', 'prod'),
  ('PANTOS_ACCESS_KEY', ''),
  ('PANTOS_ACCESS_KEY_SUB1', ''),
  ('KIHYA_SHIP_EMAIL', 'hg.hur@picknplace.co.kr');
