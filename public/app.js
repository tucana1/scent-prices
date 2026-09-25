const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${n.toFixed(2)}`;
const ascii = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Must match scripts/lib/normalize.js, since ids are recomputed here from the index rows.
const slug = (s) => ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (s) => ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const dayToDate = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
const CONC = { EDP: 'Eau de Parfum', EDT: 'Eau de Toilette', EDC: 'Eau de Cologne', Parfum: 'Parfum', Extrait: 'Extrait de Parfum' };
const ALIASES = { ysl: 'yves saint laurent', mfk: 'maison francis kurkdjian', pdm: 'parfums de marly', jpg: 'jean paul gaultier', 'd g': 'dolce gabbana', ck: 'calvin klein' };

let index, items = [];
const shardCache = new Map();

function shardOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) & 255).toString(16).padStart(2, '0');
}

async function loadIndex() {
  index = await fetch('data/index.json').then((r) => r.json());
  items = index.rows.map(([b, name, conc, minBottle, minBottleMl, minDecant, n, nShops = 0, nDecantShops = 0]) => {
    const brand = index.brands[b];
    const id = [slug(brand), slug(name), conc ? conc.toLowerCase() : ''].filter(Boolean).join('--');
    return { id, brand, name, conc, minBottle, minBottleMl, minDecant, n, nShops, nDecantShops, hay: ` ${words(`${brand} ${name} ${conc} ${CONC[conc] || ''}`)} `, brandW: words(brand) };
  });
  const age = Math.round((Date.now() - Date.parse(index.updated)) / 3600000);
  const shops = Object.values(index.sources);
  const nDisc = shops.filter((s) => s.kind === 'discount').length;
  const nDecant = shops.filter((s) => s.kind === 'decant' || s.kind === 'mixed').length;
  const pop = items.filter((it) => it.minDecant).slice(0, 12);
  $('#popular').innerHTML = pop.map((it) => resultRow(it)).join('');
  $('#meta').innerHTML = `${items.length.toLocaleString()} fragrances · <button class="linkish" data-shops="decant">${nDecant} decant shops</button> · <button class="linkish" data-shops="discount">${nDisc} discounters</button> + Reddit · updated ${age < 1 ? 'just now' : `${age}h ago`}`;
}

function search(q) {
  let qw = ' ' + words(q) + ' ';
  for (const [a, full] of Object.entries(ALIASES)) qw = qw.replace(` ${a} `, ` ${full} `);
  const toks = qw.trim().split(' ').filter(Boolean);
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
    if (!ok) continue;
    if (toks.join(' ') === it.brandW) score -= 1; // pure brand query: keep popularity order
    // Decant comparison first: among equally good matches, ones with decants rank higher.
    out.push([score * 1000 + (it.minDecant ? 500 : 0) + Math.min(it.n, 499), it]);
    if (out.length > 3000) break;
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
}

// Which shops we track: opened from the counts under the search box.
function openShops(first) {
  const groups = [
    ['decant', 'Decant & sample shops', (k) => k === 'decant' || k === 'mixed'],
    ['discount', 'Full-bottle discounters', (k) => k === 'discount'],
  ];
  if (first === 'discount') groups.reverse();
  $('#shopsList').innerHTML = groups.map(([, title, test]) => {
    const list = Object.values(index.sources).filter((s) => test(s.kind)).sort((a, b) => (b.n || 0) - (a.n || 0) || a.name.localeCompare(b.name));
    return `<h2>${title} <span class="dim">(${list.length})</span></h2>
      <ul class="shops">${list.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.name)}</a>${s.kind === 'mixed' ? ' <span class="tag">bottles + samples</span>' : ''}${s.n ? `<span class="dim">${s.n.toLocaleString()} fragrances</span>` : ''}</li>`).join('')}</ul>`;
  }).join('') + `<p class="small dim">Plus Reddit decant splits and sales that people submit. Shops are added when they publish a public product feed, so there's no scraping around bot protection.</p>`;
  $('#shopsDlg').showModal();
}

function resultRow(it, rank) {
  return `
    <li><a href="#/p/${it.id}">${rank ? `<span class="rank">${rank}</span>` : ''}
      <span class="nm"><b>${esc(it.name)}</b> <span class="br">${esc(it.brand)}</span>${it.conc ? ` <span class="tag">${it.conc}</span>` : ''}</span>
      <span class="px">${it.minDecant ? `decants from <b>${money(it.minDecant)}/ml</b>${it.nDecantShops > 1 ? ` <small>· ${it.nDecantShops} shops</small>` : ''}` : '<span class="dim">no decants yet</span>'}${it.minBottle ? `<span class="dc">bottles from ${money(it.minBottle)} · ${Math.round(it.minBottleMl)} ml</span>` : ''}</span>
    </a></li>`;
}

function renderResults(list, q) {
  const el = $('#results');
  $('#empty').hidden = !!q;
  if (q && !list.length) { el.innerHTML = `<li class="none">No matches for “${esc(q)}”.</li>`; return; }
  el.innerHTML = list.map((it) => resultRow(it)).join('');
}

