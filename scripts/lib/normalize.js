// Turns messy retailer titles into a canonical perfume id: brand--name--concentration.
// The same bottle is titled differently everywhere ("Sauvage by Christian Dior EDT Spray 3.4 oz"
// vs "Dior Sauvage Eau de Toilette"), so matching quality lives or dies here.

const BRAND_ALIASES = {
  'christian dior': 'Dior', 'dior': 'Dior',
  'yves saint laurent': 'Yves Saint Laurent', 'ysl': 'Yves Saint Laurent', 'saint laurent': 'Yves Saint Laurent',
  'giorgio armani': 'Giorgio Armani', 'armani': 'Giorgio Armani', 'emporio armani': 'Emporio Armani',
  'maison francis kurkdjian': 'Maison Francis Kurkdjian', 'mfk': 'Maison Francis Kurkdjian', 'francis kurkdjian': 'Maison Francis Kurkdjian',
  'maison francis kurkdijian': 'Maison Francis Kurkdjian', 'maison francis kurkdjian mfk': 'Maison Francis Kurkdjian',
  'xerjoff join the club': 'Xerjoff', 'xerjoff shooting stars': 'Xerjoff', 'xj': 'Xerjoff',
  'maison francis kurkdijan': 'Maison Francis Kurkdjian', 'maison francis kurkdjian mfk': 'Maison Francis Kurkdjian',
  'jean paul gaultier': 'Jean Paul Gaultier', 'jpg': 'Jean Paul Gaultier',
  'dolce gabbana': 'Dolce & Gabbana', 'dolce and gabbana': 'Dolce & Gabbana', 'd g': 'Dolce & Gabbana',
  'paco rabanne': 'Rabanne', 'rabanne': 'Rabanne',
  'calvin klein': 'Calvin Klein', 'ck': 'Calvin Klein',
  'viktor rolf': 'Viktor & Rolf', 'viktor and rolf': 'Viktor & Rolf',
  'mont blanc': 'Montblanc', 'montblanc': 'Montblanc',
  'by kilian': 'Kilian', 'kilian': 'Kilian', 'kilian paris': 'Kilian',
  'hermes': 'Hermes', 'bvlgari': 'Bvlgari', 'bulgari': 'Bvlgari',
  'lancome': 'Lancome', 'parfums de marly': 'Parfums de Marly', 'pdm': 'Parfums de Marly',
  'hugo boss': 'Hugo Boss', 'boss': 'Hugo Boss',
  'tom ford': 'Tom Ford', 'creed': 'Creed', 'le labo': 'Le Labo', 'maison margiela': 'Maison Margiela',
  'al haramain': 'Al Haramain', 'al haramain perfumes': 'Al Haramain',
  'carolina herrera': 'Carolina Herrera', 'prada': 'Prada', 'versace': 'Versace', 'chanel': 'Chanel',
  'givenchy': 'Givenchy', 'guerlain': 'Guerlain', 'valentino': 'Valentino', 'burberry': 'Burberry',
  'azzaro': 'Azzaro', 'initio': 'Initio', 'initio parfums prives': 'Initio', 'xerjoff': 'Xerjoff',
  'lattafa': 'Lattafa', 'lattafa perfumes': 'Lattafa', 'armaf': 'Armaf', 'rasasi': 'Rasasi', 'afnan': 'Afnan',
  'nishane': 'Nishane', 'amouage': 'Amouage', 'byredo': 'Byredo', 'diptyque': 'Diptyque',
  'mancera': 'Mancera', 'montale': 'Montale',
  'yvessaintlaurent': 'Yves Saint Laurent', 'roja london': 'Roja Parfums', 'jo malone london': 'Jo Malone', 'jo malone': 'Jo Malone',
  'maison martin margiela': 'Maison Margiela', 'thierry mugler': 'Mugler', 'mugler': 'Mugler', 'by terry': 'By Terry',
  'penhaligons london': 'Penhaligons', 'bond no 9 new york': 'Bond No 9', 'profumum': 'Profumum Roma', 'roja': 'Roja Parfums', 'roja parfums': 'Roja Parfums', 'roja dove': 'Roja Parfums',
};

// Generic trailing words vendors glue onto brand names ("Tahari Parfums", "Lattafa Perfumes").
const BRAND_SUFFIX = /\s+(parfums?|perfumes?|fragrances?|paris|london|milano|new york|nyc|beauty|cosmetics|inc|llc)$/;
// Houses whose real name starts with "By"; every other leading "By" is a shop's title habit ("By Xerjoff").
const BY_BRANDS = new Set(['by terry', 'by far', 'by rosie jane', 'by lilly', 'by kilian']);

