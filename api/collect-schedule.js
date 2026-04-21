const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

function parseBody(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      json(res, 400, { ok: false, error: 'Invalid JSON body' });
      return null;
    }
  }
  return body || {};
}

function parseDay(dayRaw) {
  if (dayRaw === 'today') return new Date().getDay();
  const day = Number(dayRaw);
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  return day;
}

async function loadDayRows(client, day) {
  const { data: scheduleRows, error: scErr } = await client
    .from('collect_schedule')
    .select('sku_id')
    .eq('day_of_week', day)
    .order('id', { ascending: true });
  if (scErr) throw new Error(scErr.message);

  const ids = (scheduleRows || []).map((r) => r.sku_id);
  if (!ids.length) return [];

  const { data: skuRows, error: skuErr } = await client
    .from('sku_list')
    .select(
      'sku_id, brand, sku_name, product_url, last_collected, is_active, current_price, registered_price, priority_group'
    )
    .in('sku_id', ids);
  if (skuErr) throw new Error(skuErr.message);

  const map = new Map((skuRows || []).map((r) => [r.sku_id, r]));
  return ids
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((r) => ({
      sku_id: r.sku_id,
      brand: r.brand,
      sku_name: r.sku_name,
      product_url: r.product_url,
      is_active: r.is_active,
      last_collected: r.last_collected || null,
      current_price: r.current_price || null,
      registered_price: r.registered_price || null,
      priority_group: (function (v) {
        var u = String(v || '')
          .trim()
          .toUpperCase();
        return u === 'A' || u === 'B' ? u : null;
      })(r.priority_group),
    }));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  if (req.method === 'GET') {
    if (req.query.day === 'all') {
      const { data, error } = await client
        .from('collect_schedule')
        .select('day_of_week, sku_id')
        .order('day_of_week')
        .order('sku_id');

      if (error) return json(res, 500, { ok: false, error: error.message });
      return json(res, 200, { ok: true, count: (data || []).length, data: data || [] });
    }

    const day = parseDay(req.query.day);
    if (day == null) {
      return json(res, 400, { ok: false, error: 'day must be 0..6 or today' });
    }
    try {
      const data = await loadDayRows(client, day);
      return json(res, 200, { ok: true, day_of_week: day, count: data.length, data });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message || 'Failed to load schedule' });
    }
  }

  if (req.method === 'DELETE') {
    const body = parseBody(req, res);
    if (!body) return;
    const day = parseDay(body.day_of_week);
    const sku_id = String(body.sku_id || '').trim();
    if (day == null || !sku_id) {
      return json(res, 400, { ok: false, error: 'day_of_week and sku_id are required' });
    }

    const { error } = await client
      .from('collect_schedule')
      .delete()
      .eq('day_of_week', day)
      .eq('sku_id', sku_id);
    if (error) return json(res, 500, { ok: false, error: error.message });

    return json(res, 200, { ok: true, deleted: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = parseBody(req, res);
  if (!body) return;

  if (body.action === 'auto_distribute') {
    const { data: activeRows, error: skuErr } = await client
      .from('sku_list')
      .select('sku_id')
      .eq('is_active', true)
      .order('brand')
      .order('sku_id');
    if (skuErr) return json(res, 500, { ok: false, error: skuErr.message });

    const skuIds = (activeRows || []).map((r) => r.sku_id);
    const weekdays = [1, 2, 3, 4, 5];
    const inserts = skuIds.map((sku_id, i) => ({
      day_of_week: weekdays[i % weekdays.length],
      sku_id,
    }));

    const { error: delErr } = await client
      .from('collect_schedule')
      .delete()
      .in('day_of_week', weekdays);
    if (delErr) return json(res, 500, { ok: false, error: delErr.message });

    if (inserts.length) {
      const { error: insErr } = await client.from('collect_schedule').insert(inserts);
      if (insErr) return json(res, 500, { ok: false, error: insErr.message });
    }

    return json(res, 200, { ok: true, assigned: inserts.length });
  }

  const day = parseDay(body.day_of_week);
  const sku_ids = Array.isArray(body.sku_ids)
    ? body.sku_ids.map((x) => String(x || '').trim()).filter(Boolean)
    : [];

  if (day == null || !sku_ids.length) {
    return json(res, 400, { ok: false, error: 'day_of_week and sku_ids[] are required' });
  }

  const { error: delErr } = await client
    .from('collect_schedule')
    .delete()
    .eq('day_of_week', day);
  if (delErr) return json(res, 500, { ok: false, error: delErr.message });

  const inserts = sku_ids.map((sku_id) => ({ day_of_week: day, sku_id }));
  const { error: insErr } = await client.from('collect_schedule').insert(inserts);
  if (insErr) return json(res, 500, { ok: false, error: insErr.message });

  return json(res, 200, { ok: true, day_of_week: day, assigned: inserts.length });
};
