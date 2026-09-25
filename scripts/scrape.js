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

function makeThrottle(rps) {
  let nextSlot = 0;
  const t = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + 1000 / rps;
    if (wait) await sleep(wait);
  };
  // A 429 means the shared budget is spent: pause everyone on this throttle, not just one store.
  t.backOff = (ms) => { nextSlot = Math.max(nextSlot, Date.now() + ms); };
  return t;
}
const shopifyThrottle = makeThrottle(MAX_RPS);

async function fetchWithRetry(url, throttle, accept, tries = 6) {
  for (let i = 1; ; i++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(5000 * i);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (i >= tries) throw new Error(`HTTP ${res.status}`);
      const wait = (+res.headers.get('retry-after') || 15 * 2 ** (i - 1)) * 1000;
      console.log(`  ${new URL(url).host}: HTTP ${res.status}, pausing ${Math.round(wait / 1000)}s`);
      throttle.backOff(wait);
      continue;
    }
    return res.ok ? res : null;
  }
}
const getJson = async (url) => (await fetchWithRetry(url, shopifyThrottle, 'application/json'))?.json() ?? null;

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

// --- Sitemap + JSON-LD shops (e.g. MaxAroma): one product per page, far too many pages to fetch
// daily, so each run refreshes the least-recently-checked `dailyBudget` pages and carries the rest
// forward for up to `maxAgeDays` (the site shows their "as of" date).
const today = new Date().toISOString().slice(0, 10);
const dayNum = (iso) => Math.floor(Date.parse(iso) / 86400000);

function ldProduct(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const node of [j, ...(j['@graph'] || [])].flat()) if (node?.['@type'] === 'Product') return node;
  }
  return null;
}

function offerFromLd(src, page, knownBrands) {
  const { ld, url, category } = page;
  const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const price = +offer?.price;
  if (!(price > 0) || !/InStock/i.test(offer?.availability || '')) return null;
  if ((offer.priceCurrency || 'USD') !== 'USD') return null;
  const desc = String(ld.description || '');
  if (isNotPerfume(`${ld.name} ${desc}`)) return null;
  const vendor = (typeof ld.brand === 'object' ? ld.brand?.name : ld.brand) || brandFromTitle(ld.name, knownBrands);
  const brand = canonicalBrand(vendor);
  if (!brand) return null;
  const name = fragranceName(ld.name, brand, vendor);
  const ml = sizeMl(desc) ?? sizeMl(ld.name);
  if (!name || !ml) return null;
  const conc = concentration(desc) || concentration(ld.name);
  return {
    id: perfumeId(brand, name, conc), brand, name, conc,
    src: src.id, kind: /^vial\//.test(category) ? 'decant' : 'bottle', ml, price,
    tester: /tester/i.test(category) || isTester(`${ld.name} ${desc}`) || undefined,
    url, seen: today,
  };
}