// Top 1000: ranked by how many shops stock each fragrance (items are pre-sorted that way).
function showPopular() {
  $('#detail').hidden = false;
  $('#empty').hidden = true;
  $('#results').innerHTML = '';
  document.title = 'Top 1000 fragrances · Scent Prices';
  const top = items.slice(0, 1000);
  const withDecants = top.filter((it) => it.minDecant).length;
  $('#detail').innerHTML = `
    <a href="#" class="back">← Back to search</a>
    <h1>Top 1,000 fragrances</h1>
    <p class="dim">Ranked by how many of the tracked shops stock each one, a stand-in for popularity. ${withDecants.toLocaleString()} of them have decants listed right now.</p>
    <ol class="results">${top.map((it, i) => resultRow(it, i + 1)).join('')}</ol>`;
  window.scrollTo(0, 0);
}

function sparkline(series, w = 140, h = 32) {
  if (!series || series.length < 2) return '';
  const pts = [...series, [Math.floor(Date.now() / 86400000), series[series.length - 1][1]]];
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
  const it = items.find((x) => x.id === id);
  const det = $('#detail');
  $('#results').innerHTML = '';
  $('#empty').hidden = true;
  det.hidden = false;
  if (!it) { det.innerHTML = '<p>Not found.</p>'; return; }
  document.title = `${it.brand} ${it.name} · Scent Prices`;
  det.innerHTML = `<p class="loading">Loading prices…</p>`;

  const sh = shardOf(id);
  if (!shardCache.has(sh)) shardCache.set(sh, fetch(`data/p/${sh}.json`).then((r) => r.json()));
  const p = (await shardCache.get(sh))[id];
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
            <td class="go"><a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">View →</a></td>
          </tr>`).join('')}</tbody></table>
      </div>`;
  }).join('');

  const dLo = lowest(p.hist.d);
  const decantHtml = p.decants.length ? `
    <h2 class="sec" id="decants">Decants <span class="dim">sorted by price per ml</span></h2>
    ${dLo ? `<p class="hist">${sparkline(p.hist.d)}<span>lowest tracked shop decant <b>${money(dLo[1])}/ml</b> <small>${dayToDate(dLo[0])}</small></span></p>` : ''}
    <table><tbody>${p.decants.map((o, i) => `
      <tr class="${i === 0 ? 'best' : ''}">
        <td>${sourceCell(o)}</td>
        <td class="num">${o.ml} ml</td>
        <td class="num">${money(o.price)}</td>
        <td class="num dim">${money(o.price / o.ml)}/ml</td>
        <td class="go"><a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">View →</a></td>
      </tr>`).join('')}</tbody></table>
    <p class="dim reddit-inline">Seen it cheaper on Reddit? <button class="linkish" data-reddit>Add the post</button></p>` : `<p class="dim sec">No decants found yet. Know a Reddit split? <button class="linkish" data-reddit>Add the post</button></p>`;

  det.innerHTML = `
    <a href="#" class="back">← Back to search</a>
    <h1>${esc(it.name)} <span class="br">${esc(it.brand)}</span></h1>
    <p class="dim">${CONC[it.conc] || 'Concentration not specified'}</p>
    ${p.decants.length ? `<a href="#decants" class="decant-summary" data-jump>
      <span>Cheapest decant <b>${money(p.decants[0].price / p.decants[0].ml)}/ml</b> at ${esc(index.sources[p.decants[0].src]?.name || p.decants[0].src)} (${p.decants[0].ml} ml for ${money(p.decants[0].price)})</span>
      <span class="dim">${new Set(p.decants.map((o) => o.src)).size} decant shops ↓</span></a>` : ''}
    <h2 class="sec">Full bottles</h2>
    ${bottleHtml || '<p class="dim">No full bottles in stock at tracked shops right now.</p>'}
    ${decantHtml}`;
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
  if (e.target.closest('[data-reddit]')) openRedditDialog();
  const shops = e.target.closest('[data-shops]');
  if (shops) openShops(shops.dataset.shops);
  if (e.target.closest('[data-jump]')) { e.preventDefault(); $('#decants')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

let lastQ = '';
function route() {
  if (location.hash === '#/popular') { showPopular(); return; }
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (m) { showPerfume(decodeURIComponent(m[1])); return; }
  $('#detail').hidden = true;
  document.title = 'Scent Prices';
  const q = $('#q').value.trim();
  renderResults(search(q), q);
}

$('#q').addEventListener('input', () => {
  lastQ = $('#q').value.trim();
  if (location.hash.startsWith('#/p/')) history.replaceState(null, '', location.pathname);
  $('#detail').hidden = true;
  renderResults(search(lastQ), lastQ);
});
window.addEventListener('hashchange', route);

loadIndex().then(route).catch(() => { $('#meta').textContent = 'Could not load price index.'; });
