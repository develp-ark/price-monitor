#!/usr/bin/env node
/**
 * Coupang price collector → price-monitor API.
 * GitHub Actions: puppeteer-core + @sparticuz/chromium
 * Local: set PUPPETEER_EXECUTABLE_PATH to Chrome/Chromium binary.
 */

const DEFAULT_API = 'https://price-monitor-mocha.vercel.app';
const MAX_SKUS = 50;
const GOTO_TIMEOUT_MS = 15_000;
const POST_WAIT_MS = 3_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelayMs() {
  return 2000 + Math.floor(Math.random() * 2001);
}

function baseUrl() {
  return (process.env.PRICE_API_URL || DEFAULT_API).replace(/\/$/, '');
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
      ...options.headers,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data };
}

async function getLaunchOptions() {
  const puppeteer = require('puppeteer-core');
  if (process.env.GITHUB_ACTIONS === 'true') {
    const chromium = require('@sparticuz/chromium');
    return {
      puppeteer,
      options: {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: true,
      },
    };
  }
  const exe =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';
  if (!exe) {
    console.error(
      '로컬 실행: Chrome/Chromium 경로를 환경변수로 지정하세요.\n' +
        '  PUPPETEER_EXECUTABLE_PATH (예: Windows "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe")'
    );
    process.exit(1);
  }
  return {
    puppeteer,
    options: {
      executablePath: exe,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  };
}

async function gotoWithRetry(page, url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: GOTO_TIMEOUT_MS,
      });
      return true;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(1500);
    }
  }
  throw lastErr;
}

async function waitForPriceDom(page) {
  await Promise.race([
    page
      .waitForSelector(
        '.prod-sale-price, .total-price, [class*="sale-price"], [class*="SalePrice"]',
        { timeout: POST_WAIT_MS }
      )
      .catch(() => null),
    sleep(POST_WAIT_MS),
  ]);
}

/**
 * @returns {{ oos: boolean, price: number|null, original_price: number|null, discount_rate: string|null }}
 */
async function extractPriceInfo(page) {
  return page.evaluate(() => {
    const pickText = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return t;
        }
      }
      return '';
    };

    const parseWon = (text) => {
      if (!text) return null;
      const m = String(text).match(/[\d,]+/);
      if (!m) return null;
      const n = parseInt(m[0].replace(/,/g, ''), 10);
      return Number.isFinite(n) ? n : null;
    };

    const bodyText = document.body ? document.body.innerText || '' : '';
    const oosSelectors = ['.oos-label', '[class*="out-of-stock"]', '[class*="soldout"]'];
    for (const sel of oosSelectors) {
      if (document.querySelector(sel)) {
        return { oos: true, price: 0, original_price: null, discount_rate: null };
      }
    }
    const oosKeywords = ['품절', '일시품절', '판매중지'];
    if (oosKeywords.some((k) => bodyText.includes(k))) {
      return { oos: true, price: 0, original_price: null, discount_rate: null };
    }

    const saleSelectors = [
      '.prod-sale-price',
      '.total-price',
      '.prod-price .price',
      '.prod-price strong',
      '[class*="total-price"]',
      '[class*="sale-price"]',
      '.price-amount',
      '.price-value',
    ];
    const originSelectors = [
      '.origin-price',
      '.base-price',
      '.prod-origin-price',
      '[class*="origin-price"]',
      '[class*="base-price"]',
      '.discount-price + span',
    ];
    const discountSelectors = [
      '.discount-rate',
      '.sale-ratio',
      '[class*="discount-rate"]',
      '[class*="sale-ratio"]',
    ];

    const saleText = pickText(saleSelectors);
    const originText = pickText(originSelectors);
    const discText = pickText(discountSelectors);

    const price = parseWon(saleText);
    const original_price = parseWon(originText);
    let discount_rate = discText || null;
    if (discount_rate && !/%/.test(discount_rate) && /\d/.test(discount_rate)) {
      discount_rate = discount_rate.includes('%') ? discount_rate : `${discount_rate}%`;
    }

    return {
      oos: false,
      price,
      original_price: original_price != null ? original_price : null,
      discount_rate: discount_rate || null,
    };
  });
}

async function postPrice(apiBase, payload) {
  const { res, data } = await fetchJson(`${apiBase}/api/price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !data || data.ok === false) {
    const msg = (data && data.error) || res.statusText || 'POST failed';
    throw new Error(msg);
  }
  return data;
}

function formatWon(n) {
  if (n == null) return '—';
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

async function main() {
  const apiBase = baseUrl();
  console.log(`API: ${apiBase}`);

  const { res, data } = await fetchJson(`${apiBase}/api/sku-list?due=1`);
  if (!res.ok || !data || data.ok === false) {
    console.error('sku-list 요청 실패:', data?.error || res.statusText);
    process.exit(1);
  }

  const rows = Array.isArray(data.data) ? data.data : [];
  if (rows.length === 0) {
    console.log('수집 대상 없음');
    process.exit(0);
  }

  const batch = rows.slice(0, MAX_SKUS);
  const totalTarget = batch.length;

  let collectedOk = 0;
  let changedCount = 0;
  let oosCount = 0;
  let failCount = 0;

  const { puppeteer, options } = await getLaunchOptions();
  const browser = await puppeteer.launch(options);
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });

  try {
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const skuId = row.sku_id;
      const name = row.sku_name || skuId;
      const url = row.product_url;

      if (i > 0) await sleep(randomDelayMs());

      try {
        if (!url || typeof url !== 'string') {
          throw new Error('product_url 없음');
        }

        await gotoWithRetry(page, url);
        await waitForPriceDom(page);

        const info = await extractPriceInfo(page);

        if (info.oos) {
          const result = await postPrice(apiBase, {
            sku_id: skuId,
            price: 0,
            original_price: null,
            discount_rate: null,
            collected_by: 'github-actions',
          });
          collectedOk += 1;
          oosCount += 1;
          if (result.changed) changedCount += 1;
          console.log(`[OK] ${skuId} ${name} → 품절/중지 (0원)`);
          continue;
        }

        if (info.price == null || !Number.isFinite(info.price)) {
          throw new Error('가격 추출 실패');
        }

        const result = await postPrice(apiBase, {
          sku_id: skuId,
          price: info.price,
          original_price: info.original_price,
          discount_rate: info.discount_rate,
          collected_by: 'github-actions',
        });
        collectedOk += 1;
        if (result.changed) changedCount += 1;
        console.log(`[OK] ${skuId} ${name} → ${formatWon(info.price)}`);
      } catch (e) {
        failCount += 1;
        console.log(`[FAIL] ${skuId} ${e.message || e}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('—— 요약 ——');
  console.log(`총 대상: ${totalTarget}개`);
  console.log(`수집 완료: ${collectedOk}개`);
  console.log(`가격 변동: ${changedCount}건`);
  console.log(`품절: ${oosCount}개`);
  console.log(`실패: ${failCount}개`);
}

main().catch((e) => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
