// Merges scraped offers + Reddit posts, updates price history, and writes the static site data:
//   public/data/index.json   – compact search index (every perfume, one row each)
//   public/data/p/xx.json    – 256 shards with offers + history, fetched on demand
//   data/history.json        – committed; lowest price per perfume+size, one point per change

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { canonicalBrand, concentration, fragranceName, perfumeId, sizeBucket } from './lib/normalize.js';

const root = new URL('../', import.meta.url);
const readJson = async (p, fallback) => (existsSync(new URL(p, root)) ? JSON.parse(await readFile(new URL(p, root))) : fallback);

const REDDIT_MAX_AGE_DAYS = 60;
const today = Math.floor(Date.now() / 86400000); // days since epoch

const { sources } = await readJson('config/sources.json');
const scraped = await readJson('build/offers.json', { offers: [] });
const reddit = await readJson('data/reddit.json', { posts: [] });
const history = await readJson('data/history.json', {});

// --- Reddit posts become offers like any other source -------------------------------------
const redditOffers = [];
for (const post of reddit.posts) {
  const ageDays = today - Math.floor(Date.parse(post.postedAt) / 86400000);
  if (ageDays > REDDIT_MAX_AGE_DAYS) continue;
  for (const it of post.items) {
    const brand = canonicalBrand(it.brand);
    const name = fragranceName(it.name, brand, it.brand);
    if (!brand || !name || !(it.price > 0) || !(it.ml > 0)) continue;
    const conc = concentration(it.concentration || '') || concentration(it.name);
    redditOffers.push({
      id: perfumeId(brand, name, conc), brand, name, conc,
      src: 'reddit', kind: it.kind === 'bottle' ? 'bottle' : 'decant',
      ml: it.ml, price: it.price, url: post.url,
      by: post.author, sub: post.subreddit, posted: post.postedAt.slice(0, 10),
      note: it.note || undefined,
    });
  }
}

const all = [...scraped.offers, ...redditOffers];
// Re-run name cleanup so normalizer tweaks apply without re-scraping.
for (const o of all) {
  o.name = fragranceName(o.name, o.brand, o.brand);
  o.id = perfumeId(o.brand, o.name, o.conc);
}

// --- Fold concentration-less ids into their only concentrated sibling ----------------------
// "Dior Sauvage" with no EDT/EDP in the title is ambiguous; if only one version exists, use it.
const byBase = new Map();
for (const o of all) {
  const base = perfumeId(o.brand, o.name, '');
  if (!byBase.has(base)) byBase.set(base, new Set());
  if (o.conc) byBase.get(base).add(o.conc);
}
for (const o of all) {
  if (o.conc) continue;
  const concs = byBase.get(o.id);
  if (concs?.size === 1) {
    o.conc = [...concs][0];
    o.id = perfumeId(o.brand, o.name, o.conc);
  }
}

// --- Group by perfume, keep the cheapest offer per (source, kind, size, tester) ---------------
const perfumes = new Map();
for (const o of all) {
  let p = perfumes.get(o.id);
  if (!p) perfumes.set(o.id, (p = { brand: o.brand, name: o.name, conc: o.conc, offers: new Map() }));
  const k = `${o.src}|${o.kind}|${sizeBucket(o.ml)}|${o.tester ? 1 : 0}|${o.note || ''}|${o.src === 'reddit' ? o.url : ''}`;
  const prev = p.offers.get(k);
  if (!prev || o.price < prev.price) p.offers.set(k, o);
}

// --- History: append a point only when the day's lowest price changes -----------------------
function record(key, price) {
  const series = (history[key] ||= []);
  const last = series[series.length - 1];
  if (last && last[0] === today) {
    last[1] = Math.min(last[1], price);
    return;
  }
  if (!last || last[1] !== price) series.push([today, price]);
}

// Index existing series by perfume so sizes no longer in stock still show their history.
const histKeys = new Map();
for (const key of Object.keys(history)) {
  const id = key.slice(0, key.lastIndexOf('|'));
  if (!histKeys.has(id)) histKeys.set(id, []);
  histKeys.get(id).push(key);
}

// --- Write outputs ----------------------------------------------------------------------------
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const brands = [];
const brandIdx = new Map();
const rows = [];
const shards = Array.from({ length: 256 }, () => ({}));
const shardOf = (id) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) & 255;
};

for (const [id, p] of perfumes) {
  const offers = [...p.offers.values()].map(({ id: _i, brand: _b, name: _n, conc: _c, ...rest }) => rest);
  const bottles = offers.filter((o) => o.kind === 'bottle').sort((a, b) => a.price - b.price);
  const decants = offers.filter((o) => o.kind === 'decant').sort((a, b) => a.price / a.ml - b.price / b.ml);

  // Lowest non-tester bottle price per size (from shops only; Reddit prices are too sporadic to chart).
  const lowBySize = new Map();
  for (const o of bottles) {
    if (o.tester || o.src === 'reddit') continue;
    const s = sizeBucket(o.ml);
    if (!lowBySize.has(s) || o.price < lowBySize.get(s)) lowBySize.set(s, o.price);
  }
  for (const [s, price] of lowBySize) record(`${id}|${s}`, price);
  const shopDecants = decants.filter((o) => o.src !== 'reddit');
  if (shopDecants.length) record(`${id}|d`, +(shopDecants[0].price / shopDecants[0].ml).toFixed(2));

  const hist = {};
  for (const key of histKeys.get(id) || []) hist[key.slice(id.length + 1)] = history[key];
  for (const s of lowBySize.keys()) hist[s] = history[`${id}|${s}`];
  if (shopDecants.length) hist.d = history[`${id}|d`];

  if (!brandIdx.has(p.brand)) { brandIdx.set(p.brand, brands.length); brands.push(p.brand); }
  const name = titleCase(p.name);
  const minBottle = bottles.length ? bottles[0].price : 0;
  const minBottleMl = bottles.length ? bottles[0].ml : 0;
  const minDecantPerMl = decants.length ? +(decants[0].price / decants[0].ml).toFixed(2) : 0;
  rows.push([brandIdx.get(p.brand), name, p.conc, minBottle, minBottleMl, minDecantPerMl, offers.length]);
  shards[shardOf(id)][id] = { bottles, decants, hist };
}

// Most-listed perfumes first, so ties in search favour popular ones.
rows.sort((a, b) => b[6] - a[6]);

const out = new URL('public/data/', root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('p/', out), { recursive: true });
const srcMeta = Object.fromEntries(sources.map((s) => [s.id, { name: s.name, kind: s.kind, url: s.base }]));
srcMeta.reddit = { name: 'Reddit', kind: 'reddit' };
await writeFile(new URL('index.json', out), JSON.stringify({ updated: scraped.scrapedAt || new Date().toISOString(), sources: srcMeta, brands, rows }));
await Promise.all(shards.map((s, i) => writeFile(new URL(`p/${i.toString(16).padStart(2, '0')}.json`, out), JSON.stringify(s))));
// One sorted line per series: daily commits then diff (and git-compress) as a few changed lines.
const histLines = Object.keys(history).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(history[k])}`);
await writeFile(new URL('data/history.json', root), `{\n${histLines.join(',\n')}\n}\n`);

console.log(`perfumes: ${perfumes.size}, offers: ${all.length} (reddit ${redditOffers.length}), history series: ${Object.keys(history).length}`);
