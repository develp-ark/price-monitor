const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

const PID_RE = /\/products\/(\d+)/;

function extractPidFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(PID_RE);
  return m ? m[1] : null;
}

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
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'POST only' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  const b = parseBody(req);
  if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });

  const sku_id = b.sku_id != null ? String(b.sku_id).trim() : '';
  const sku_name = b.sku_name != null ? String(b.sku_name).trim() : '';
  const brand = b.brand != null ? String(b.brand).trim() : '';
  const product_url = b.product_url != null ? String(b.product_url).trim() : '';

  if (!sku_id || !sku_name || !brand || !product_url) {
    return json(res, 400, {
      ok: false,
      error: '필수 항목: sku_id, sku_name, brand, product_url',
    });
  }

  const pid = b.pid != null && String(b.pid).trim() !== '' ? String(b.pid).trim() : extractPidFromUrl(product_url);

  const row = {
    sku_id,
    sku_name,
    brand,
    product_url,
    registered_price:
      b.registered_price != null && b.registered_price !== ''
        ? Number(b.registered_price)
        : null,
    collect_cycle:
      b.collect_cycle != null && b.collect_cycle !== '' ? Number(b.collect_cycle) : 7,
    flag: b.flag != null && String(b.flag).trim() !== '' ? String(b.flag).trim() : null,
    memo: b.memo != null && String(b.memo).trim() !== '' ? String(b.memo).trim() : null,
    is_active: true,
  };

  if (pid) row.pid = pid;

  const { error } = await client.from('sku_list').insert([row]);

  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true });
};
