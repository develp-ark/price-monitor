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
  if (req.method !== 'DELETE') {
    return json(res, 405, { ok: false, error: 'DELETE only' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const b = parseBody(req);
  if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });

  const sku_id = b.sku_id != null ? String(b.sku_id).trim() : '';
  if (!sku_id) {
    return json(res, 400, { ok: false, error: 'sku_id 필요' });
  }

  const { error: e1 } = await client.from('collect_schedule').delete().eq('sku_id', sku_id);
  if (e1) {
    console.warn('[sku-delete] collect_schedule', e1.message);
  }

  const { error } = await client.from('sku_list').delete().eq('sku_id', sku_id);

  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true });
};
