const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

const PID_RE = /\/products\/(\d+)/;

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

function extractPidFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(PID_RE);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  try {
    if (req.method === 'GET') {
      const status = req.query && req.query.status != null ? String(req.query.status) : '';
      let q = client.from('collect_queue').select('*').order('id', { ascending: false });
      if (status === 'pending') {
        q = q.eq('status', 'pending');
      }
      const { data: rows, error } = await q;
      if (error) throw error;
      const list = rows || [];
      return json(res, 200, { ok: true, count: list.length, data: list });
    }

    if (req.method === 'POST') {
      const b = parseBody(req);
      if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });

      if (Array.isArray(b.sku_ids) && b.sku_ids.length) {
        const ids = b.sku_ids.map((x) => String(x).trim()).filter(Boolean);
        if (!ids.length) {
          return json(res, 400, { ok: false, error: 'sku_ids 비어 있음' });
        }
        const { data: skus, error: e1 } = await client
          .from('sku_list')
          .select('sku_id, sku_name, brand, product_url')
          .in('sku_id', ids);
        if (e1) throw e1;
        const found = new Map((skus || []).map((r) => [String(r.sku_id), r]));
        const toInsert = [];
        for (const id of ids) {
          const row = found.get(id);
          if (!row || !row.product_url) continue;
          toInsert.push({
            sku_id: String(row.sku_id),
            sku_name: row.sku_name || null,
            brand: row.brand || null,
            product_url: String(row.product_url).trim(),
            status: 'pending',
          });
        }
        if (!toInsert.length) {
          return json(res, 400, { ok: false, error: '등록된 SKU를 찾을 수 없습니다' });
        }
        const { data: ins, error: e2 } = await client.from('collect_queue').insert(toInsert).select();
        if (e2) throw e2;
        return json(res, 200, { ok: true, count: ins.length, data: ins });
      }

      if (Array.isArray(b.items) && b.items.length) {
        const toInsert = [];
        for (const it of b.items) {
          const product_url = it && it.product_url ? String(it.product_url).trim() : '';
          if (!product_url) continue;
          const pid = extractPidFromUrl(product_url);
          if (!pid) continue;
          toInsert.push({
            sku_id: pid,
            sku_name: it.sku_name != null ? String(it.sku_name).trim() : null,
            brand: it.brand != null ? String(it.brand).trim() : null,
            product_url,
            status: 'pending',
          });
        }
        if (!toInsert.length) {
          return json(res, 400, { ok: false, error: '유효한 URL이 없습니다' });
        }
        const { data: ins, error: e3 } = await client.from('collect_queue').insert(toInsert).select();
        if (e3) throw e3;
        return json(res, 200, { ok: true, count: ins.length, data: ins });
      }

      return json(res, 400, { ok: false, error: 'sku_ids 또는 items 필요' });
    }

    if (req.method === 'PATCH') {
      const b = parseBody(req);
      if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });
      const id = b.id != null ? Number(b.id) : NaN;
      const status = b.status != null ? String(b.status) : '';
      if (!Number.isFinite(id) || !['done', 'failed', 'collecting'].includes(status)) {
        return json(res, 400, { ok: false, error: 'id 및 status(done|failed|collecting) 필요' });
      }
      const patch = { status };
      if (status === 'done') {
        patch.collected_at = new Date().toISOString();
        if (b.result_price != null) patch.result_price = Math.round(Number(b.result_price));
      } else if (status === 'failed') {
        patch.collected_at = new Date().toISOString();
        patch.result_price = null;
      }
      const { data, error } = await client.from('collect_queue').update(patch).eq('id', id).select();
      if (error) throw error;
      return json(res, 200, { ok: true, data: data && data[0] });
    }

    if (req.method === 'DELETE') {
      const b = parseBody(req);
      if (!b) return json(res, 400, { ok: false, error: 'Invalid JSON body' });
      if (b.action !== 'clear_done') {
        return json(res, 400, { ok: false, error: 'action: clear_done 필요' });
      }
      const { error } = await client
        .from('collect_queue')
        .delete()
        .in('status', ['done', 'failed']);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[collect-queue]', e);
    return json(res, 500, { ok: false, error: e.message });
  }
};
