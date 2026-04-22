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

function sanitizeInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

async function getLatestStatus(client) {
  const { data, error } = await client
    .from('collect_status')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  if (req.method === 'GET') {
    try {
      const data = await getLatestStatus(client);
      return json(res, 200, {
        ok: true,
        data: data || {
          status: 'idle',
          collect_mode: null,
          total: 0,
          current: 0,
          success: 0,
          fail: 0,
          current_sku_name: null,
          started_at: null,
          updated_at: null,
          finished_at: null,
        },
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message || 'Failed to load status' });
    }
  }

  if (req.method === 'PATCH') {
    const body = parseBody(req, res);
    if (!body) return;

    const latest = await getLatestStatus(client);
    if (!latest) {
      return json(res, 404, { ok: false, error: 'No active session. start first.' });
    }

    const next = {
      current: sanitizeInt(body.current, latest.current || 0),
      success: sanitizeInt(body.success, latest.success || 0),
      fail: sanitizeInt(body.fail, latest.fail || 0),
      current_sku_name: body.current_sku_name ?? latest.current_sku_name ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('collect_status')
      .update(next)
      .eq('id', latest.id)
      .select('*')
      .single();
    if (error) return json(res, 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, data });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const body = parseBody(req, res);
  if (!body) return;

  if (body.action === 'start') {
    const total = sanitizeInt(body.total, 0);
    const collect_mode = body.collect_mode != null ? String(body.collect_mode) : null;
    const now = new Date().toISOString();
    const { data, error } = await client
      .from('collect_status')
      .insert({
        status: 'running',
        collect_mode,
        total,
        current: 0,
        success: 0,
        fail: 0,
        current_sku_name: null,
        started_at: now,
        updated_at: now,
        finished_at: null,
      })
      .select('*')
      .single();
    if (error) return json(res, 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, data });
  }

  if (body.action === 'done' || body.action === 'stop') {
    const latest = await getLatestStatus(client);
    if (!latest) {
      return json(res, 404, { ok: false, error: 'No session found' });
    }
    const now = new Date().toISOString();
    const status = body.action === 'done' ? 'done' : 'stopping';
    const patch = {
      status,
      updated_at: now,
      finished_at: body.action === 'done' ? now : latest.finished_at,
    };

    const { data, error } = await client
      .from('collect_status')
      .update(patch)
      .eq('id', latest.id)
      .select('*')
      .single();
    if (error) return json(res, 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, data });
  }

  return json(res, 400, { ok: false, error: 'Unknown action' });
};
