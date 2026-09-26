# Scent Prices: decant price comparison

Search any fragrance and compare decant prices across every tracked decant shop, sorted by price per ml, plus Reddit splits people submit. Full-bottle prices from discounters are included too. There are no affiliate links.

**Decant size selector:** chips under the search box (Any, 1, 2, 3, 5, 10, 15–30 ml) switch every price on the site to that size: search results, the popular list, the Top 1,000 page, and each fragrance's decant table and "cheapest decant" summary. The choice is remembered in the browser. The index stores the cheapest price per size bucket for each fragrance.

**Top 1,000:** `#/popular` ranks fragrances by how many tracked shops stock them, a stand-in for popularity since there's no open popularity dataset. The build log reports coverage, for example "top 1000: 993 have decants, 876 have 3+ decant shops".

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

Most shops are read from Shopify's public `/products.json` feed. Shops that aren't on Shopify, or that turn that feed off, are read from their sitemap plus each product page (the `sitemap` adapter, a rotating slice per day, see below). Nothing gets around bot protection: sites that answer with Cloudflare challenges or "bot protection" errors are left out, and robots.txt is respected. Shopify rate-limits per IP across all its stores, so the scraper shares one budget (1 request/sec) across every store and pauses everything on a 429. A full crawl takes about 10 minutes on GitHub Actions. If a shop fails, its offers from the last run (up to 3 days old) are reused.

