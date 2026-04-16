-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS collect_queue (
  id SERIAL PRIMARY KEY,
  sku_id TEXT NOT NULL,
  sku_name TEXT,
  brand TEXT,
  product_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','collecting','done','failed')),
  result_price INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  collected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON collect_queue(status);
