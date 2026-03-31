-- Optional: faster latest price lookup (run in Supabase SQL editor)
CREATE OR REPLACE FUNCTION public.fn_sku_latest_prices()
RETURNS TABLE (sku_id TEXT, price INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (p.sku_id) p.sku_id, p.price
  FROM price_history p
  ORDER BY p.sku_id, p.collected_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sku_latest_prices() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_sku_latest_prices() TO authenticated;
