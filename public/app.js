const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${n.toFixed(2)}`;
// Links come from scraped shop data and Reddit: only ever render http(s) ones.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
const ascii = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Must match scripts/lib/normalize.js, since ids are recomputed here from the index rows.
const slug = (s) => ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (s) => ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const today = () => Math.floor(Date.now() / 86400000);
const dayToDate = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
const CONC = { EDP: 'Eau de Parfum', EDT: 'Eau de Toilette', EDC: 'Eau de Cologne', Parfum: 'Parfum', Extrait: 'Extrait de Parfum' };
const ALIASES = { ysl: 'yves saint laurent', mfk: 'maison francis kurkdjian', pdm: 'parfums de marly', jpg: 'jean paul gaultier', 'd g': 'dolce gabbana', ck: 'calvin klein' };
// localStorage can be missing or throw (private windows, blocked storage): never let that break the page.
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Decant size selector. Buckets must match SIZE_BUCKETS in scripts/build.js (same order).
const SIZES = [
  { k: '1', label: '1 ml', lo: 0, hi: 1.5 },
  { k: '2', label: '2 ml', lo: 1.5, hi: 2.5 },
  { k: '3', label: '3 ml', lo: 2.5, hi: 4 },
  { k: '5', label: '5 ml', lo: 4, hi: 7 },
  { k: '10', label: '10 ml', lo: 7, hi: 12.5 },
  { k: '15', label: '15–30 ml', lo: 12.5, hi: 36 },
];
const sizeIdx = (k) => SIZES.findIndex((z) => z.k === k);
const inSize = (o, k) => { const z = SIZES[sizeIdx(k)]; return !z || (o.ml > z.lo && o.ml <= z.hi); };
let sizePref = 'any';
try { sizePref = localStorage.getItem('decantSize') || 'any'; } catch {}
if (sizePref !== 'any' && sizeIdx(sizePref) < 0) sizePref = 'any';

function renderSizeChips() {
  $('#sizes').innerHTML = `<span class="dim">Decant size</span>` +
    [{ k: 'any', label: 'Any' }, ...SIZES].map((z) => `<button class="chip${z.k === sizePref ? ' on' : ''}" data-size="${z.k}">${z.label}</button>`).join('');
}
function setSize(k) {
  sizePref = k;
  try { localStorage.setItem('decantSize', k); } catch {}
  renderSizeChips();
  renderPopularPreview();
  route();
}
// Price to show for an index row under the current size choice: [price, isPerMl] or null.
function decantHeadline(it) {
  if (sizePref === 'any') return it.minDecant ? [it.minDecant, true] : null;
  const v = it.sizeMins[sizeIdx(sizePref)];
  return v ? [v, false] : null;
}

// --- Theme: follows the system unless the visitor picks one (index.html applies it before paint) --
const THEMES = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  $('#theme').textContent = THEMES[t] || THEMES.auto;
  $('#theme').title = 'Colour theme (click to change)';
}
$('#theme').addEventListener('click', () => {
  const order = Object.keys(THEMES);
  const next = order[(order.indexOf(store.get('theme', 'auto')) + 1) % order.length];
  store.set('theme', next);
  applyTheme(next);
});
applyTheme(store.get('theme', 'auto'));

let index, items = [], byId = new Map(), groups = new Map(), brandsBySlug = new Map(), brandByWords = new Map();
const shardCache = new Map();

function shardOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) & 255).toString(16).padStart(2, '0');
}
async function perfumeData(id) {
  const sh = shardOf(id);
  if (!shardCache.has(sh)) shardCache.set(sh, fetch(`data/p/${sh}.json`).then((r) => r.json()));
  return (await shardCache.get(sh))[id];
}

async function loadIndex() {
  index = await fetch('data/index.json').then((r) => r.json());
  items = index.rows.map(([b, name, conc, minBottle, minBottleMl, minDecant, n, nShops = 0, nDecantShops = 0, sizeMins = []]) => {
    const brand = index.brands[b];
    const id = [slug(brand), slug(name).replace(/-/g, ''), conc ? conc.toLowerCase() : ''].filter(Boolean).join('--');
    return { id, brand, brandSlug: slug(brand), name, conc, minBottle, minBottleMl, minDecant, n, nShops, nDecantShops, sizeMins,
      squashed: words(`${brand} ${name}`).replace(/ /g, ''), hay: ` ${words(`${brand} ${name} ${conc} ${CONC[conc] || ''}`)} `, brandW: words(brand) };
  });
  byId = new Map(items.map((it) => [it.id, it]));
  // One fragrance can come in several concentrations (Sauvage EDT / EDP / Parfum, plus listings that
  // don't say). Search shows one row per fragrance; the page has a tab per concentration.
  groups = new Map();
  for (const it of items) {
    it.groupKey = it.id.replace(/--(edp|edt|edc|parfum|extrait)$/, '');
    if (!groups.has(it.groupKey)) groups.set(it.groupKey, []);
    groups.get(it.groupKey).push(it);
  }
  const concOrder = ['EDT', 'EDP', 'Parfum', 'Extrait', 'EDC', ''];
  for (const g of groups.values()) g.sort((a, b) => concOrder.indexOf(a.conc) - concOrder.indexOf(b.conc));
  // Brands: one entry per brand slug, listing its fragrances (one per group), most stocked first.
  brandsBySlug = new Map();
  for (const it of items) {
    let b = brandsBySlug.get(it.brandSlug);
    if (!b) brandsBySlug.set(it.brandSlug, (b = { name: it.brand, slug: it.brandSlug, list: [], keys: new Set(), nDecants: 0 }));
    if (b.keys.has(it.groupKey)) continue;
    b.keys.add(it.groupKey);
    b.list.push(it);
    if (it.minDecant) b.nDecants++;
  }
  brandByWords = new Map([...brandsBySlug.values()].map((b) => [words(b.name), b]));

  const age = Math.round((Date.now() - Date.parse(index.updated)) / 3600000);
  const shops = Object.values(index.sources);
  const nDisc = shops.filter((s) => s.kind === 'discount').length;
  const nDecant = shops.filter((s) => s.kind === 'decant' || s.kind === 'mixed').length;
  renderSizeChips();
  renderPopularPreview();
  renderSavedCount();
  $('#meta').innerHTML = `${items.length.toLocaleString()} fragrances · <button class="linkish" data-shops="decant">${nDecant} decant shops</button> · <button class="linkish" data-shops="discount">${nDisc} discounters</button> + Reddit · updated ${age < 1 ? 'just now' : `${age}h ago`}`;
}

function renderPopularPreview() {
  const seen = new Set();
  $('#popular').innerHTML = items.filter((it) => decantHeadline(it) && !seen.has(it.groupKey) && seen.add(it.groupKey))
    .slice(0, 12).map((it) => resultRow(it)).join('');
}

function expandAliases(q) {
  let qw = ' ' + words(q) + ' ';
  for (const [a, full] of Object.entries(ALIASES)) qw = qw.replace(` ${a} `, ` ${full} `);
  return qw.trim();
}

function search(q) {
  const toks = expandAliases(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const it of items) {
    let score = 0;
    let ok = true;
    for (const t of toks) {
      const i = it.hay.indexOf(' ' + t);
      if (i < 0) { ok = false; break; }
      score += it.hay.startsWith(t + ' ', i + 1) ? 3 : 1; // whole word beats prefix
    }
    // Spacing differs between shops ("Torino 21" / "Torino21"): fall back to comparing without spaces.
    if (!ok && it.squashed.includes(toks.join(''))) { ok = true; score = toks.length; }
    if (!ok) continue;
    if (toks.join(' ') === it.brandW) score -= 1; // pure brand query: keep popularity order
    // Decant comparison first: among equally good matches, ones with decants rank higher.
    out.push([score * 1000 + (decantHeadline(it) ? 500 : 0) + Math.min(it.n, 499), it]);
    if (out.length > 3000) break;
  }
  const seen = new Set();
  return out.sort((a, b) => b[0] - a[0]).map((x) => x[1])
    .filter((it) => !seen.has(it.groupKey) && seen.add(it.groupKey)).slice(0, 40);
}

// Which shops we track: opened from the counts under the search box.
function openShops(first) {
  const sections = [
    ['decant', 'Decant & sample shops', (k) => k === 'decant' || k === 'mixed'],
    ['discount', 'Full-bottle discounters', (k) => k === 'discount'],
  ];
  if (first === 'discount') sections.reverse();
  $('#shopsList').innerHTML = sections.map(([, title, test]) => {
    const list = Object.values(index.sources).filter((s) => test(s.kind)).sort((a, b) => (b.n || 0) - (a.n || 0) || a.name.localeCompare(b.name));
    return `<h2>${title} <span class="dim">(${list.length})</span></h2>
      <ul class="shops">${list.map((s) => `<li><a href="${safeUrl(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.name)}</a>${s.kind === 'mixed' ? ' <span class="tag">bottles + samples</span>' : ''}${s.vouch?.length ? ` <span class="vouch">${s.vouch.map((v) => `<a href="${safeUrl(v.url)}" target="_blank" rel="noopener nofollow" title="Independent reviews">${esc(v.label)}</a>`).join(' · ')}</span>` : ''}${s.n ? `<span class="dim">${s.n.toLocaleString()} fragrances</span>` : ''}</li>`).join('')}</ul>`;
  }).join('') + `<p class="small dim">Plus Reddit decant splits and sales that people submit. Decant shops are only listed when independent buyers vouch for them; the links next to each name are that evidence.</p>`;
  $('#shopsDlg').showModal();
}

function decantLine(it) {
  const h = decantHeadline(it);
  const label = SIZES[sizeIdx(sizePref)]?.label;
  if (!h) return `<span class="dim">${label ? `no ${label} decants` : 'no decants yet'}</span>`;
  const shops = it.nDecantShops > 1 && sizePref === 'any' ? ` <small>· ${it.nDecantShops} shops</small>` : '';
  return h[1] ? `decants from <b>${money(h[0])}/ml</b>${shops}` : `${label} from <b>${money(h[0])}</b>`;
}

// This row's concentration first, then its siblings (dimmed): "EDP · edt · parfum".
function concTags(it) {
  const sibs = (groups.get(it.groupKey) || [it]).filter((x) => x.conc && x !== it);
  const main = it.conc ? `<span class="tag">${it.conc}</span>` : '';
  return main || sibs.length ? ` ${main}${sibs.map((x) => ` <span class="tag sib">${x.conc}</span>`).join('')}` : '';
}

function resultRow(it, rank, extra = '') {
  return `
    <li><a href="#/p/${it.id}">${rank ? `<span class="rank">${rank}</span>` : ''}
      <span class="nm"><b>${esc(it.name)}</b> <span class="br">${esc(it.brand)}</span>${concTags(it)}${extra}</span>
      <span class="px">${decantLine(it)}${it.minBottle ? `<span class="dc">bottles from ${money(it.minBottle)} · ${Math.round(it.minBottleMl)} ml</span>` : ''}</span>
    </a></li>`;
}

function renderResults(list, q) {
  const el = $('#results');
  $('#empty').hidden = !!q;
  // A query that names a brand gets a link to that brand's page above the matches.
  const brand = q && brandByWords.get(expandAliases(q));
  const brandLink = brand ? `<li class="brand-hit"><a href="#/b/${brand.slug}"><span class="nm">All <b>${esc(brand.name)}</b> fragrances</span><span class="px dim">${brand.list.length.toLocaleString()} →</span></a></li>` : '';
  if (q && !list.length) { el.innerHTML = `<li class="none">No matches for “${esc(q)}”.</li>`; return; }
  el.innerHTML = brandLink + list.map((it) => resultRow(it)).join('');
}

// Pages other than search share the #detail panel.
function showPage(title, html) {
  $('#detail').hidden = false;
  $('#empty').hidden = true;
  $('#results').innerHTML = '';
  document.title = `${title} · Scent Prices`;
  $('#detail').innerHTML = `<a href="#" class="back">← Back to search</a>${html}`;
  window.scrollTo(0, 0);
}

// Top 1000: ranked by how many shops stock each fragrance (items are pre-sorted that way).
function showPopular() {
  const seen = new Set();
  const top = items.filter((it) => !seen.has(it.groupKey) && seen.add(it.groupKey)).slice(0, 1000);
  const withDecants = top.filter((it) => decantHeadline(it)).length;
  const label = SIZES[sizeIdx(sizePref)]?.label;
  showPage('Top 1000 fragrances', `
    <h1>Top 1,000 fragrances</h1>
    <p class="dim">Ranked by how many of the tracked shops stock each one, a stand-in for popularity. ${withDecants.toLocaleString()} of them have ${label ? `${label} ` : ''}decants listed right now.</p>
    <ol class="results">${top.map((it, i) => resultRow(it, i + 1)).join('')}</ol>`);
}

// --- Brands ---------------------------------------------------------------------------------------
function showBrands() {
  const all = [...brandsBySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const letter = (b) => { const c = ascii(b.name[0] || '#').toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  const byLetter = new Map();
  for (const b of all) { const l = letter(b); if (!byLetter.has(l)) byLetter.set(l, []); byLetter.get(l).push(b); }
  showPage('Brands', `
    <h1>Brands</h1>
    <p class="dim">${all.length.toLocaleString()} houses. Type to filter, or jump to a letter.</p>
    <input id="brandFilter" class="filter" type="search" placeholder="Filter brands" autocomplete="off">
    <nav class="letters">${[...byLetter.keys()].map((l) => `<a href="#letter-${l}" data-letter="${l}">${l}</a>`).join('')}</nav>
    <div id="brandList">${[...byLetter].map(([l, list]) => `
      <section class="letter-group" id="letter-${l}"><h2>${l}</h2>
        <ul class="brand-grid">${list.map((b) => `<li data-w="${esc(words(b.name))}"><a href="#/b/${b.slug}">${esc(b.name)}</a> <small>${b.list.length}</small></li>`).join('')}</ul>
      </section>`).join('')}</div>`);
  $('#brandFilter').addEventListener('input', (e) => {
    const q = words(e.target.value);
    for (const li of document.querySelectorAll('#brandList li')) li.hidden = !!q && !li.dataset.w.includes(q);
    for (const sec of document.querySelectorAll('.letter-group')) sec.hidden = !sec.querySelector('li:not([hidden])');
  });
}

function showBrand(s) {
  const b = brandsBySlug.get(s);
  if (!b) { showPage('Not found', '<p>Brand not found.</p>'); return; }
  const withD = b.list.filter((it) => decantHeadline(it));
  const label = SIZES[sizeIdx(sizePref)]?.label;
  showPage(b.name, `
    <h1>${esc(b.name)}</h1>
    <p class="dim">${b.list.length.toLocaleString()} fragrance${b.list.length === 1 ? '' : 's'} tracked, ${withD.length.toLocaleString()} with ${label ? `${label} ` : ''}decants. Most widely stocked first. <a href="#/brands" class="linkish">All brands</a></p>
    <ol class="results">${b.list.map((it) => resultRow(it)).join('')}</ol>`);
}

// --- Deals (built daily by scripts/build.js from each listing's 30-day price history) --------------
let dealsP;
let dealKind = store.get('dealKind', 'decant');
async function showDeals() {
  showPage('Deals', '<h1>Deals</h1><p class="loading">Loading deals…</p>');
  dealsP ||= fetch('data/deals.json').then((r) => (r.ok ? r.json() : { deals: [] })).catch(() => ({ deals: [] }));
  const { deals } = await dealsP;
  if (location.hash !== '#/deals') return;
  const known = deals.filter((d) => byId.has(d.id) && index.sources[d.src]);
  const counts = { decant: 0, bottle: 0 };
  for (const d of known) counts[d.kind]++;
  const list = known.filter((d) => d.kind === dealKind);
  const row = (d) => {
    const it = byId.get(d.id);
    const pct = Math.round((1 - d.now / d.was) * 100);
    return `<li class="deal">
      <a href="#/p/${it.id}" class="nm"><b>${esc(it.name)}</b> <span class="br">${esc(it.brand)}</span>${it.conc ? ` <span class="tag">${it.conc}</span>` : ''}
        <span class="sub">${esc(index.sources[d.src].name)} · ${d.ml} ml${d.kind === 'decant' ? ` · ${money(d.now / d.ml)}/ml` : ''}</span></a>
      <span class="px"><s class="dim">${money(d.was)}</s> <b>${money(d.now)}</b> <span class="off">−${pct}%</span></span>
      <a class="go" href="${safeUrl(d.url)}" target="_blank" rel="noopener nofollow">View →</a>
    </li>`;
  };
  $('#detail').innerHTML = `<a href="#" class="back">← Back to search</a>
    <h1>Deals</h1>
    <p class="dim">Listings priced at least 10% below their own highest price in the last 30 days, checked daily. Same shop, same size, so it's a real price cut, not a new listing.</p>
    <div class="sizes inline">${['decant', 'bottle'].map((k) => `<button class="chip${k === dealKind ? ' on' : ''}" data-deal-kind="${k}">${k === 'decant' ? 'Decants' : 'Full bottles'} (${counts[k]})</button>`).join('')}</div>
    ${list.length ? `<ul class="deals">${list.map(row).join('')}</ul>` : `<p class="dim">No ${dealKind === 'decant' ? 'decant' : 'bottle'} price cuts right now. Prices are compared day to day, so check back tomorrow.</p>`}`;
}

// --- Saved fragrances + order planner (all in this browser's localStorage) -------------------------
const getSaved = () => store.get('saved', []).filter((s) => s && typeof s.id === 'string');
const isSaved = (id) => getSaved().some((s) => s.id === id);
function toggleSaved(id) {
  const saved = getSaved();
  const i = saved.findIndex((s) => s.id === id);
  if (i >= 0) saved.splice(i, 1);
  else {
    const it = byId.get(id);
    saved.unshift({ id, day: today(), d: it?.minDecant || 0, b: it?.minBottle || 0 });
  }
  store.set('saved', saved);
  renderSavedCount();
  return i < 0;
}
function renderSavedCount() {
  const n = getSaved().length;
  $('#savedN').textContent = n ? String(n) : '';
}

// Change since saving, e.g. "↓ $0.40/ml since you saved it".
function sinceSaved(s, it) {
  const bits = [];
  if (s.d && it.minDecant && Math.abs(it.minDecant - s.d) >= 0.01) {
    const down = it.minDecant < s.d;
    bits.push(`<span class="${down ? 'down' : 'up'}">${down ? '↓' : '↑'} ${money(Math.abs(it.minDecant - s.d))}/ml</span>`);
  }
  if (s.b && it.minBottle && Math.abs(it.minBottle - s.b) >= 0.5) {
    const down = it.minBottle < s.b;
    bits.push(`<span class="${down ? 'down' : 'up'}">bottle ${down ? '↓' : '↑'} ${money(Math.abs(it.minBottle - s.b))}</span>`);
  }
  return bits.length ? ` <span class="since">${bits.join(' · ')} since saved</span>` : '';
}

const storedPlan = store.get('plan', {}) || {};
let plan = {
  size: SIZES.some((z) => z.k === storedPlan.size && z.k !== '15') ? storedPlan.size : '5',
  ship: Number.isFinite(storedPlan.ship) && storedPlan.ship >= 0 ? storedPlan.ship : 6,
  skip: Array.isArray(storedPlan.skip) ? storedPlan.skip.filter((x) => typeof x === 'string') : [],
};
function showSaved() {
  const saved = getSaved();
  const live = saved.filter((s) => byId.has(s.id));
  const gone = saved.filter((s) => !byId.has(s.id));
  const planSizes = SIZES.filter((z) => z.k !== '15');
  showPage('Saved', `
    <h1>Saved</h1>
    <p class="dim">Fragrances you've saved, with how their lowest prices moved since. Stored only in this browser.</p>
    ${live.length ? `<ol class="results saved">${live.map((s) => resultRow(byId.get(s.id), 0, sinceSaved(s, byId.get(s.id)))).join('')}</ol>` : '<p>Nothing saved yet. Open a fragrance and press <b>☆ Save</b>.</p>'}
    ${gone.length ? `<p class="dim small">${gone.length} saved fragrance${gone.length === 1 ? ' is' : 's are'} no longer listed anywhere. <button class="linkish" data-clear-gone>Remove</button></p>` : ''}
    ${live.length ? `
      <h2 class="sec" id="plan">Plan an order</h2>
      <p class="dim">Finds the cheapest way to get a decant of each one, counting a shipping cost per shop, so it won't split your order across five shops to save a dollar. Reddit sellers aren't included.</p>
      <div class="plan-form">
        <label>Size <select id="planSize">${planSizes.map((z) => `<option value="${z.k}"${z.k === plan.size ? ' selected' : ''}>${z.label}</option>`).join('')}</select></label>
        <label>Shipping per shop $<input id="planShip" type="number" min="0" step="0.5" value="${plan.ship}"></label>
      </div>
      <ul class="plan-pick">${live.map((s) => { const it = byId.get(s.id); return `<li><label><input type="checkbox" data-plan-id="${it.id}"${plan.skip.includes(it.id) ? '' : ' checked'}> ${esc(it.name)} <span class="br">${esc(it.brand)}</span>${it.conc ? ` <span class="tag">${it.conc}</span>` : ''}</label></li>`; }).join('')}</ul>
      <div id="planOut"><p class="loading">Working it out…</p></div>` : ''}`);
  if (live.length) runPlan();
}

// Choose shops to minimise (sum of each fragrance's cheapest price among chosen shops) + shipping
// per shop. Exact search over shop sets of up to 4 shops, then a greedy fallback for bigger orders.
function bestShops(need, shipping) {
  const shops = [...new Set(need.flatMap((n) => [...n.prices.keys()]))];
  const costOf = (set) => {
    let total = set.length * shipping;
    for (const n of need) {
      let m = Infinity;
      for (const s of set) { const p = n.prices.get(s); if (p != null && p.price < m) m = p.price; }
      if (m === Infinity) return Infinity;
      total += m;
    }
    return total;
  };
  let best = null, bestCost = Infinity;
  const maxK = shops.length > 30 ? 3 : 4;
  const pick = (start, set) => {
    if (set.length) { const c = costOf(set); if (c < bestCost) { bestCost = c; best = set.slice(); } }
    if (set.length === maxK) return;
    for (let i = start; i < shops.length; i++) { set.push(shops[i]); pick(i + 1, set); set.pop(); }
  };
  if (shops.length <= 40) pick(0, []);
  if (!best) {
    // Greedy: keep adding the shop that lowers the total most (uncovered items count as very expensive).
    best = [];
    const penal = (set) => set.length * shipping + need.reduce((t, n) => t + Math.min(...set.map((s) => n.prices.get(s)?.price ?? 1e6), 1e6), 0);
    for (;;) {
      let add = null, addCost = penal(best);
      for (const s of shops) if (!best.includes(s)) { const c = penal([...best, s]); if (c < addCost) { addCost = c; add = s; } }
      if (!add) break;
      best.push(add);
    }
    bestCost = costOf(best);
  }
  return { set: best, cost: bestCost };
}

async function runPlan() {
  const out = $('#planOut');
  const ids = getSaved().map((s) => s.id).filter((id) => byId.has(id) && !plan.skip.includes(id));
  if (!ids.length) { out.innerHTML = '<p class="dim">Tick at least one fragrance.</p>'; return; }
  const data = await Promise.all(ids.map((id) => perfumeData(id)));
  if (!document.body.contains(out)) return;
  const need = [], missing = [];
  ids.forEach((id, i) => {
    const prices = new Map(); // shop -> cheapest offer at this size
    for (const o of data[i]?.decants || []) {
      if (o.src === 'reddit' || !inSize(o, plan.size) || !index.sources[o.src]) continue;
      if (!prices.has(o.src) || o.price < prices.get(o.src).price) prices.set(o.src, o);
    }
    (prices.size ? need : missing).push({ it: byId.get(id), prices });
  });
  const label = SIZES[sizeIdx(plan.size)].label;
  const missNote = missing.length ? `<p class="dim small">No ${label} decant at any tracked shop for: ${missing.map((m) => esc(m.it.name)).join(', ')}.</p>` : '';
  if (!need.length) { out.innerHTML = missNote; return; }
  const { set, cost } = bestShops(need, plan.ship);
  // Assign each fragrance to its cheapest shop within the chosen set.
  const byShop = new Map(set.map((s) => [s, []]));
  for (const n of need) {
    let bestS = null;
    for (const s of set) { const p = n.prices.get(s); if (p && (!bestS || p.price < n.prices.get(bestS).price)) bestS = s; }
    byShop.get(bestS).push({ it: n.it, o: n.prices.get(bestS) });
  }
  // For comparison: every fragrance from its own cheapest shop.
  const naiveShops = new Set(), naive = need.reduce((t, n) => {
    const [s, o] = [...n.prices].sort((a, b) => a[1].price - b[1].price)[0];
    naiveShops.add(s);
    return t + o.price;
  }, 0);
  const naiveTotal = naive + naiveShops.size * plan.ship;
  const used = [...byShop].filter(([, l]) => l.length);
  out.innerHTML = `
    <div class="plan-total"><span>${need.length} × ${label} from ${used.length} shop${used.length === 1 ? '' : 's'}</span><b>${money(cost)}</b></div>
    <p class="dim small">Includes ${money(plan.ship)} estimated shipping per shop.${naiveShops.size > used.length ? ` Buying each at its own cheapest shop would take ${naiveShops.size} orders and cost about ${money(naiveTotal)}.` : ''}</p>
    ${used.map(([s, l]) => `<div class="size"><div class="size-h"><h3>${esc(index.sources[s].name)}</h3><span class="dim">${money(l.reduce((t, x) => t + x.o.price, 0))} + shipping</span></div>
      <table><tbody>${l.map(({ it, o }) => `<tr><td><a href="#/p/${it.id}">${esc(it.name)}</a> <span class="br">${esc(it.brand)}</span></td><td class="num">${o.ml} ml</td><td class="num">${money(o.price)}</td><td class="go"><a href="${safeUrl(o.url)}" target="_blank" rel="noopener nofollow">View →</a></td></tr>`).join('')}</tbody></table></div>`).join('')}
    ${missNote}`;
}

function sparkline(series, w = 140, h = 32) {
  if (!series || series.length < 2) return '';
  const pts = [...series, [today(), series[series.length - 1][1]]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (x) => ((x - x0) / (x1 - x0 || 1)) * (w - 4) + 2;
  const Y = (y) => h - 3 - ((y - y0) / (y1 - y0 || 1)) * (h - 6);
  let d = '';
  pts.forEach(([x, y], i) => { d += i ? `H${X(x).toFixed(1)}V${Y(y).toFixed(1)}` : `M${X(x).toFixed(1)} ${Y(y).toFixed(1)}`; });
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}

function lowest(series) {
  if (!series?.length) return null;
  return series.reduce((m, p) => (p[1] < m[1] ? p : m));
}

function sourceCell(o) {
  const s = index.sources[o.src] || { name: o.src };
  if (o.src === 'reddit') {
    return `<span class="src reddit">Reddit</span> <span class="sub">r/${esc(o.sub)} · u/${esc(o.by)} · ${esc(o.posted)}</span>${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}`;
  }
  // Rotating-crawl shops (MaxAroma) carry prices forward; say how old they are.
  const age = o.seen ? Math.floor((Date.now() - Date.parse(o.seen)) / 86400000) : 0;
  return `<span class="src">${esc(s.name)}</span>${o.tester ? ' <span class="tag warn">tester</span>' : ''}${o.note ? ` <span class="tag">${esc(o.note)}</span>` : ''}${age > 2 ? ` <span class="sub">price as of ${esc(o.seen)}</span>` : ''}`;
}

async function showPerfume(id) {
  const it = byId.get(id);
  const det = $('#detail');
  $('#results').innerHTML = '';
  $('#empty').hidden = true;
  det.hidden = false;
  if (!it) { det.innerHTML = '<a href="#" class="back">← Back to search</a><p>Not found. It may have been merged with another listing; try searching for it.</p>'; return; }
  document.title = `${it.brand} ${it.name} · Scent Prices`;
  det.innerHTML = `<p class="loading">Loading prices…</p>`;

  const p = await perfumeData(id);
  if (location.hash !== `#/p/${id}` && location.hash !== `#/p/${encodeURIComponent(id)}`) return;
  if (!p) { det.innerHTML = '<p>Not found.</p>'; return; }

  // Full bottles grouped by size, largest first; cheapest in each group highlighted.
  const bySize = new Map();
  for (const o of p.bottles) {
    const k = Math.round(o.ml);
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k).push(o);
  }
  const sizes = [...bySize.keys()].sort((a, b) => b - a);
  const bottleHtml = sizes.map((ml) => {
    const list = bySize.get(ml).sort((a, b) => a.price - b.price);
    const hist = p.hist[ml];
    const lo = lowest(hist);
    return `
      <div class="size">
        <div class="size-h">
          <h3>${ml} ml <span class="oz">${(ml / 29.5735).toFixed(1)} oz</span></h3>
          ${lo ? `<div class="hist">${sparkline(hist)}<span>lowest tracked <b>${money(lo[1])}</b> <small>${dayToDate(lo[0])}</small></span></div>` : ''}
        </div>
        <table><tbody>${list.map((o, i) => `
          <tr class="${i === 0 ? 'best' : ''}">
            <td>${sourceCell(o)}</td>
            <td class="num">${money(o.price)}</td>
            <td class="num dim">${money(o.price / o.ml)}/ml</td>
            <td class="go"><a href="${safeUrl(o.url)}" target="_blank" rel="noopener nofollow">View →</a></td>
          </tr>`).join('')}</tbody></table>
      </div>`;
  }).join('');

  const dLo = lowest(p.hist.d);
  // Decants for the chosen size, cheapest first; "Any" ranks by price per ml.
  const label = SIZES[sizeIdx(sizePref)]?.label;
  const shown = sizePref === 'any' ? p.decants : p.decants.filter((o) => inSize(o, sizePref)).sort((a, b) => a.price - b.price);
  const counts = SIZES.map((z) => p.decants.filter((o) => inSize(o, z.k)).length);
  const chips = `<div class="sizes inline">${[{ k: 'any', label: `Any (${p.decants.length})`, n: p.decants.length },
    ...SIZES.map((z, i) => ({ k: z.k, label: `${z.label} (${counts[i]})`, n: counts[i] }))]
    .map((z) => `<button class="chip${z.k === sizePref ? ' on' : ''}" data-size="${z.k}"${z.n ? '' : ' disabled'}>${z.label}</button>`).join('')}</div>`;
  const rows = shown.map((o, i) => `
      <tr class="${i === 0 ? 'best' : ''}">
        <td>${sourceCell(o)}</td>
        <td class="num">${o.ml} ml</td>
        <td class="num">${money(o.price)}</td>
        <td class="num dim">${money(o.price / o.ml)}/ml</td>
        <td class="go"><a href="${safeUrl(o.url)}" target="_blank" rel="noopener nofollow">View →</a></td>
      </tr>`).join('');
  const decantHtml = p.decants.length ? `
    <h2 class="sec" id="decants">Decants <span class="dim">${sizePref === 'any' ? 'all sizes, sorted by price per ml' : `${label}, sorted by price`}</span></h2>
    ${chips}
    ${dLo && sizePref === 'any' ? `<p class="hist">${sparkline(p.hist.d)}<span>lowest tracked shop decant <b>${money(dLo[1])}/ml</b> <small>${dayToDate(dLo[0])}</small></span></p>` : ''}
    ${shown.length ? `<table><tbody>${rows}</tbody></table>` : `<p class="dim">No ${label} decants for this one. <button class="linkish" data-size="any">Show all sizes</button></p>`}
    <p class="dim reddit-inline">Seen it cheaper on Reddit? <button class="linkish" data-reddit>Add the post</button></p>` : `<p class="dim sec">No decants found yet. Know a Reddit split? <button class="linkish" data-reddit>Add the post</button></p>`;
  const best = shown[0];

  det.innerHTML = `
    <a href="#" class="back">← Back to search</a>
    <div class="title-row">
      <h1>${esc(it.name)} <a class="br" href="#/b/${it.brandSlug}">${esc(it.brand)}</a></h1>
      <div class="actions">
        <button class="act${isSaved(id) ? ' on' : ''}" data-save="${esc(id)}">${isSaved(id) ? '★ Saved' : '☆ Save'}</button>
        <button class="act" data-share>Share</button>
      </div>
    </div>
    ${concTabs(it)}
    ${best ? `<a href="#decants" class="decant-summary" data-jump>
      <span>Cheapest ${label ? `${label} ` : ''}decant ${label ? `<b>${money(best.price)}</b>` : `<b>${money(best.price / best.ml)}/ml</b>`} at ${esc(index.sources[best.src]?.name || best.src)} (${best.ml} ml for ${money(best.price)})</span>
      <span class="dim">${new Set(shown.map((o) => o.src)).size} decant shops ↓</span></a>` : ''}
    <h2 class="sec">Full bottles</h2>
    ${bottleHtml || '<p class="dim">No full bottles in stock at tracked shops right now.</p>'}
    ${decantHtml}
    ${[...p.bottles, ...p.decants].some((o) => o.src === 'reddit') ? '<p class="dim small">Reddit sellers are individuals, not shops. Check their swap history and pay with PayPal Goods &amp; Services, never Friends &amp; Family, gift cards or crypto.</p>' : ''}`;
}

