const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch (e) {
        return json(res, 400, { ok: false, error: 'Invalid JSON body' });
      }
    }
    body = body || {};

    const id = body.id;
    if (id === undefined || id === null || id === '') {
      return json(res, 400, { ok: false, error: 'id is required' });
    }

    const updateObj = {};
    if (Object.prototype.hasOwnProperty.call(body, 'memo')) {
      updateObj.memo = body.memo;
    }
    if (body.resolved !== undefined) {
      updateObj.resolved = body.resolved;
      updateObj.resolved_at = body.resolved ? new Date().toISOString() : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'adjusted_price')) {
      var adjVal = body.adjusted_price;
      var adjSave = (adjVal === null || adjVal === '' || adjVal === 0) ? null : adjVal;
      updateObj.adjusted_price = adjSave;

      var skuForAdj = body.sku_id;
      if (!skuForAdj) {
        var alertLookup = await client
          .from('price_alert')
          .select('sku_id')
          .eq('id', id)
          .maybeSingle();
        if (!alertLookup.error && alertLookup.data && alertLookup.data.sku_id) {
          skuForAdj = alertLookup.data.sku_id;
        }
      }
      if (skuForAdj) {
        var skuUp = await client
          .from('sku_list')
          .update({ adjusted_price: adjSave })
          .eq('sku_id', skuForAdj);
        if (skuUp.error) return json(res, 500, { ok: false, error: skuUp.error.message });
      }
    }

    const { error } = await client.from('price_alert').update(updateObj).eq('id', id);
    if (error) return json(res, 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, id: id });
  }

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
    .select(
      'id, sku_id, prev_price, new_price, change_pct, detected_at, memo, resolved, resolved_at, registered_price, adjusted_price, prev_collected_at, new_collected_at'
    )
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
      .select('sku_id, sku_name, brand, registered_price')
      .in('sku_id', ids);
    if (sErr) return json(res, 500, { ok: false, error: sErr.message });
    for (const s of skus || []) skuMap[s.sku_id] = s;
  }

  const alerts = alertsRaw.map((r) => {
    const meta = skuMap[r.sku_id] || {};
    return {
      id: r.id,
      sku_id: r.sku_id,
      sku_name: meta.sku_name || '',
      brand: meta.brand || '',
      registered_price: r.registered_price ?? meta.registered_price ?? null,
      prev_price: r.prev_price,
      prev_collected_at: r.prev_collected_at ?? null,
      new_price: r.new_price,
      new_collected_at: r.new_collected_at ?? null,
      change_pct: r.change_pct != null ? Number(r.change_pct) : null,
      adjusted_price: r.adjusted_price ?? null,
      detected_at: r.detected_at,
      memo: r.memo ?? null,
      resolved: r.resolved ?? null,
      resolved_at: r.resolved_at ?? null,
    };
  });

  return json(res, 200, { ok: true, alerts });
};