// Things that are not a bottle of perfume. Checked against title + variant.
const NOT_PERFUME = /\b(gift ?set|travel set|discovery set|sets?|set of|\d+ ?(pc|pcs|piece)|coffret|lotion|shower|gel|deodorant|deo stick|after ?shave|balm|body (wash|mist|spray|cream|oil)|hair (mist|perfume)|soap|candle|diffuser|discovery|sampler|refill(s)?|bundle|kit|pouch|case|wallet|atomizer only|empty|subscription|gift ?card|mystery|surprise)\b/i;

const OZ_TO_ML = { 0.17: 5, 0.2: 6, 0.25: 7.5, 0.27: 8, 0.3: 9, 0.33: 10, 0.34: 10, 0.5: 15, 0.67: 20, 0.68: 20, 1: 30, 1.3: 40, 1.4: 40, 1.6: 50, 1.7: 50, 2: 60, 2.5: 75, 2.7: 80, 3: 90, 3.3: 100, 3.4: 100, 3.6: 110, 4: 120, 4.2: 125, 5: 150, 6.7: 200, 6.8: 200, 8: 250, 8.4: 250, 10: 300 };

export function ascii(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Apostrophes are dropped, not spaced: "Penhaligon's" and "Penhaligons" must be the same brand.
export function slug(s) {
  return ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function words(s) {
  return ascii(s).toLowerCase().replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function canonicalBrand(vendor) {
  let w = words(vendor);
  if (BRAND_ALIASES[w]) return BRAND_ALIASES[w];
  if (w.startsWith('by ') && !BY_BRANDS.has(w)) w = w.slice(3);
  if (BRAND_ALIASES[w]) return BRAND_ALIASES[w];
  const stripped = w.replace(BRAND_SUFFIX, '');
  if (BRAND_ALIASES[stripped]) return BRAND_ALIASES[stripped];
  if (!stripped) return '';
  // Title-case whatever the vendor field said.
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function concentration(text) {
  const t = words(text);
  if (/\bextrait\b/.test(t)) return 'Extrait';
  if (/\b(eau de parfum|edp)\b/.test(t)) return 'EDP';
  if (/\b(eau de toilette|edt)\b/.test(t)) return 'EDT';
  if (/\b(eau de cologne|edc)\b/.test(t)) return 'EDC';
  if (/\b(parfum|elixir)\b/.test(t) && !/\bparfums\b/.test(t)) return /\belixir\b/.test(t) ? '' : 'Parfum';
  return '';
}

export function sizeMl(text) {
  const t = String(text || '').toLowerCase().replace(/,(?=\d)/g, '.');
  let m = t.match(/\b(\d+)\s*\/\s*(\d+)\s*ml\b/); // "1/2 ml" vials
  if (m && +m[2]) return +(+m[1] / +m[2]).toFixed(2);
  m = t.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (m) return +m[1];
  m = t.match(/(\d*\.?\d+)\s*(?:fl\.?\s*)?oz\b/);
  if (m) {
    const oz = +(+m[1]).toFixed(2);
    return OZ_TO_ML[oz] ?? Math.round(oz * 29.5735);
  }
  return null;
}

export function isTester(text) {
  return /\b(tester|unboxed|no box|without box|damaged box|plainer box|white box)\b/i.test(text || '');
}

export function isNotPerfume(text) {
  return NOT_PERFUME.test(text || '');
}

// Strip brand, concentration, size and marketing filler from a title, leaving the fragrance name.
export function fragranceName(title, brand, vendor) {
  // Parentheticals are packaging/edition chatter: "(Unisex)", "(Sample)", "(DISCONTINUED)", "(Tester)".
  // Sizes go before punctuation is stripped, or "3.4 oz" leaves a stray "3" behind.
  let t = ' ' + words(String(title)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(\d[a-z]+)([A-Z])/g, '$1 $2') // "9pmMen" -> "9pm Men"
    .replace(/[-\s]DX\b/g, ' ') // DecantX's internal "-DX" listings
    .replace(/\b\d+(?:\s*\/\s*\d+)+\s*(ml|oz)\b/gi, ' ')
    .replace(/(^|[^\w.])\d*[.,]?\d+\s*(ml|oz|fl\.?\s*oz)\b\.?/gi, ' ')) + ' ';
  const brandForms = new Set([words(brand), words(vendor), words(vendor).replace(BRAND_SUFFIX, '')]);
  for (const [alias, canon] of Object.entries(BRAND_ALIASES)) if (canon === brand) brandForms.add(alias);
  // Longest first so "christian dior" goes before "dior".
  for (const b of [...brandForms].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // Keep the brand when it's part of the name: "Bleu de Chanel", "Terre d'Hermes", "Eau de Rochas".
    // A city after the house is part of its name ("Maison Francis Kurkdjian Paris Baccarat Rouge 540").
    t = t.replace(new RegExp(` by ${b} `, 'g'), ' ').replace(new RegExp(`(?<!\\b(?:de|di|du|d)) ${b}( (paris|london|milano|new york|nyc))? `, 'g'), ' ');
  }
  t = t
    // Award/listing chatter some shops append ("2017 voted one of best releases", "last call").
    .replace(/\b((19|20)\d{2} )?(voted|finalist|foundation|basenotes|last call)\b.*$/, ' ')
    .replace(/\b\d*\.?\d+\s*(ml|oz|fl oz|fl)\b/g, ' ')
    // "Le Parfum" / "Elixir de Parfum" style names keep the word; plain "Parfum" is concentration.
    .replace(/\b(extrait de parfum|eau de parfum|eau de toilette|eau de cologne|eau fraiche|edp|edt|edc|extrait|parfum intense|(?<!\ble )parfum)\b/g, (m) => (m === 'parfum intense' ? 'intense' : ' '))
    .replace(/\b(spray|splash|vaporisateur|natural|perfumes?|colognes?|fragrances?|scent|tester|unboxed|new|box item|in box|brand without box|without box|no box|samples?|decants?|split|retail bottle|travel spray|travel size|xl|manufacturer|(19|20)\d{2} bottle|decantx|perfume cologne decant fragrance samples|private blend|private line|manufacturer boxed|boxed|glass sample vial|sample vial|glass spray|vial|mini|\d{4}s batch|\d{4} batch|boxed|for (men|women|man|woman|him|her|unisex)|mens|womens|unisex|men|women|man|woman|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(\w+)( \1\b)+/g, '$1'); // "elixir intense intense" -> "elixir intense"
  // House-specific line names shops add inconsistently ("XJ 1861 Naxos" / "1861 Naxos" / "Naxos").
  const lines = HOUSE_LINES[brand];
  if (lines) t = t.replace(lines, ' ').replace(/\s+/g, ' ').trim() || t;
  return t;
}

const HOUSE_LINES = {
  Xerjoff: /\b(xj 1861|xj|1861|join the club|shooting stars|oud stars)\b/g,
};

// The name part ignores spacing and hyphens: "9pm" / "9 Pm", "Torino21" / "Torino 21" are one fragrance.
// public/app.js rebuilds ids the same way, so keep the two in sync.
export function perfumeId(brand, name, conc) {
  return [slug(brand), slug(name).replace(/-/g, ''), conc ? conc.toLowerCase() : ''].filter(Boolean).join('--');
}

// oz->ml rounding means 3.3 and 3.4oz both land on 100ml; this groups near-identical sizes.
export function sizeBucket(ml) {
  return ml == null ? 0 : Math.round(ml);
}

// For shops whose "vendor" field is the shop itself: read the house from the title instead.
// "Percival by Parfums de Marly Eau de Parfum" -> "Parfums de Marly"; otherwise match the longest
// known brand at the start of the title ("Calvin Klein Euphoria" -> "Calvin Klein").
export function brandFromTitle(title, knownBrands) {
  const by = String(title).match(/\sby\s+(.+?)(?=\s+(?:eau|edp|edt|parfum|extrait|cologne|for|spray|perfume)\b|\s*[(\-–|,]|\s+\d|$)/i);
  if (by) return by[1].trim();
  const t = words(title).split(' ');
  for (let n = Math.min(5, t.length - 1); n >= 1; n--) {
    const hit = knownBrands.get(t.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

// Loose key for spotting the same house spelled differently across shops
// ("Roja Parfums" / "Roja London", "Yves Saint Laurent" / "Yvessaintlaurent").
export function brandKey(brand) {
  return words(brand).replace(/^by (?!terry$|far$|rosie jane$|lilly$)/, '')
    .replace(/\b(parfums?|perfumes?|fragrances?|paris|london|milano|new york|nyc|beauty|cosmetics|inc|llc|the|co)\b/g, ' ')
    .replace(/\s+/g, '');
}
