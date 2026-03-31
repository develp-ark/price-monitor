const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');
const { todayUtcYmd } = require('../lib/sku-due');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  if (req.method === 'GET') {
    const skuId = req.query.sku_id;
    if (!skuId) {
      return json(res, 400, { ok: false, error: 'sku_id is required' });
    }
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1),
      500
    );

    const { data: rows, error } = await client
      .from('price_history')
      .select('price, original_price, discount_rate, collected_at')
      .eq('sku_id', skuId)
      .order('collected_at', { ascending: false })
      .limit(limit);

    if (error) return json(res, 500, { ok: false, error: error.message });

    const history = (rows || []).map((r) => ({
      price: r.price,
      original_price: r.original_price,
      discount_rate: r.discount_rate,
      collected_at: r.collected_at,
    }));

    return json(res, 200, { ok: true, sku_id: skuId, history });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  }

  const sku_id = body?.sku_id;
  const price = body?.price;
  if (!sku_id || price == null || Number.isNaN(Number(price))) {
    return json(res, 400, {
      ok: false,
      error: 'sku_id and numeric price are required',
    });
  }

  const original_price = body.original_price ?? null;
  const discount_rate = body.discount_rate ?? null;
  const collected_by = body.collected_by ?? 'openclaw';
  const newPrice = Math.round(Number(price));

  const { data: prevRow, error: prevErr } = await client
    .from('price_history')
    .select('price')
    .eq('sku_id', sku_id)
    .order('collected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prevErr) return json(res, 500, { ok: false, error: prevErr.message });

  const prev_price = prevRow?.price ?? null;

  const { error: insErr } = await client.from('price_history').insert({
    sku_id,
    price: newPrice,
    original_price,
    discount_rate,
    collected_by,
  });

  if (insErr) return json(res, 500, { ok: false, error: insErr.message });

  const today = todayUtcYmd();
  const { error: upErr } = await client
    .from('sku_list')
    .update({ last_collected: today })
    .eq('sku_id', sku_id);

  if (upErr) return json(res, 500, { ok: false, error: upErr.message });

  let changed = false;
  if (prev_price != null && prev_price !== newPrice) {
    const change_pct =
      prev_price === 0
        ? 0
        : Number((((newPrice - prev_price) / prev_price) * 100).toFixed(2));

    const { error: alErr } = await client.from('price_alert').insert({
      sku_id,
      prev_price,
      new_price: newPrice,
      change_pct,
    });

    if (alErr) return json(res, 500, { ok: false, error: alErr.message });
    changed = true;
  }

  return json(res, 200, {
    ok: true,
    sku_id,
    price: newPrice,
    prev_price,
    changed,
  });
};
