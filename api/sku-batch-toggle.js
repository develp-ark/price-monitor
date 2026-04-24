const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

function normalizeFlag(flag) {
  if (flag == null) return '';
  return String(flag).trim();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  if (req.method === 'PATCH') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch {
        return json(res, 400, { ok: false, error: 'Invalid JSON body' });
      }
    }
    body = body || {};
    const ids = body.sku_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return json(res, 400, { ok: false, error: 'sku_ids array required' });
    }
    if (typeof body.is_active !== 'boolean') {
      return json(res, 400, { ok: false, error: 'is_active (boolean) required' });
    }
    const skuIds = ids.map((x) => String(x).trim()).filter(Boolean);
    if (!skuIds.length) {
      return json(res, 400, { ok: false, error: 'sku_ids empty' });
    }
    const { client, error: envErr } = getSupabase();
    if (envErr) return json(res, 500, { ok: false, error: envErr });
    const { error } = await client
      .from('sku_list')
      .update({ is_active: body.is_active })
      .in('sku_id', skuIds);
    if (error) return json(res, 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, updated: skuIds.length });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'brand')) {
    return json(res, 400, { ok: false, error: 'brand is required' });
  }
  let brand = body.brand;
  if (typeof brand !== 'string') {
    return json(res, 400, { ok: false, error: 'brand must be a string' });
  }
  const active = body?.active;
  if (typeof active !== 'boolean') {
    return json(res, 400, { ok: false, error: 'active (boolean) is required' });
  }

  const targetFlag = normalizeFlag(body?.flag);

  let q = client.from('sku_list').select('sku_id, flag');
  if (brand === '') {
    q = q.is('brand', null);
  } else {
    q = q.eq('brand', brand);
  }

  const { data: rows, error: qErr } = await q;

  if (qErr) return json(res, 500, { ok: false, error: qErr.message });

  const ids = (rows || [])
    .filter((r) => normalizeFlag(r.flag) === targetFlag)
    .map((r) => r.sku_id);

  if (!ids.length) {
    return json(res, 200, { ok: true, updated: 0 });
  }

  const { error, count } = await client
    .from('sku_list')
    .update({ is_active: active })
    .in('sku_id', ids)
    .select('sku_id', { count: 'exact', head: true });

  if (error) return json(res, 500, { ok: false, error: error.message });

  return json(res, 200, {
    ok: true,
    updated: count ?? 0,
  });
};
