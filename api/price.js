const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');
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

  const rawSkuId = body?.sku_id;
  const price = body?.price;
  if (!rawSkuId || price == null || Number.isNaN(Number(price))) {
    return json(res, 400, {
      ok: false,
      error: 'sku_id and numeric price are required',
    });
  }

  const incomingId = String(rawSkuId).trim();
  let matched_from = null;
  let sku_id = incomingId;

  const { data: directRow, error: directErr } = await client
    .from('sku_list')
    .select('sku_id')
    .eq('sku_id', incomingId)
    .maybeSingle();

  if (directErr) return json(res, 500, { ok: false, error: directErr.message });

  if (directRow?.sku_id) {
    sku_id = directRow.sku_id;
    matched_from = null;
  } else {
    const likePattern = `%/products/${incomingId}%`;
    const { data: urlRows, error: urlErr } = await client
      .from('sku_list')
      .select('sku_id')
      .like('product_url', likePattern)
      .limit(1);

    if (urlErr) return json(res, 500, { ok: false, error: urlErr.message });

    if (urlRows && urlRows.length > 0 && urlRows[0].sku_id) {
      sku_id = urlRows[0].sku_id;
      matched_from = 'product_url';
    }
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

  await client
    .from('sku_list')
    .update({
      current_price: newPrice,
      last_collected: new Date().toISOString(),
    })
    .eq('sku_id', sku_id);

  // 기존 미처리 알림 중 new_price가 0이거나 null인 것을 현재 가격으로 업데이트
  if (newPrice > 0) {
    await client
      .from('price_alert')
      .update({ new_price: newPrice, change_pct: null })
      .eq('sku_id', sku_id)
      .eq('resolved', false)
      .or('new_price.eq.0,new_price.is.null');

    // 업데이트된 행의 change_pct 재계산
    var { data: updatedAlerts } = await client
      .from('price_alert')
      .select('id, prev_price, new_price')
      .eq('sku_id', sku_id)
      .eq('resolved', false)
      .eq('new_price', newPrice)
      .is('change_pct', null);

    if (updatedAlerts && updatedAlerts.length > 0) {
      for (var ua = 0; ua < updatedAlerts.length; ua++) {
        var alert = updatedAlerts[ua];
        if (alert.prev_price && alert.prev_price > 0) {
          var newChangePct = Number((((alert.new_price - alert.prev_price) / alert.prev_price) * 100).toFixed(2));
          await client.from('price_alert').update({ change_pct: newChangePct }).eq('id', alert.id);
        }
      }
    }
  }

  let changed = false;
  let comparePrice = prev_price;

  if (comparePrice == null) {
    const { data: skuRow, error: skuErr } = await client
      .from('sku_list')
      .select('registered_price')
      .eq('sku_id', sku_id)
      .maybeSingle();
    if (skuErr) return json(res, 500, { ok: false, error: skuErr.message });
    comparePrice =
      skuRow && skuRow.registered_price != null
        ? Math.round(Number(skuRow.registered_price))
        : null;
  }

  if (comparePrice != null && comparePrice !== newPrice) {
    const change_pct =
      comparePrice === 0
        ? 0
        : Number((((newPrice - comparePrice) / comparePrice) * 100).toFixed(2));

    const { error: alErr } = await client.from('price_alert').insert({
      sku_id,
      prev_price: comparePrice,
      new_price: newPrice,
      change_pct,
    });

    if (alErr) return json(res, 500, { ok: false, error: alErr.message });
    changed = true;
  }

  return json(res, 200, {
    ok: true,
    sku_id,
    matched_from,
    price: newPrice,
    prev_price,
    changed,
  });
};
