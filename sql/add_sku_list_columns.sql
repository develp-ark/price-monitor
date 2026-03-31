-- Run in Supabase SQL editor (once)
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS registered_price INT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE sku_list ADD COLUMN IF NOT EXISTS flag TEXT;

COMMENT ON COLUMN sku_list.registered_price IS 'CSV 등록가';
COMMENT ON COLUMN sku_list.memo IS 'CSV 메모';
COMMENT ON COLUMN sku_list.flag IS 'CSV 플래그 (TOP, 신규 등)';