function concTabs(it) {
  const g = groups.get(it.groupKey) || [it];
  if (g.length < 2) return `<p class="dim">${CONC[it.conc] || 'Concentration not specified'}</p>`;
  return `<div class="conc-tabs">${g.map((x) => `<a href="#/p/${x.id}" class="chip${x === it ? ' on' : ''}">${CONC[x.conc] || 'Not specified'} <small>${x.nShops} shop${x.nShops === 1 ? '' : 's'}</small></a>`).join('')}</div>
    ${it.conc ? '' : '<p class="dim small">These shops don\'t say which concentration they sell.</p>'}`;
}

async function share(btn) {
  const url = location.href;
  try {
    if (navigator.share) { await navigator.share({ title: document.title, url }); return; }
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
  } catch (e) {
    if (e?.name === 'AbortError') return;
    btn.textContent = 'Copy the address bar';
  }
  setTimeout(() => { btn.textContent = 'Share'; }, 2000);
}

function openRedditDialog() {
  $('#redditForm').reset();
  $('#redditDlg').showModal();
}

$('#redditForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const body = `### Reddit post URL\n\n${f.get('url')}\n\n### Price list text (optional)\n\n${f.get('text') || '_No response_'}`;
  const u = `https://github.com/${window.SITE_CONFIG.repo}/issues/new?labels=reddit&title=${encodeURIComponent('Reddit prices: ' + f.get('url'))}&body=${encodeURIComponent(body)}`;
  window.open(u, '_blank', 'noopener');
});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-reddit]')) openRedditDialog();
  const size = t.closest('[data-size]');
  if (size && !size.disabled) setSize(size.dataset.size);
  const shops = t.closest('[data-shops]');
  if (shops) openShops(shops.dataset.shops);
  if (t.closest('[data-jump]')) { e.preventDefault(); $('#decants')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  const save = t.closest('[data-save]');
  if (save) {
    const on = toggleSaved(save.dataset.save);
    save.classList.toggle('on', on);
    save.textContent = on ? '★ Saved' : '☆ Save';
  }
  const shareBtn = t.closest('[data-share]');
  if (shareBtn) share(shareBtn);
  const kind = t.closest('[data-deal-kind]');
  if (kind) { dealKind = kind.dataset.dealKind; store.set('dealKind', dealKind); showDeals(); }
  const letter = t.closest('[data-letter]');
  if (letter) { e.preventDefault(); document.getElementById(`letter-${letter.dataset.letter}`)?.scrollIntoView({ block: 'start' }); }
  if (t.closest('[data-clear-gone]')) { store.set('saved', getSaved().filter((s) => byId.has(s.id))); renderSavedCount(); showSaved(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'planSize') plan.size = t.value;
  else if (t.id === 'planShip') plan.ship = Math.max(0, +t.value || 0);
  else if (t.dataset.planId) plan.skip = t.checked ? plan.skip.filter((x) => x !== t.dataset.planId) : [...plan.skip, t.dataset.planId];
  else return;
  store.set('plan', plan);
  runPlan();
});

