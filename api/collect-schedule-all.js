const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const { data, error } = await client
    .from('collect_schedule')
    .select('day_of_week, sku_id')
    .order('day_of_week')
    .order('sku_id');

  if (error) return json(res, 500, { ok: false, error: error.message });

  return json(res, 200, { ok: true, count: (data || []).length, data: data || [] });
};
