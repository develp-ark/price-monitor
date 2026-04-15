const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');
const { isCollectionDue, todayUtcYmd } = require('../lib/sku-due');

async function fetchLatestPricesMap(client, skuIds) {
  const map = new Map();
  if (!skuIds.length) return map;

  const { data: rpcData, error: rpcErr } = await client.rpc('fn_sku_latest_prices');
  if (!rpcErr && Array.isArray(rpcData)) {
    for (const row of rpcData) {
      if (row.sku_id != null) map.set(row.sku_id, row.price);
    }
    return map;
  }

  const CHUNK = 30;
  for (let i = 0; i < skuIds.length; i += CHUNK) {
    const part = skuIds.slice(i, i + CHUNK);
    const results = await Promise.all(
      part.map((sku_id) =>
        client
          .from('price_history')
          .select('price')
          .eq('sku_id', sku_id)
          .order('collected_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    );
    for (let j = 0; j < part.length; j++) {
      const r = results[j];
      if (!r.error && r.data?.price != null) map.set(part[j], r.data.price);
    }
  }
  return map;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const brand = req.query.brand;
  const due = req.query.due === '1' || req.query.due === 'true';

  let q = client.from('sku_list').select('*').eq('is_active', true);
  if (brand) q = q.eq('brand', brand);

  const { data: rows, error } = await q;
  if (error) return json(res, 500, { ok: false, error: error.message });

  const today = todayUtcYmd();
  let list = rows || [];
  if (due) {
    list = list.filter((r) =>
      isCollectionDue(r.last_collected, r.collect_cycle, today)
    );
  }

  let priceMap;
  try {
    priceMap = await fetchLatestPricesMap(
      client,
      list.map((r) => r.sku_id)
    );
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message || 'price lookup failed' });
  }

  const data = list.map((r) => ({
    sku_id: r.sku_id,
    brand: r.brand,
    sku_name: r.sku_name,
    product_url: r.product_url,
    collect_cycle: r.collect_cycle,
    current_price: priceMap.get(r.sku_id) ?? null,
    last_collected: r.last_collected
      ? String(r.last_collected).slice(0, 10)
      : null,
  }));

  return json(res, 200, { ok: true, count: data.length, data });
};
