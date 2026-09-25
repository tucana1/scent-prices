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
│ reddit.yml: issue → Claude  │ ◀── "Submit a Reddit post" button opens a prefilled GitHub issue
└─────────────────────────────┘
```

- **No server and no database.** The site is static files. Search runs in the browser over a compact index. A fragrance's page fetches one of 256 small shard files.
- **Nothing runs on your laptop.** Scraping and building run in GitHub Actions. The repo only stores `data/history.json` (lowest price per fragrance and size, with one point each time it changes) and `data/reddit.json`.
- **Sizes today:** 14.8k fragrances and 79k offers. The search index is 175 KB gzipped, the history file is about 1.2 MB, and the site data is about 12 MB (served, never committed).

## Sources

The site only reads stores that publish a structured product feed (Shopify's `/products.json`), so there's no HTML scraping and no bot-protection workarounds.

| Store | Type |
|---|---|
| Perfumania | discounter |
| Beauty Encounter | discounter |
| Aura Fragrance | discounter |
| The Perfume Box | discounter |
| DecantX | decants |
| ScentSplit | decants + full bottles |
| Reddit posts (submitted) | decants + bottles, expire after 60 days |

**Left out on purpose:**
- **FragranceNet, FragranceX and Perfume.com** block automated requests (403).
- **Jomashop and MaxAroma** need a crawler that visits every product page. That's possible, but slower and more fragile.
- **Amazon, Walmart and eBay** are marketplaces with a high risk of fakes.
- **Chanel** doesn't sell through discounters, so its fragrances rarely appear.

To add a store, add a line to `config/sources.json`. A new Shopify store needs no code. For any other platform, write a new adapter in `scripts/scrape.js`.

## Setup (about 10 minutes)

1. Create a GitHub repo (it must be **public** for free Pages) and push this folder.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets → Actions:**
   - `ANTHROPIC_API_KEY`: used only by the Reddit importer, at about 1–3¢ per post.
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