| Store | Type | Who vouches for it |
|---|---|---|
| [DecantX](https://decantx.com) | decants | [Trustpilot 4.5★ · 2.1k reviews](https://www.trustpilot.com/review/decantx.com) |
| [ScentSplit](https://www.scentsplit.com) | decants | [Trustpilot 4.7★ · 16k reviews](https://www.trustpilot.com/review/scentsplit.com) · [Basenotes thread](https://basenotes.com/threads/has-anyone-used-scentsplit-com-for-decants.419326/) |
| [Decants R Us](https://decantsrus.com) | decants | [Trustpilot 4.4★ · 108 reviews](https://www.trustpilot.com/review/decantsrus.com) |
| [Fragrances Line](https://fragrancesline.com) | decants | [Reddit: buyer haul](https://www.reddit.com/r/FemFragLab/comments/1t4q9ks/scentsplit_and_fragrancesline_grabs/) |
| [MicroPerfumes](https://microperfumes.com) | decants | [Trustpilot 4.5★ · 11k reviews](https://www.trustpilot.com/review/microperfumes.com) |
| [The Perfumed Court](https://theperfumedcourt.com) | decants | [Basenotes thread](https://basenotes.com/community/threads/perfume-court-are-they-legit.311708/) · [Fragrantica thread](https://www.fragrantica.com/board/viewtopic.php?id=143653) |
| [Vintage Decants](https://vintagedecants.com) | decants | [Trustpilot 4.6★ · 44 reviews](https://www.trustpilot.com/review/vintagedecants.com) |
| [Mystic Perfume](https://mysticperfume.com) | decants | [Trustpilot 4.8★ · 487 reviews](https://www.trustpilot.com/review/mysticperfume.com) |
| [TryScents](https://tryscentsdecants.com) | decants | [Reddit: buyer review](https://www.reddit.com/r/fragranceclones/comments/1wdk6h4/freeze_in_flames_review/) |
| [Dynasty Decants](https://www.dynastydecants.com) | decants | [Reddit: buyer recommends](https://www.reddit.com/r/fragranceclones/comments/1pyoytk/decant_drop_ranking_fierte_luna_liam_grey_aether/) |
| [Parfum Exquis](https://parfumexquis.com) | decants | [Trustpilot 4.5★ · 15 reviews](https://www.trustpilot.com/review/parfumexquis.com) · [Basenotes thread](https://basenotes.com/threads/parfumexquis.537397/) |
| [Decantalize](https://decantalize.com) | decants | [Reddit: buyer kudos](https://www.reddit.com/r/fragrance/comments/1ih2neh/decantalize_kudos/) |
| [Scent Decant](https://www.scentdecant.com) | decants | [Trustpilot 4.6★ · 600 reviews](https://www.trustpilot.com/review/scentdecant.com) |
| [The Fragrance Sample Shop](https://thefragrancesampleshop.com) | decants | [Trustpilot 4.9★ · 99 reviews](https://www.trustpilot.com/review/www.thefragrancesampleshop.com) |
| [Decantified](https://decantified.com) | decants | [Reddit: order review](https://www.reddit.com/r/fragranceclones/comments/1qm7cv2/decantified_order_review_very_happy/) |
| [Scent Suave](https://www.scentsuave.com) | decants | [Reddit: buyer review](https://www.reddit.com/r/Colognes/comments/1nvaty2/tested_10_samples_of_very_popularhyped_fragrances/) |
| [Decant House](https://www.decanthouse.com) | decants | [Trustpilot 4.9★ · 1.3k reviews](https://www.trustpilot.com/review/decanthouse.com) |
| [Surrender to Chance](https://surrendertochance.com) | decants | [Basenotes thread](https://basenotes.com/threads/surrender-to-chance.461969/) · [Fragrantica thread](https://www.fragrantica.com/board/viewtopic.php?id=61017) |
| [Decant & Discover](https://www.decantanddiscover.com) | decants | [vouched by site owner](https://decantanddiscover.com) |
| [Venba Fragrance](https://www.venbafragrance.com) | bottles + samples | [Trustpilot 4.9★ · 5.5k reviews](https://www.trustpilot.com/review/venbafragrance.com) |
| [Fragrancelord](https://fragrancelord.com) | bottles + samples | [Trustpilot 4.5★ · 1.4k reviews](https://www.trustpilot.com/review/fragrancelord.com) · [Fragrantica thread](https://www.fragrantica.com/board/viewtopic.php?id=282193) |
| [Scentrique](https://www.scentrique.us) | bottles + samples | [Reddit: buyer comparison](https://www.reddit.com/r/fragranceclones/comments/1s1sjxa/reel_vs_deal_xerjoff_naxos_vs_rayhaan_italia/) |
| [Scents Angel](https://www.scentsangel.com) | bottles + samples | [Trustpilot 4.2★ · 435 reviews](https://www.trustpilot.com/review/scentsangel.com) |
| [Luckyscent](https://www.luckyscent.com) | bottles + samples | [Fragrantica thread](https://www.fragrantica.com/board/viewtopic.php?id=11261) · [Essencional profile](https://www.essencional.com/en/posts/luckyscent-americas-go-to-retailer-for-niche-perfumery/) |
| [Aromatick](https://aromatick.com) | bottles + samples | [vouched by site owner](https://aromatick.com) |
| [MaxAroma](https://www.maxaroma.com) | discounter | — |
| [Perfumania](https://perfumania.com) | discounter | — |
| [Beauty Encounter](https://www.beautyencounter.com) | discounter | — |
| [Aura Fragrance](https://www.aurafragrance.com) | discounter | — |
| [The Perfume Box](https://perfumebox.com) | discounter | — |
| [The Perfume Shop USA](https://theperfumeshopusa.com) | discounter | — |
| [FragFlex](https://fragflex.com) | discounter | — |
| [Lattafa USA (official)](https://lattafa-usa.com) | discounter | — |
| [Fragrance Nevaeh](https://fragrance-nevaeh.com) | discounter | — |
| [Fragrance Wholesale](https://fragrancewholesale.com) | discounter | — |
| [Luxury Perfume](https://luxuryperfume.com) | discounter | — |
| [Perfumes LA](https://perfumes.la/en-us) | discounter | — |
| [Sensa Beauty](https://sensabeauty.com) | discounter | — |
| Reddit posts (submitted) | decants + bottles, expire after 60 days | — |

**Vetting decant shops.** A decant shop is only scraped if `config/sources.json` lists evidence that someone independent vouches for it (`vouch`). At least one real buyer's Reddit post supporting the shop counts, as does a review profile with real volume, or the site owner's own vouch. The shop's own site, its own review widget, paid press releases and competitor listicles don't count. The evidence links appear next to each shop in the site's shop list. Reddit was searched through its public search feed, which covers posts but not comments. Shops on hold, with the reason (`vetting`):

- **Rich and Luxe**: only a Reddit question with no visible answer; one Fragrantica thread
- **Olena's Aroma Shop**: no Reddit posts found; reviews only in the shop's own review app
- **Discovery Decants**: no Reddit posts found beyond the shop's own subreddit
- **Decanted Clone**: no Reddit posts found
- **Sample Scents**: no Reddit posts or reviews found (not the UK samplescents.co.uk)
- **Project Frags**: no Reddit posts found; TikTok mentions only
- **The Decantary**: no Reddit posts found; only paid press releases

To reinstate one, add a `vouch` entry with the evidence.

**Left out on purpose:**
- **FragranceNet, FragranceX, Perfume.com, FragranceBuy, FragranceShop.com, The Fragrance Decant Boutique and Decant Store** block automated requests (403 or Cloudflare challenges). The legitimate route to the big discounters is their affiliate data feeds (CJ, Rakuten, Impact); you don't have to use the referral links.
- **Jomashop** loads prices from an API that answers "Bot Protection Triggered".

**Rotating crawls.** Some sources have one page per product: **MaxAroma** (schema.org data), **Venba** (Shopify's per-product `.js` data; its bulk feed is blocked), **Luckyscent** (schema.org variants), **Surrender to Chance** (BigCommerce) and **Decant House** (nopCommerce). For the last two, the page only carries the base price, so each size's price and stock come from the same request the product page makes when you pick a size (`allSizes` in the config). Decant House's robots.txt disallows that endpoint; the owner of this site confirmed permission to read it. It runs at a gentle rate (about 1.5 requests/sec, 250 products/day).

**MaxAroma** isn't on Shopify. Its product pages carry schema.org price data, one size per page, across about 18k fragrance pages. The `jsonld` adapter checks 1,200 of those pages a day, oldest first, so the whole catalog refreshes about every 15 days. Offers are carried forward for up to 21 days, and the site shows "price as of <date>" on anything older than 2 days. A product is skipped if its brand doesn't appear at any other shop, which is safer than guessing.
- **Fragrance Outlet** has the same catalog as Perfumania. **FragranceUSA** lists almost everything as out of stock. 
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
