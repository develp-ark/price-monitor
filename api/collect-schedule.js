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
      'sku_id, brand, sku_name, product_url, last_collected, is_active, current_price, registered_price, priority_group, product_status'
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
      product_status: r.product_status || null,
      priority_group: (function (v) {
        var u = String(v || '')
          .trim()
          .toUpperCase();
        return u === 'A' || u === 'B' ? u : null;
      })(r.priority_group),
    }));
}

/** is_active=true AND (priority_group='B' OR priority_group IS NULL), 1000 rows/page */
async function fetchSkuListBGroup(client) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('sku_list')
      .select('sku_id')
      .eq('is_active', true)
      .or('priority_group.eq.B,priority_group.is.null')
      .order('sku_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) all.push(rows[i]);
    if (rows.length < 1000) break;
  }
  return all;
}

/** is_active=true AND priority_group='A', 1000 rows/page */
async function fetchSkuListAGroup(client) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('sku_list')
      .select('sku_id')
      .eq('is_active', true)
      .eq('priority_group', 'A')
      .order('sku_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) all.push(rows[i]);
    if (rows.length < 1000) break;
  }
  return all;
}

async function fetchAllScheduleDaysPaged(client) {
  const allRows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('collect_schedule')
      .select('day_of_week')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) allRows.push(rows[i]);
    if (rows.length < 1000) break;
  }
  return allRows;
}

