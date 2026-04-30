const busboy = require('busboy');
const { parse } = require('csv-parse/sync');
const { getSupabase } = require('../lib/supabase');
const { json, handleOptions } = require('../lib/cors');

const COL_BRAND = '브랜드';
const COL_SKU_ID = 'SKU ID';
const COL_SKU_NAME = 'SKU 명';
const COL_URL = 'url';
const COL_REGISTERED = '등록가';
const COL_SUPPLY = '공급가';
const COL_FLAG = '플래그';
const COL_MEMO = '메모';

function defaultProductUrl(skuId) {
  return `https://www.coupang.com/vp/products/${skuId}`;
}

function collectFileBuffer(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data'));
      return;
    }

    const bb = busboy({ headers: req.headers });
    const chunks = [];
    let tookFile = false;

    bb.on('file', (_name, file, info) => {
      if (tookFile) {
        file.resume();
        return;
      }
      if (
        info.mimeType &&
        !info.mimeType.includes('csv') &&
        !info.mimeType.includes('text') &&
        !info.mimeType.includes('octet-stream')
      ) {
        file.resume();
        return;
      }
      tookFile = true;
      file.on('data', (d) => chunks.push(d));
    });

    bb.on('error', reject);
    bb.on('finish', () => {
      if (!chunks.length) {
        reject(new Error('No CSV file received'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.pipe(bb);
  });
}

function parseCsvRows(buf) {
  const text = buf.toString('utf8');
  let records;
  try {
    records = parse(text, {
      columns: (header) => header.map((h) => String(h).trim()),
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e) {
    throw new Error(`CSV parse failed: ${e.message}`);
  }
  return Array.isArray(records) ? records : [];
}

function rowToPayload(rec) {
  const sku_id = String(rec[COL_SKU_ID] ?? '').trim();
  if (!sku_id) return null;

  let brand = String(rec[COL_BRAND] ?? '').trim();
  if (!brand) brand = '미지정';

  const sku_name = String(rec[COL_SKU_NAME] ?? '').trim() || null;
  let product_url = String(rec[COL_URL] ?? '').trim();
  if (!product_url) product_url = defaultProductUrl(sku_id);

  const regRaw = String(rec[COL_REGISTERED] ?? '').replace(/,/g, '').trim();
  let registered_price = null;
  if (regRaw !== '') {
    const n = parseInt(regRaw, 10);
    if (!Number.isNaN(n)) registered_price = n;
  }
  const supplyRaw = String(rec[COL_SUPPLY] ?? '').replace(/,/g, '').trim();
  let supply_price = null;
  if (supplyRaw !== '') {
    const sn = parseInt(supplyRaw, 10);
    if (!Number.isNaN(sn)) supply_price = sn;
  }

  const flagRaw = String(rec[COL_FLAG] ?? '').trim();
  const flag = flagRaw === '' ? null : flagRaw;

  const memoRaw = String(rec[COL_MEMO] ?? '').trim();
  const memo = memoRaw === '' ? null : memoRaw;

  return {
    sku_id,
    brand,
    sku_name,
    product_url,
    registered_price,
    supply_price,
    flag,
    memo,
  };
}

function dedupeBySkuId(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r) map.set(r.sku_id, r);
  }
  return map;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return handleOptions(res);
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const { client, error: envErr } = getSupabase();
  if (envErr) return json(res, 500, { ok: false, error: envErr });

  let buffer;
  try {
    buffer = await collectFileBuffer(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message || 'Upload failed' });
  }

  let records;
  try {
    records = parseCsvRows(buffer);
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message });
  }

  const payloads = [];
  for (const rec of records) {
    const p = rowToPayload(rec);
    if (p) payloads.push(p);
  }

  const bySku = dedupeBySkuId(payloads);
  if (bySku.size === 0) {
    return json(res, 400, { ok: false, error: 'No valid rows (SKU ID required)' });
  }

  const skuIds = [...bySku.keys()];
  const { data: existingRows, error: exErr } = await client
    .from('sku_list')
    .select('sku_id')
    .in('sku_id', skuIds);

  if (exErr) return json(res, 500, { ok: false, error: exErr.message });

  const existing = new Set((existingRows || []).map((r) => r.sku_id));
  const toInsert = [];
  const toUpdate = [];

  for (const p of bySku.values()) {
    if (existing.has(p.sku_id)) toUpdate.push(p);
    else
      toInsert.push({
        ...p,
        is_active: true,
        collect_cycle: 7,
      });
  }

  let inserted = 0;
  let updated = 0;

  if (toInsert.length) {
    const { error: insErr } = await client.from('sku_list').insert(toInsert);
    if (insErr) return json(res, 500, { ok: false, error: insErr.message });
    inserted = toInsert.length;
  }

  const CHUNK = 25;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const slice = toUpdate.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((p) =>
        client
          .from('sku_list')
          .update({
            brand: p.brand,
            sku_name: p.sku_name,
            product_url: p.product_url,
            registered_price: p.registered_price,
            supply_price: p.supply_price,
            flag: p.flag,
            memo: p.memo,
          })
          .eq('sku_id', p.sku_id)
      )
    );
    for (const r of results) {
      if (r.error) return json(res, 500, { ok: false, error: r.error.message });
    }
    updated += slice.length;
  }

  return json(res, 200, {
    ok: true,
    inserted,
    updated,
    total: bySku.size,
  });
};
