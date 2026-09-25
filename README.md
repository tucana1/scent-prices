# Scent Prices

Search any fragrance and see the cheapest place to buy it: full bottles grouped by size, with decants underneath sorted by price per ml. Prices come from discounters, decant shops and Reddit sale posts. There are no affiliate links.

## How it works

```
GitHub Actions (daily, free)                     GitHub Pages (free, static)
┌─────────────────────────────┐                  ┌──────────────────────────┐
│ scrape.js  → shops' feeds   │                  │ index.html + app.js      │
│ build.js   → merge + match  │ ── deploy ──▶    │ data/index.json  (175KB gz) search index
│            → history.json   │                  │ data/p/00..ff.json       offers + history, on demand
└─────────────────────────────┘                  └──────────────────────────┘
        ▲ commit data/reddit.json
┌─────────────────────────────┐
│ reddit.yml: issue → LLM     │ ◀── "Submit a Reddit post" button opens a prefilled GitHub issue
└─────────────────────────────┘
```

- **No server and no database.** The site is static files. Search runs in the browser over a compact index. A fragrance's page fetches one of 256 small shard files.
- **Nothing runs on your laptop.** Scraping and building run in GitHub Actions. The repo only stores `data/history.json` (lowest price per fragrance and size, with one point each time it changes) and `data/reddit.json`.
- **Sizes today:** 14.8k fragrances and 79k offers. The search index is 175 KB gzipped, the history file is about 1.2 MB, and the site data is about 12 MB (served, never committed).

## Sources

The site only reads stores that publish a structured product feed (Shopify's `/products.json`), so there's no HTML scraping and no bot-protection workarounds. Shopify rate-limits per IP across all its stores, so the scraper shares one budget (1 request/sec) across every store and pauses everything on a 429. A full crawl takes about 10 minutes on GitHub Actions. If a shop fails, its offers from the last run (up to 3 days old) are reused.

| Store | Type |
|---|---|
| [Perfumania](https://perfumania.com) | discounter |
| [Beauty Encounter](https://www.beautyencounter.com) | discounter |
| [Aura Fragrance](https://www.aurafragrance.com) | discounter |
| [The Perfume Box](https://perfumebox.com) | discounter |
| [The Perfume Shop USA](https://theperfumeshopusa.com) | discounter |
| [FragFlex](https://fragflex.com) | discounter |
| [Lattafa USA (official)](https://lattafa-usa.com) | discounter |
| [Fragrance Nevaeh](https://fragrance-nevaeh.com) | discounter |
| [Fragrance Wholesale](https://fragrancewholesale.com) | discounter |
| [Luxury Perfume](https://luxuryperfume.com) | discounter |
| [Perfumes LA](https://perfumes.la/en-us) | discounter |
| [Sensa Beauty](https://sensabeauty.com) | discounter |
| [Fragrancelord](https://fragrancelord.com) | bottles + samples |
| [Scentrique](https://www.scentrique.us) | bottles + samples |
| [DecantX](https://decantx.com) | decants |
| [ScentSplit](https://www.scentsplit.com) | decants |
| [Decants R Us](https://decantsrus.com) | decants |
| [Fragrances Line](https://fragrancesline.com) | decants |
| [MicroPerfumes](https://microperfumes.com) | decants |
| [The Perfumed Court](https://theperfumedcourt.com) | decants |
| [Vintage Decants](https://vintagedecants.com) | decants |
| [Olena's Aroma Shop](https://olenasaromashop.com) | decants |
| [Mystic Perfume](https://mysticperfume.com) | decants |
| [Discovery Decants](https://discoverydecants.com) | decants |
| [TryScents](https://tryscentsdecants.com) | decants |
| [Dynasty Decants](https://www.dynastydecants.com) | decants |
| [Decanted Clone](https://decantedclone.com) | decants |
| [Parfum Exquis](https://parfumexquis.com) | decants |
| [Sample Scents](https://samplescents.com) | decants |
| [Decantalize](https://decantalize.com) | decants |
| [Scent Decant](https://www.scentdecant.com) | decants |
| [The Fragrance Sample Shop](https://thefragrancesampleshop.com) | decants |
| Reddit posts (submitted) | decants + bottles, expire after 60 days |

**Left out on purpose:**
- **FragranceNet, FragranceX, Perfume.com, FragranceBuy, Venba and FragranceShop.com** block automated requests (403).
- **Jomashop** loads prices with JavaScript from a private API. **MaxAroma** puts structured prices on each product page, but only for one size, across about 30k pages of ~700 KB. That would need a rotating crawl of part of the catalog per day. It's the best next candidate.
- **Fragrance Outlet** has the same catalog as Perfumania. **FragranceUSA** lists almost everything as out of stock. **Aromatick** and **Decant & Discover** sell their own clones, or don't name the original brand.
- **Non-USD shops** (Petit Parfums, Eurodecants, Fragrant World, Niche Perfume Decants, Prive Perfumes) are left out until the site handles currencies.
- **Amazon, Walmart and eBay** are marketplaces with a high risk of fakes.
- **Chanel** doesn't sell through discounters, so its fragrances rarely appear.

To add a store, add a line to `config/sources.json`. A new Shopify store needs no code. Set `"brandFrom": "title"` if the shop's vendor field is the shop's own name. For any other platform, write a new adapter in `scripts/scrape.js`. To test changes without publishing, run **Actions → Update prices → Run workflow** with *Deploy* unticked (a dry run). The scraped data is saved as a downloadable artifact.

## Setup (about 10 minutes)

1. Create a GitHub repo (it must be **public** for free Pages) and push this folder.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets → Actions:**
   - `OPENROUTER_API_KEY`: used only by the Reddit importer. The default model is `meta/muse-spark-1.3-contributor` (a small fraction of a cent per post). To use a different OpenRouter model, set the `LLM_MODEL` env var in `reddit.yml`.
   - `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are optional. Without them the importer reads the post's public RSS feed, which needs no account. Anonymous RSS allows about one request per minute per IP, so the importer waits and retries when rate-limited. If Reddit ever blocks GitHub's servers outright, create a free "script" app at <https://www.reddit.com/prefs/apps> and add these two secrets. Pasting the price list into the issue also always works.
4. Edit `public/config.js` and set `repo` to `your-user/your-repo`.
5. Create a label called `approved`.
6. **Actions → Update prices → Run workflow.** It deploys daily after that.

**Reddit submissions:** posts you submit are imported right away. Other people's submissions wait until you add the `approved` label, so strangers can't spend your API credit. The bot comments on the issue with what it extracted.

## Local

```bash
node scripts/scrape.js          # ~2 min, writes build/offers.json (~20MB, gitignored)
node scripts/build.js           # writes public/data/
npm run dev                     # http://localhost:8080
```

`MAX_PAGES=2 node scripts/scrape.js` runs a quick partial scrape.

## Matching

`scripts/lib/normalize.js` turns titles like "Sauvage by Christian Dior EDT Spray 3.4 oz" into `dior--sauvage--edt` + 100 ml. This is where most of the future work will be. About 1,800 fragrances currently match across two or more stores. Most of the rest really are listed at only one store (niche lines, flankers), but some are near-misses to fix with brand aliases or filler words.
