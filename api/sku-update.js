const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return null;
    }
  }
  return body || {};
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'PATCH') {
    return json(res, 405, { ok: false, error: 'PATCH only' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const b = parseBody(req);
  if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });

  const sku_id = b.sku_id != null ? String(b.sku_id).trim() : '';
  if (!sku_id) return json(res, 400, { ok: false, error: 'sku_id 필요' });

  const updates = {};
  if (b.sku_name != null) updates.sku_name = String(b.sku_name).trim();
  if (b.brand != null) updates.brand = String(b.brand).trim();
  if (b.registered_price !== undefined) {
    updates.registered_price =
      b.registered_price != null && b.registered_price !== ''
        ? Number(b.registered_price)
        : null;
  }
  if (b.collect_cycle !== undefined) {
    updates.collect_cycle =
      b.collect_cycle != null && b.collect_cycle !== ''
        ? Number(b.collect_cycle)
        : 7;
  }
  if (b.flag !== undefined) {
    updates.flag =
      b.flag != null && String(b.flag).trim() !== ''
        ? String(b.flag).trim()
        : null;
  }
  if (b.memo !== undefined) {
    updates.memo =
      b.memo != null && String(b.memo).trim() !== ''
        ? String(b.memo).trim()
        : null;
  }
  if (b.product_url !== undefined) {
    const u = String(b.product_url || '').trim();
    updates.product_url = u || null;
  }
  if (b.priority_group !== undefined) {
    if (b.priority_group === null || b.priority_group === '') {
      updates.priority_group = null;
    } else {
      const pg = String(b.priority_group).trim().toUpperCase();
      if (pg === 'A' || pg === 'B') updates.priority_group = pg;
    }
  }
  if (b.product_status !== undefined) {
    if (b.product_status === null || b.product_status === '') {
      updates.product_status = null;
    } else {
      const ps = String(b.product_status).trim().toLowerCase();
      if (ps === 'active' || ps === 'discontinued' || ps === 'out_of_stock') {
        updates.product_status = ps;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return json(res, 400, { ok: false, error: '수정할 항목 없음' });
  }

  const { error } = await client.from('sku_list').update(updates).eq('sku_id', sku_id);

  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true });
};
