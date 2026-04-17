const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');
const { todayUtcYmd } = require('../lib/sku-due');

function nextDueYmd(lastCollected, collectCycle) {
  const c = Number(collectCycle) || 7;
  if (!lastCollected) return todayUtcYmd();
  const base = String(lastCollected).slice(0, 10);
  const d = new Date(`${base}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + c);
  return d.toISOString().slice(0, 10);
}

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

function flagKey(flag) {
  if (flag == null || String(flag).trim() === '') return '';
  return String(flag).trim();
}

function aggregateScheduleGroups(allRows) {
  const groups = new Map();
  for (const r of allRows) {
    const fk = flagKey(r.flag);
    const b = r.brand ?? '';
    const key = `${b}\0${fk}`;
    if (!groups.has(key)) {
      groups.set(key, {
        brand: r.brand,
        flag: fk,
        sku_ids: [],
        total: 0,
        active_count: 0,
        last_dates: [],
        next_dues: [],
      });
    }
    const g = groups.get(key);
    g.total += 1;
    g.sku_ids.push(r.sku_id);
    if (r.is_active) {
      g.active_count += 1;
      if (r.last_collected)
        g.last_dates.push(String(r.last_collected).slice(0, 10));
      g.next_dues.push(nextDueYmd(r.last_collected, r.collect_cycle));
    }
  }

  return [...groups.values()].map((g) => {
    const lastCollected =
      g.last_dates.length > 0 ? g.last_dates.sort().reverse()[0] : null;
    const nextDue =
      g.next_dues.length > 0 ? g.next_dues.sort()[0] : null;
    return {
      brand: g.brand,
      flag: g.flag,
      sku_count: g.total,
      active_count: g.active_count,
      all_active: g.active_count === g.total && g.total > 0,
      last_collected: lastCollected,
      next_collect_due: nextDue,
    };
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const { data: activeRows, error: aErr } = await client
    .from('sku_list')
    .select(
      'sku_id, brand, sku_name, registered_price, memo, last_collected, collect_cycle, flag, is_active, product_url'
    )
    .eq('is_active', true)
    .order('brand')
    .order('sku_id')
    .range(0, 4999);

  if (aErr) return json(res, 500, { ok: false, error: aErr.message });

  const { data: allRows, error: allErr } = await client
    .from('sku_list')
    .select(
      'sku_id, brand, flag, is_active, last_collected, collect_cycle'
    )
    .range(0, 4999);

  if (allErr) return json(res, 500, { ok: false, error: allErr.message });

  const list = activeRows || [];
  const skuIds = list.map((r) => r.sku_id);
  let priceMap;
  try {
    priceMap = await fetchLatestPricesMap(client, skuIds);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message || 'price lookup failed' });
  }

  const data = list.map((r) => {
    const current_price = priceMap.get(r.sku_id) ?? null;
    const reg = r.registered_price;
    let change_pct = null;
    if (
      current_price != null &&
      reg != null &&
      Number(reg) > 0
    ) {
      change_pct = Number(
        (((current_price - reg) / reg) * 100).toFixed(2)
      );
    }
    return {
      sku_id: r.sku_id,
      brand: r.brand,
      sku_name: r.sku_name,
      registered_price: r.registered_price,
      current_price,
      change_pct,
      memo: r.memo,
      last_collected: r.last_collected
        ? String(r.last_collected).slice(0, 10)
        : null,
      collect_cycle: r.collect_cycle,
      flag: flagKey(r.flag) || null,
      product_url: r.product_url,
    };
  });

  const schedule_groups = aggregateScheduleGroups(allRows || []);

  return json(res, 200, {
    ok: true,
    data,
    schedule_groups,
  });
};