// Keyboard: "/" jumps to search, arrow keys move through results, Escape clears the search.
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    $('#q').focus();
    $('#q').select();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = [...document.querySelectorAll('main .results a')].filter((a) => a.offsetParent);
  if (!links.length) return;
  const i = links.indexOf(document.activeElement);
  if (document.activeElement === $('#q')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); links[0].focus(); }
    return;
  }
  if (i < 0) return;
  e.preventDefault();
  if (e.key === 'ArrowDown') links[Math.min(i + 1, links.length - 1)].focus();
  else if (i === 0) $('#q').focus();
  else links[i - 1].focus();
});
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#q').value) { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); }
});

let lastQ = '';
function route() {
  const h = location.hash;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', h === a.getAttribute('href') || (h.startsWith('#/b/') && a.getAttribute('href') === '#/brands')));
  if (h === '#/popular') return showPopular();
  if (h === '#/deals') return showDeals();
  if (h === '#/brands') return showBrands();
  if (h === '#/saved') return showSaved();
  const b = h.match(/^#\/b\/(.+)$/);
  if (b) return showBrand(decodeURIComponent(b[1]));
  const m = h.match(/^#\/p\/(.+)$/);
  if (m) return showPerfume(decodeURIComponent(m[1]));
  $('#detail').hidden = true;
  document.title = 'Scent Prices · Decant Price Comparison';
  const q = $('#q').value.trim();
  renderResults(search(q), q);
}

$('#q').addEventListener('input', () => {
  lastQ = $('#q').value.trim();
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.pathname);
  document.querySelectorAll('.nav a.on').forEach((a) => a.classList.remove('on'));
  $('#detail').hidden = true;
  renderResults(search(lastQ), lastQ);
});
window.addEventListener('hashchange', route);
// Other tabs saving or unsaving fragrances.
window.addEventListener('storage', (e) => { if (e.key === 'saved') { renderSavedCount(); if (location.hash === '#/saved') showSaved(); } });

loadIndex().then(route).catch(() => { $('#meta').textContent = 'Could not load price index.'; });
