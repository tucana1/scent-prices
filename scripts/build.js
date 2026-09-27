// Merges scraped offers + Reddit posts, updates price history, and writes the static site data:
//   public/data/index.json   – compact search index (every perfume, one row each)
//   public/data/p/xx.json    – 256 shards with offers + history, fetched on demand
//   data/history.json        – committed; lowest price per perfume+size, one point per change

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { canonicalBrand, concentration, fragranceName, perfumeId, sizeBucket, brandKey, isNotPerfume, brandFromTitle, words, nameKey, noiseCount, typoTwin } from './lib/normalize.js';

const root = new URL('../', import.meta.url);
const readJson = async (p, fallback) => (existsSync(new URL(p, root)) ? JSON.parse(await readFile(new URL(p, root))) : fallback);

const REDDIT_MAX_AGE_DAYS = 60;
// Decant size buckets (ml, exclusive lower / inclusive upper): 1, 2, 3, 5, 10, 15-35 ml.
const SIZE_BUCKETS = [[0, 1.5], [1.5, 2.5], [2.5, 4], [4, 7], [7, 12.5], [12.5, 36]];
const today = Math.floor(Date.now() / 86400000); // days since epoch

const { sources } = await readJson('config/sources.json');
const scraped = await readJson('build/offers.json', { offers: [] });
const reddit = await readJson('data/reddit.json', { posts: [] });
const history = await readJson('data/history.json', {});
// Migrate history keys from before ids ignored spacing in names ("dior--sauvage-elixir--edp|60"
// -> "dior--sauvageelixir--edp|60"); series that now collide merge, keeping each day's lowest.
for (const key of Object.keys(history)) {
  const [id, size] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
  const parts = id.split('--');
  if (parts.length < 2 || !parts[1].includes('-')) continue;
  parts[1] = parts[1].replace(/-/g, '');
  const next = `${parts.join('--')}|${size}`;
  const merged = new Map([...(history[next] || []), ...history[key]].map(([d, p]) => [d, p]));
  for (const [d, p] of [...(history[next] || []), ...history[key]]) merged.set(d, Math.min(merged.get(d), p));
  history[next] = [...merged].sort((a, b) => a[0] - b[0]);
  delete history[key];
}

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

// Re-apply the "not a perfume" filter so filter tweaks apply without re-scraping (sets, lotions).
const all = [...scraped.offers, ...redditOffers].filter((o) => !isNotPerfume(o.name));

