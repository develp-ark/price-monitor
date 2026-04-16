-- Supabase SQL Editor에서 실행 (이미 있으면 스킵)

ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS registered_price INT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS flag TEXT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS collect_cycle INT DEFAULT 7;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS current_price INT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS last_collected DATE;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS change_pct NUMERIC;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS pid TEXT;

CREATE TABLE IF NOT EXISTS collect_status (
  id INT PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  total INT DEFAULT 0,
  current INT DEFAULT 0,
  success INT DEFAULT 0,
  fail INT DEFAULT 0,
  current_sku_name TEXT,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

INSERT INTO collect_status (id, status, updated_at)
VALUES (1, 'idle', NOW())
ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS collect_schedule (
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  sku_id TEXT NOT NULL REFERENCES sku_list (sku_id) ON DELETE CASCADE,
  PRIMARY KEY (day_of_week, sku_id)
);

CREATE TABLE IF NOT EXISTS price_logs (
  id BIGSERIAL PRIMARY KEY,
  sku_id TEXT NOT NULL,
  price INT,
  original_price INT,
  discount_rate INT,
  collected_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_logs_sku ON price_logs (sku_id, created_at DESC);

CREATE TABLE IF NOT EXISTS price_alerts (
  id BIGSERIAL PRIMARY KEY,
  sku_id TEXT NOT NULL,
  sku_name TEXT,
  brand TEXT,
  prev_price INT,
  new_price INT,
  change_pct NUMERIC,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_detected ON price_alerts (detected_at DESC);