const ADAPTERS = {
  async jsonld(src) {
    const res = await fetchWithRetry(src.sitemap, src.throttle, 'application/xml');
    if (!res) throw new Error('sitemap unavailable');
    const include = new RegExp(src.include);
    const byKey = new Map(); // one URL per product id (the same product is listed under several categories)
    for (const [, url] of (await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const key = url.match(new RegExp(src.idPattern))?.[1];
      const category = new URL(url).pathname.split('/').slice(1, 3).join('/');
      if (key && include.test(category) && !byKey.has(key)) byKey.set(key, { url, category });
    }
    const checked = jsonldState[src.id] ||= {};
    const budget = +(process.env.JSONLD_BUDGET || src.dailyBudget);
    const due = [...byKey.keys()].sort((a, b) => (checked[a] ?? -1) - (checked[b] ?? -1)).slice(0, budget);
    const pages = [];
    for (const key of due) {
      const r = await fetchWithRetry(byKey.get(key).url, src.throttle, 'text/html').catch(() => null);
      checked[key] = dayNum(today);
      const ld = r && ldProduct(await r.text());
      if (ld) pages.push({ key, ld, ...byKey.get(key), url: ld.url || byKey.get(key).url });
    }
    const fresh = new Set(due);
    const keyOf = (url) => url.match(new RegExp(src.idPattern))?.[1];
    const carried = previousAll.filter((o) => o.src === src.id && !fresh.has(keyOf(o.url)) && byKey.has(keyOf(o.url)) &&
      dayNum(today) - dayNum(o.seen) <= src.maxAgeDays);
    const coverage = Object.keys(checked).filter((k) => byKey.has(k)).length;
    return {
      offers: [], scanned: pages.length, deferred: true,
      summary: `${due.length} pages checked today, ${coverage}/${byKey.size} checked within the cycle, ${carried.length} offers carried forward`,
      resolve: (knownBrands) => [...pages.map((p) => offerFromLd(src, p, knownBrands)).filter(Boolean), ...carried],
    };
  },

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
    if (src.brandFrom !== 'title') return { offers, scanned: n };
    return {
      offers: [], scanned: n, deferred: true,
      resolve: (knownBrands) => products.flatMap((p) => offersFromShopify(src, p, knownBrands)),
      summary: null,
    };
  },
};

const { sources } = JSON.parse(await readFile(new URL('../config/sources.json', import.meta.url)));
const only = process.argv.slice(2);
const picked = sources.filter((s) => !only.length || only.includes(s.id));

// Last run's offers (cached between CI runs) stand in for a source that fails today.
let previous = [];
let previousAll = []; // any age: JSON-LD shops filter by each offer's own `seen` date
let previousAt = '';
try {
  const prev = JSON.parse(await readFile(new URL('../build/offers.json', import.meta.url)));
  previousAll = prev.offers;
  if (Date.now() - Date.parse(prev.scrapedAt) < STALE_DAYS * 86400000) ({ offers: previous, scrapedAt: previousAt } = prev);
} catch {}
const stateFile = new URL('../build/jsonld-state.json', import.meta.url);
let jsonldState = {};
try { jsonldState = JSON.parse(await readFile(stateFile)); } catch {}
for (const src of sources) if (src.adapter === 'jsonld') src.throttle = makeThrottle(src.rps || 1);

// Crawl all sources concurrently; the shared throttle above keeps the total request rate polite.
const results = await Promise.all(picked.map(async (src) => {
  const t = Date.now();
  try {
    const r = await ADAPTERS[src.adapter](src);
    if (!r.deferred) console.log(`${src.id}: ${r.scanned} products -> ${r.offers.length} offers (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    return { src, ...r };
  } catch (e) {
    const prev = previous.filter((o) => o.src === src.id);
    console.error(`${src.id}: FAILED ${e.message}${prev.length ? ` - keeping ${prev.length} offers from ${previousAt.slice(0, 10)}` : ''}`);
    return { src, offers: prev, failed: true };
  }
}));

// Brands known from shops with a real vendor field (plus aliases), keyed by lowercase words.
const knownBrands = new Map();
for (const o of previousAll) knownBrands.set(words(o.brand), o.brand);
for (const r of results) for (const o of r.offers) knownBrands.set(words(o.brand), o.brand);
// Shops without a usable vendor field are resolved last, against every brand seen elsewhere.
for (const r of results) {
  if (!r.resolve) continue;
  r.offers = r.resolve(knownBrands);
  console.log(`${r.src.id}: ${r.scanned} products -> ${r.offers.length} offers${r.summary ? ` (${r.summary})` : ''}`);
}

const offers = results.flatMap((r) => r.offers);
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/offers.json', import.meta.url), JSON.stringify({ scrapedAt: new Date().toISOString(), offers }));
await writeFile(stateFile, JSON.stringify(jsonldState));
console.log(`total: ${offers.length} offers`);
