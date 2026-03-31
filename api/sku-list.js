const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');
const { isCollectionDue, todayUtcYmd } = require('../lib/sku-due');

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

  const data = list.map((r) => ({
    sku_id: r.sku_id,
    brand: r.brand,
    sku_name: r.sku_name,
    product_url: r.product_url,
    collect_cycle: r.collect_cycle,
    last_collected: r.last_collected
      ? String(r.last_collected).slice(0, 10)
      : null,
  }));

  return json(res, 200, { ok: true, count: data.length, data });
};
