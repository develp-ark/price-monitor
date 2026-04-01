#!/usr/bin/env node
/**
 * Coupang price collector → price-monitor API.
 * 로컬: 실제 Chrome 창(headless: false), 기본 경로 또는 PUPPETEER_EXECUTABLE_PATH.
 * GitHub Actions: headless + @sparticuz/chromium (디스플레이 없음).
 */

const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const DEFAULT_API = 'https://price-monitor-mocha.vercel.app';
const MAX_SKUS = 50;
/** networkidle2는 쿠팡처럼 요청이 많은 페이지에서 시간이 걸릴 수 있음 */
const GOTO_TIMEOUT_MS = 90_000;
const POST_WAIT_MS = 3_000;
const POST_NETWORKIDLE_EXTRA_MS = 3_000;
const DEFAULT_WIN_CHROME =
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EXTRA_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1920,1080',
];

const VIEWPORT = { width: 1920, height: 1080 };

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

async function getLaunchConfig() {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const chromium = require('@sparticuz/chromium');
    return {
      launchOpts: {
        headless: 'new',
        executablePath: await chromium.executablePath(),
        args: [...new Set([...chromium.args, ...EXTRA_ARGS])],
        defaultViewport: VIEWPORT,
      },
      useFixedViewport: true,
    };
  }

  const exe =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    (process.platform === 'win32' ? DEFAULT_WIN_CHROME : '');

  if (!exe) {
    console.error(
      'Chrome 실행 파일을 찾을 수 없습니다.\n' +
        '  PUPPETEER_EXECUTABLE_PATH 또는 CHROME_PATH 를 설정하세요.\n' +
        '  (Windows 기본값: ' +
        DEFAULT_WIN_CHROME +
        ')'
    );
    process.exit(1);
  }

  return {
    launchOpts: {
      headless: false,
      executablePath: exe,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--start-maximized',
      ],
      defaultViewport: null,
    },
    useFixedViewport: false,
  };
}

async function setupPage(page, { useFixedViewport }) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setUserAgent(UA);
  if (useFixedViewport) {
    await page.setViewport(VIEWPORT);
  }
}

/** 쿠팡 쿠키·마케팅 동의 등 팝업 자동 클릭 */
async function dismissCoupangConsent(page) {
  try {
    await page
      .waitForSelector('button, [role="button"], a', { timeout: 2500 })
      .catch(() => null);
    const clicked = await page.evaluate(() => {
      const candidates = document.querySelectorAll(
        'button, [role="button"], a, div[tabindex="0"]'
      );
      const patterns = [
        /동의하고/,
        /동의합니다/,
        /모두\s*동의/,
        /^동의$/,
        /필수\s*항목\s*동의/,
        /수락/,
      ];
      for (const el of candidates) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 80) continue;
        if (patterns.some((re) => re.test(t))) {
          el.click();
          return t.slice(0, 50);
        }
      }
      return null;
    });
    if (clicked) {
      console.log('[INFO] 쿠키/동의 클릭:', clicked);
      await sleep(800);
    }
  } catch {
    /* ignore */
  }
}

async function gotoWithRetry(page, url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
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

  const { launchOpts, useFixedViewport } = await getLaunchConfig();
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await setupPage(page, { useFixedViewport });

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
        await dismissCoupangConsent(page);
        await waitForPriceDom(page);
        await sleep(POST_NETWORKIDLE_EXTRA_MS);

        // 디버깅: 첫 번째 SKU만 페이지 HTML 일부 출력
        if (i === 0) {
          const html = await page.content();
          // 가격 관련 부분만 추출
          const priceArea = html.match(/.{0,500}(price|Price|가격).{0,500}/g);
          console.log('[DEBUG] price-related HTML:', JSON.stringify(priceArea?.slice(0, 3)));

          // 현재 URL 확인 (리다이렉트 여부)
          console.log('[DEBUG] current URL:', page.url());

          // 페이지 제목
          const title = await page.title();
          console.log('[DEBUG] page title:', title);
        }

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
