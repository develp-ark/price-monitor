const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const days = Math.min(
    Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1),
    365
  );
  const brand = req.query.brand;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString();

  let skuIdsForBrand = null;
  if (brand) {
    const { data: brandRows, error: bErr } = await client
      .from('sku_list')
      .select('sku_id')
      .eq('brand', brand);
    if (bErr) return json(res, 500, { ok: false, error: bErr.message });
    skuIdsForBrand = (brandRows || []).map((r) => r.sku_id);
    if (skuIdsForBrand.length === 0) {
      return json(res, 200, { ok: true, alerts: [] });
    }
  }

  let q = client
    .from('price_alert')
    .select('sku_id, prev_price, new_price, change_pct, detected_at')
    .gte('detected_at', sinceIso)
    .order('detected_at', { ascending: false });

  if (skuIdsForBrand) q = q.in('sku_id', skuIdsForBrand);

  const { data: rows, error } = await q;
  if (error) return json(res, 500, { ok: false, error: error.message });

  const alertsRaw = rows || [];
  const ids = [...new Set(alertsRaw.map((r) => r.sku_id))];
  let skuMap = {};
  if (ids.length > 0) {
    const { data: skus, error: sErr } = await client
      .from('sku_list')
      .select('sku_id, sku_name, brand')
      .in('sku_id', ids);
    if (sErr) return json(res, 500, { ok: false, error: sErr.message });
    for (const s of skus || []) skuMap[s.sku_id] = s;
  }

  const alerts = alertsRaw.map((r) => {
    const meta = skuMap[r.sku_id];
    return {
      sku_id: r.sku_id,
      sku_name: meta?.sku_name ?? null,
      brand: meta?.brand ?? null,
      prev_price: r.prev_price,
      new_price: r.new_price,
      change_pct: r.change_pct != null ? Number(r.change_pct) : null,
      detected_at: r.detected_at,
    };
  });

  return json(res, 200, { ok: true, alerts });
};