async function fetchActivePriorityGroupRowsPaged(client) {
  const groupRows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('sku_list')
      .select('priority_group')
      .eq('is_active', true)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) groupRows.push(rows[i]);
    if (rows.length < 1000) break;
  }
  return groupRows;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  if (req.method === 'GET') {
    if (req.query.day === undefined) {
      try {
        const allRows = await fetchAllScheduleDaysPaged(client);
        const summary = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        allRows.forEach(function (r) {
          summary[r.day_of_week]++;
        });
        const groupRows = await fetchActivePriorityGroupRowsPaged(client);
        let aCount = 0;
        let bCount = 0;
        groupRows.forEach(function (r) {
          if (r.priority_group === 'A') aCount++;
          else bCount++;
        });
        return json(res, 200, {
          ok: true,
          summary,
          a_group: aCount,
          b_group: bCount,
        });
      } catch (e) {
        return json(res, 500, {
          ok: false,
          error: e.message || 'Failed to load summary',
        });
      }
    }
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
    try {
      const bSkus = await fetchSkuListBGroup(client);
      const aSkus = await fetchSkuListAGroup(client);
      const days = [1, 2, 3, 4, 5];

      const { error: delErr } = await client
        .from('collect_schedule')
        .delete()
        .in('day_of_week', days);
      if (delErr) return json(res, 500, { ok: false, error: delErr.message });

      const inserts = [];
      bSkus.forEach(function (s, idx) {
        inserts.push({ sku_id: s.sku_id, day_of_week: days[idx % 5] });
      });
      aSkus.forEach(function (s) {
        days.forEach(function (d) {
          inserts.push({ sku_id: s.sku_id, day_of_week: d });
        });
      });

      for (let b = 0; b < inserts.length; b += 500) {
        const chunk = inserts.slice(b, b + 500);
        const { error: insErr } = await client.from('collect_schedule').insert(chunk);
        if (insErr) return json(res, 500, { ok: false, error: insErr.message });
      }

      const summary = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      inserts.forEach(function (r) {
        summary[r.day_of_week]++;
      });

      return json(res, 200, {
        ok: true,
        message: 'Auto-distribute complete',
        a_group: aSkus.length,
        b_group: bSkus.length,
        summary,
      });
    } catch (e) {
      return json(res, 500, {
        ok: false,
        error: e.message || 'Auto-distribute failed',
      });
    }
  }

  if (body.action === 'collect_schedule') {
    var kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var kstDay = kstNow.getUTCDay();

    // collect_schedule 테이블에서 오늘 요일의 sku_id 조회 (페이지네이션)
    var schedIds = [];
    var sFrom = 0;
    while (true) {
      var sResult = await client.from('collect_schedule').select('sku_id').eq('day_of_week', kstDay).range(sFrom, sFrom + 999);
      if (sResult.error) return json(res, 500, { ok: false, error: sResult.error.message });
      schedIds = schedIds.concat((sResult.data || []).map(function(r) { return r.sku_id; }));
      if (!sResult.data || sResult.data.length < 1000) break;
      sFrom += 1000;
    }

    if (!schedIds.length) {
      return json(res, 200, { ok: true, action: 'collect_schedule', day_of_week: kstDay, items: [], total: 0 });
    }

    // sku_list에서 해당 SKU 정보 조회 (페이지네이션, is_active=true)
    var items = [];
    var batchSize = 300;
    for (var b = 0; b < schedIds.length; b += batchSize) {
      var batch = schedIds.slice(b, b + batchSize);
      var skuResult = await client.from('sku_list').select('sku_id, product_url, sku_name, brand, last_collected, registered_price, current_price, product_status').eq('is_active', true).in('sku_id', batch);
      if (skuResult.error) return json(res, 500, { ok: false, error: skuResult.error.message });
      items = items.concat((skuResult.data || []).map(function(r) {
        return { sku_id: r.sku_id, product_url: r.product_url, sku_name: r.sku_name, brand: r.brand, last_collected: r.last_collected || null, registered_price: r.registered_price || null, current_price: r.current_price || null, product_status: r.product_status || null };
      }));
    }

    return json(res, 200, { ok: true, action: 'collect_schedule', day_of_week: kstDay, items: items, total: items.length });
  }

  if (body.action === 'collect_all') {
    var allItems = [];
    var aFrom = 0;
    while (true) {
      var aResult = await client.from('sku_list').select('sku_id, product_url, sku_name, brand, last_collected, registered_price, current_price, product_status').eq('is_active', true).order('brand', { ascending: true }).order('sku_id', { ascending: true }).range(aFrom, aFrom + 999);
      if (aResult.error) return json(res, 500, { ok: false, error: aResult.error.message });
      allItems = allItems.concat((aResult.data || []).map(function(r) {
        return { sku_id: r.sku_id, product_url: r.product_url, sku_name: r.sku_name, brand: r.brand, last_collected: r.last_collected || null, registered_price: r.registered_price || null, current_price: r.current_price || null, product_status: r.product_status || null };
      }));
      if (!aResult.data || aResult.data.length < 1000) break;
      aFrom += 1000;
    }
    return json(res, 200, { ok: true, action: 'collect_all', items: allItems, total: allItems.length });
  }

  if (body.action === 'collect_brand') {
    var brandName = (body.brand || '').trim();
    if (!brandName) return json(res, 400, { ok: false, error: 'brand is required' });

    var brandItems = [];
    var bFrom = 0;
    while (true) {
      var bResult = await client.from('sku_list').select('sku_id, product_url, sku_name, brand, last_collected, registered_price, current_price, product_status').eq('is_active', true).eq('brand', brandName).order('sku_id', { ascending: true }).range(bFrom, bFrom + 999);
      if (bResult.error) return json(res, 500, { ok: false, error: bResult.error.message });
      brandItems = brandItems.concat((bResult.data || []).map(function(r) {
        return { sku_id: r.sku_id, product_url: r.product_url, sku_name: r.sku_name, brand: r.brand, last_collected: r.last_collected || null, registered_price: r.registered_price || null, current_price: r.current_price || null, product_status: r.product_status || null };
      }));
      if (!bResult.data || bResult.data.length < 1000) break;
      bFrom += 1000;
    }
    return json(res, 200, { ok: true, action: 'collect_brand', brand: brandName, items: brandItems, total: brandItems.length });
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
