// Pulls every in-stock fragrance variant from each source in config/sources.json
// and writes a flat offer list to build/offers.json. No dependencies (Node 20+).
//
//   node scripts/scrape.js               # all sources
//   node scripts/scrape.js decantx aura  # just these
//   MAX_PAGES=2 node scripts/scrape.js   # quick smoke test

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  canonicalBrand, concentration, sizeMl, isTester, isNotPerfume, fragranceName, perfumeId, brandFromTitle, words,
} from './lib/normalize.js';

const UA = 'PerfumePriceIndex/1.0 (+non-commercial price comparison; polite crawler)';
// Shopify rate-limits per IP across *all* its stores, so every Shopify request shares one budget.
const MAX_RPS = +(process.env.MAX_RPS || 1);
const MAX_PAGES = +(process.env.MAX_PAGES || 80);
const STALE_DAYS = 3; // reuse a failed source's previous offers for this long
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1000 / MAX_RPS;
  if (wait) await sleep(wait);
}
// A 429 anywhere means the shared budget is spent: pause everyone, not just that store.
function backOffAll(ms) {
  nextSlot = Math.max(nextSlot, Date.now() + ms);
}

async function getJson(url, tries = 6) {
  for (let i = 1; ; i++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(5000 * i);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (i >= tries) throw new Error(`HTTP ${res.status}`);
      const wait = (+res.headers.get('retry-after') || 15 * 2 ** (i - 1)) * 1000;
      console.log(`  ${new URL(url).host}: HTTP ${res.status}, pausing all requests ${Math.round(wait / 1000)}s`);
      backOffAll(wait);
      continue;
    }
    if (!res.ok) return null;
    return res.json();
  }
}

async function* shopifyProducts(base) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await getJson(`${base}/products.json?limit=250&page=${page}`);
    const products = j?.products || [];
    if (!products.length) return;
    yield* products;
  }
}

function offersFromShopify(src, p, knownBrands) {
  const out = [];
  const productText = `${p.title} ${p.product_type || ''}`;
  if (isNotPerfume(productText)) return out;
  const vendor = src.brandFrom === 'title' ? brandFromTitle(p.title, knownBrands) : p.vendor;
  const brand = canonicalBrand(vendor);
  if (!brand) return out;
  const name = fragranceName(p.title, brand, vendor);
  if (!name) return out;
  // Vintage shops sell specific batches; keep that visible instead of silently merging.
  const batch = p.title.match(/\b((?:19|20)\d{2})'?s?\s+batch\b/i);
  const note = batch ? `${batch[1]}${/'?s\s/i.test(batch[0]) ? 's' : ''} batch` : undefined;

  for (const v of p.variants || []) {
    if (!v.available) continue;
    const vt = v.title === 'Default Title' ? '' : v.title;
    const all = `${productText} ${vt}`;
    if (isNotPerfume(vt)) continue;
    const ml = sizeMl(vt) ?? sizeMl(p.title);
    const price = +v.price;
    if (!ml || !(price > 0)) continue;
    // Decant shops: anything in the original bottle is a full bottle, the rest is a decant.
    const inOriginalBottle = /manufacturer|original bottle|full bottle|retail bottle/i.test(`${p.title} ${vt}`);
    // 'mixed' shops sell full bottles and samples: small sizes count as decants only when labelled so.
    const labelledSample = /sample|decant|atomizer|vial|split/i.test(`${p.title} ${vt}`);
    const kind =
      (src.kind === 'decant' && ml <= 35 && !(inOriginalBottle && ml > 15)) ||
      (src.kind === 'mixed' && (ml <= 15 || (ml <= 35 && labelledSample)))
        ? 'decant' : 'bottle';
    // A product can list EDT and EDP as variants, so the variant's own label wins.
    const conc = concentration(vt) || concentration(productText);
    out.push({
      id: perfumeId(brand, name, conc),
      brand, name, conc,
      src: src.id, kind, ml, price,
      tester: isTester(all) || undefined,
      note,
      url: `${src.base}/products/${p.handle}${vt ? `?variant=${v.id}` : ''}`,
    });
  }
  return out;
}

const ADAPTERS = {
  async shopify(src) {
    const offers = [];
    const products = [];
    let n = 0;
    for await (const p of shopifyProducts(src.base)) {
      n++;
      // Title-branded shops are resolved after the others finish, against every brand seen.
      if (src.brandFrom === 'title') products.push({ title: p.title, product_type: p.product_type, handle: p.handle, variants: p.variants });
      else offers.push(...offersFromShopify(src, p));
    }
    return { offers, products, scanned: n };
  },
};

const { sources } = JSON.parse(await readFile(new URL('../config/sources.json', import.meta.url)));
const only = process.argv.slice(2);
const picked = sources.filter((s) => !only.length || only.includes(s.id));

// Last run's offers (cached between CI runs) stand in for a source that fails today.
let previous = [];
let previousAt = '';
try {
  const prev = JSON.parse(await readFile(new URL('../build/offers.json', import.meta.url)));
  if (Date.now() - Date.parse(prev.scrapedAt) < STALE_DAYS * 86400000) ({ offers: previous, scrapedAt: previousAt } = prev);
} catch {}

// Crawl all sources concurrently; the shared throttle above keeps the total request rate polite.
const results = await Promise.all(picked.map(async (src) => {
  const t = Date.now();
  try {
    const r = await ADAPTERS[src.adapter](src);
    if (src.brandFrom !== 'title') console.log(`${src.id}: ${r.scanned} products -> ${r.offers.length} offers (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    return { src, ...r };
  } catch (e) {
    const prev = previous.filter((o) => o.src === src.id);
    console.error(`${src.id}: FAILED ${e.message}${prev.length ? ` - keeping ${prev.length} offers from ${previousAt.slice(0, 10)}` : ''}`);
    return { src, offers: prev, products: [], failed: true };
  }
}));

// Brands known from shops with a real vendor field (plus aliases), keyed by lowercase words.
const knownBrands = new Map();
for (const r of results) for (const o of r.offers) knownBrands.set(words(o.brand), o.brand);
for (const r of results) {
  if (r.src.brandFrom !== 'title' || r.failed) continue;
  let dropped = 0;
  for (const p of r.products) {
    const got = offersFromShopify(r.src, p, knownBrands);
    if (!got.length) dropped++;
    r.offers.push(...got);
  }
  console.log(`${r.src.id}: ${r.scanned} products -> ${r.offers.length} offers (${dropped} products skipped: sold out, no size, unknown brand or not perfume)`);
}

const offers = results.flatMap((r) => r.offers);
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/offers.json', import.meta.url), JSON.stringify({ scrapedAt: new Date().toISOString(), offers }));
console.log(`total: ${offers.length} offers`);
