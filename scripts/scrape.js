// Pulls every in-stock fragrance variant from each source in config/sources.json
// and writes a flat offer list to build/offers.json. No dependencies (Node 20+).
//
//   node scripts/scrape.js               # all sources
//   node scripts/scrape.js decantx aura  # just these
//   MAX_PAGES=2 node scripts/scrape.js   # quick smoke test

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  canonicalBrand, concentration, sizeMl, isTester, isNotPerfume, fragranceName, perfumeId,
} from './lib/normalize.js';

const UA = 'PerfumePriceIndex/1.0 (+non-commercial price comparison; polite crawler, 1 req/1.5s)';
const DELAY_MS = 1500;
const MAX_PAGES = +(process.env.MAX_PAGES || 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(DELAY_MS * 4 * i);
    }
  }
}

async function* shopifyProducts(base) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await getJson(`${base}/products.json?limit=250&page=${page}`);
    const products = j?.products || [];
    if (!products.length) return;
    yield* products;
    await sleep(DELAY_MS);
  }
}

function offersFromShopify(src, p) {
  const out = [];
  const productText = `${p.title} ${p.product_type || ''}`;
  if (isNotPerfume(productText)) return out;
  const brand = canonicalBrand(p.vendor);
  if (!brand) return out;
  const name = fragranceName(p.title, brand, p.vendor);
  if (!name) return out;

  for (const v of p.variants || []) {
    if (!v.available) continue;
    const vt = v.title === 'Default Title' ? '' : v.title;
    const all = `${productText} ${vt}`;
    if (isNotPerfume(vt)) continue;
    const ml = sizeMl(vt) ?? sizeMl(p.title);
    const price = +v.price;
    if (!ml || !(price > 0)) continue;
    // Decant shops: anything in the original bottle is a full bottle, the rest is a decant.
    const inOriginalBottle = /manufacturer|original bottle|full bottle/i.test(vt);
    const kind = src.kind === 'decant' && !inOriginalBottle && ml <= 35 ? 'decant' : 'bottle';
    out.push({
      id: perfumeId(brand, name, concentration(all)),
      brand, name, conc: concentration(all),
      src: src.id, kind, ml, price,
      tester: isTester(all) || undefined,
      url: `${src.base}/products/${p.handle}${vt ? `?variant=${v.id}` : ''}`,
    });
  }
  return out;
}

const ADAPTERS = {
  async shopify(src) {
    const offers = [];
    let n = 0;
    for await (const p of shopifyProducts(src.base)) {
      n++;
      offers.push(...offersFromShopify(src, p));
    }
    return { offers, scanned: n };
  },
};

const { sources } = JSON.parse(await readFile(new URL('../config/sources.json', import.meta.url)));
const only = process.argv.slice(2);
const picked = sources.filter((s) => !only.length || only.includes(s.id));

// Sources are different hosts, so crawl them in parallel; each one is throttled on its own.
const results = await Promise.all(picked.map(async (src) => {
  const t = Date.now();
  try {
    const { offers, scanned } = await ADAPTERS[src.adapter](src);
    console.log(`${src.id}: ${scanned} products -> ${offers.length} offers (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    return offers;
  } catch (e) {
    console.error(`${src.id}: FAILED ${e.message}`);
    return [];
  }
}));

const offers = results.flat();
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/offers.json', import.meta.url), JSON.stringify({ scrapedAt: new Date().toISOString(), offers }));
console.log(`total: ${offers.length} offers`);