// MaxAroma offers stored before its brand fix all say "27 87" (the first entry of the site's brand
// menu). Its product URLs start with the house ("/christian-dior-sauvage-for-men/"), so recover the
// brand from the URL against every brand seen elsewhere; drop what can't be recovered.
const known = new Map();
for (const o of all) if (o.src !== 'maxaroma') known.set(words(o.brand), o.brand);
for (let i = all.length - 1; i >= 0; i--) {
  const o = all[i];
  if (o.src !== 'maxaroma' || brandKey(o.url.split('/')[5] || '').includes(brandKey(o.brand).slice(0, 5))) continue;
  const slugWords = (o.url.split('/')[5] || '').replace(/-/g, ' ');
  const brand = brandFromTitle(slugWords, known);
  if (!brand) { all.splice(i, 1); continue; }
  o.brand = brand;
  o.name = fragranceName(slugWords, canonicalBrand(brand), brand);
}
// Re-run brand + name cleanup so normalizer tweaks apply without re-scraping.
for (const o of all) o.brand = canonicalBrand(o.brand) || o.brand;
// Safety net: spellings of one house that still differ ("Roja Parfums" / "Roja London") merge
// under the most common spelling.
const spellings = new Map();
for (const o of all) {
  const k = brandKey(o.brand);
  if (!spellings.has(k)) spellings.set(k, new Map());
  const m = spellings.get(k);
  m.set(o.brand, (m.get(o.brand) || 0) + 1);
}
const bestSpelling = new Map([...spellings].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
for (const o of all) {
  o.brand = bestSpelling.get(brandKey(o.brand));
  o.name = fragranceName(o.name, o.brand, o.brand);
  o.id = perfumeId(o.brand, o.name, o.conc);
}

// --- Merge spellings of one fragrance within a house --------------------------------------
// Names with the same words, ignoring order, years and filler, are one fragrance; show the
// spelling most offers use. (Distinct releases like "10th Anniversary" keep their extra words.)
// Typo twins within a house fold into the far more common spelling (3x the offers or more).
const keyCounts = new Map();
for (const o of all) { const k = `${o.brand}|${nameKey(o.name)}`; keyCounts.set(k, (keyCounts.get(k) || 0) + 1); }
const keysByBrand = new Map();
for (const k of keyCounts.keys()) { const b = k.slice(0, k.indexOf('|')); if (!keysByBrand.has(b)) keysByBrand.set(b, []); keysByBrand.get(b).push(k.slice(b.length + 1)); }
const typoTarget = new Map();
for (const [b, keys] of keysByBrand) {
  const byLen = new Map();
  for (const k of keys) { const n = k.split(' ').length; if (!byLen.has(n)) byLen.set(n, []); byLen.get(n).push(k); }
  for (const group of byLen.values()) {
    if (group.length < 2 || group.length > 2000) continue;
    for (const a of group) for (const c of group) {
      if (a >= c || !typoTwin(a, c)) continue;
      const [na, nc] = [keyCounts.get(`${b}|${a}`), keyCounts.get(`${b}|${c}`)];
      if (na >= 3 * nc) typoTarget.set(`${b}|${c}`, a); else if (nc >= 3 * na) typoTarget.set(`${b}|${a}`, c);
    }
  }
}
const keyOf = (o) => { const k = `${o.brand}|${nameKey(o.name)}`; return typoTarget.has(k) ? `${o.brand}|${typoTarget.get(k)}` : k; };
if (process.env.SHOW_MERGES) console.log([...typoTarget].map(([k, v]) => `typo: ${k} -> ${v}`).join('\n'));

const nameVotes = new Map();
for (const o of all) {
  const k = keyOf(o);
  if (!nameVotes.has(k)) nameVotes.set(k, new Map());
  nameVotes.get(k).set(o.name, (nameVotes.get(k).get(o.name) || 0) + 1);
}
const mergedNames = [];
for (const o of all) {
  const votes = nameVotes.get(keyOf(o));
  // Prefer the plain spelling ("liquid brun" over "liquid brun limited edition 2024"), then the common one.
  const best = [...votes].sort((a, b) => noiseCount(a[0]) - noiseCount(b[0]) || b[1] - a[1] || a[0].length - b[0].length)[0][0];
  if (best !== o.name) {
    if (process.env.SHOW_MERGES) mergedNames.push(`${o.brand}: "${o.name}" -> "${best}"`);
    // Years merge away from the name but stay visible on this shop's price ("Absolu Aventus 2024").
    const years = (o.name.match(/\b(19|20)\d{2}\b/g) || []).filter((y) => !best.includes(y));
    if (years.length && !(o.note || '').includes(years[0])) o.note = [o.note, years.join(', ')].filter(Boolean).join(' · ');
    o.name = best;
    o.id = perfumeId(o.brand, o.name, o.conc);
  }
}
if (process.env.SHOW_MERGES) console.log([...new Set(mergedNames)].join('\n'));

// --- Fold concentration-less ids into their only concentrated sibling ----------------------
// "Dior Sauvage" with no EDT/EDP in the title is ambiguous; if only one version exists, use it.
const byBase = new Map();
for (const o of all) {
  const base = perfumeId(o.brand, o.name, '');
  if (!byBase.has(base)) byBase.set(base, new Set());
  if (o.conc) byBase.get(base).add(o.conc);
}
// With several versions, fold into one only if it clearly dominates (3x the offers of the runner-up).
const offerCount = new Map();
for (const o of all) offerCount.set(o.id, (offerCount.get(o.id) || 0) + 1);
for (const o of all) {
  if (o.conc) continue;
  const concs = [...(byBase.get(o.id) || [])];
  if (!concs.length) continue;
  const ranked = concs.map((c) => [c, offerCount.get(perfumeId(o.brand, o.name, c)) || 0]).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1 || ranked[0][1] >= 3 * ranked[1][1]) {
    o.conc = ranked[0][0];
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
  const offers = [...p.offers.values()].map(({ id: _i, brand: _b, name: _n, conc: _c, perSize: _p, ...rest }) => rest);
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
  // "Bottles from": the cheapest real bottle (30 ml+) when there is one, not a 3 ml mini.
  const fullSize = bottles.filter((o) => o.ml >= 30);
  const headline = (fullSize.length ? fullSize : bottles)[0];
  const minBottle = headline?.price || 0;
  const minBottleMl = headline?.ml || 0;
  const minDecantPerMl = decants.length ? +(decants[0].price / decants[0].ml).toFixed(2) : 0;
  // Popularity proxy: how many different shops stock it (no public "most popular" dataset exists).
  const nShops = new Set(offers.map((o) => o.src)).size;
  const nDecantShops = new Set(decants.map((o) => o.src)).size;
  // Cheapest decant price per size bucket, for the site's decant-size selector (0 = none).
  // Buckets must match SIZE_BUCKETS in public/app.js.
  const sizeMins = SIZE_BUCKETS.map(([lo, hi]) => {
    const inBucket = decants.filter((o) => o.ml > lo && o.ml <= hi).map((o) => o.price);
    return inBucket.length ? Math.min(...inBucket) : 0;
  });
  rows.push([brandIdx.get(p.brand), name, p.conc, minBottle, minBottleMl, minDecantPerMl, offers.length, nShops, nDecantShops, sizeMins]);
  shards[shardOf(id)][id] = { bottles, decants, hist };
}

// Most widely stocked first, so ties in search (and the Top 1000 page) favour popular ones.
rows.sort((a, b) => b[7] - a[7] || b[6] - a[6]);
const top = rows.slice(0, 1000);
const covered = (k) => top.filter((r) => r[8] >= k).length;
console.log(`top 1000 (by shops stocking): ${covered(1)} have decants, ${covered(3)} have 3+ decant shops, ${covered(5)} have 5+`);

const out = new URL('public/data/', root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('p/', out), { recursive: true });
// How many fragrances each shop lists, shown in the "which shops" dialog.
const perSource = new Map();
for (const [id, p] of perfumes) for (const o of p.offers.values()) {
  if (!perSource.has(o.src)) perSource.set(o.src, new Set());
  perSource.get(o.src).add(id);
}
const listed = sources.filter((s) => s.kind === 'discount' || s.vouch?.length);
const srcMeta = Object.fromEntries(listed.map((s) => [s.id, {
  name: s.name, kind: s.kind, url: s.base, n: perSource.get(s.id)?.size || 0,
  vouch: s.vouch?.map((v) => ({ url: v.url, label: v.label })),
}]));
srcMeta.reddit = { name: 'Reddit', kind: 'reddit' };
await writeFile(new URL('index.json', out), JSON.stringify({ updated: scraped.scrapedAt || new Date().toISOString(), sources: srcMeta, brands, rows }));
await Promise.all(shards.map((s, i) => writeFile(new URL(`p/${i.toString(16).padStart(2, '0')}.json`, out), JSON.stringify(s))));
// One sorted line per series: daily commits then diff (and git-compress) as a few changed lines.
const histLines = Object.keys(history).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(history[k])}`);
await writeFile(new URL('data/history.json', root), `{\n${histLines.join(',\n')}\n}\n`);

console.log(`perfumes: ${perfumes.size}, offers: ${all.length} (reddit ${redditOffers.length}), history series: ${Object.keys(history).length}`);
