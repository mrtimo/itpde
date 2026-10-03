# International Trade Explorer (ITPD-E)

Interactive dashboards for undergraduate international-trade courses, built with
[Malloy](https://www.malloydata.dev/) and [malloyyo](https://github.com/malloydata/malloyyo).

**Live site:** https://tradeexplorer.org (mirror: https://mrtimo.github.io/itpde/)
**Data:** https://huggingface.co/datasets/24601p/itpde (the site loads it from there)

The explorer is one page with three tabs — *Two countries* (bilateral trade,
balance, industries, gravity variables), *One country* (partners, regions,
industries and a live gravity-model regression) and *The world* (sectors,
regional blocs, leaders, income groups). The data is downloaded once per visit,
and each tab keeps its own filters while you move between tabs.

## Repository layout

| Path | What it is |
|---|---|
| `trade_flows.malloy`, `country.malloy`, `lookups.malloy`, `gravity.malloy` | Base sources (one per table), every field documented with `#(doc)` |
| `itpd.malloy` | Joined sources: `trade`, `country_profile`, `country_economy` |
| `world.malloy` | Pre-aggregated world tables (`world_region_flows`, `world_exporters`) used by *The world* tab |
| `givens.malloy` | Dashboard filters (givens) and their suggestion queries |
| `index.malloy` | Export surface (all 11 sources) |
| `dashboards/trade.malloy` | Every query the explorer runs |
| `dashboards/trade.jsx` | Generated dashboard component — edit `dashboard_src/`, then `python3 dashboard_src/build.py` |
| `dashboard_src/` | Dashboard UI source (shared kit + one file per tab) |
| `scripts/get_data.sh` | Download the data from Hugging Face for local work |
| `scripts/update_itpde.py` | Refresh everything from a new ITPD-E release CSV (full + web parquet, lookups, aggregates; validates and prints follow-ups) |
| `scripts/build_aggregates.sql` | Rebuild the small World-tab tables in `aggregates/` (run with `duckdb`) |
| `site_assets/` | SEO and sharing: favicon, social preview image, robots.txt, sitemap.xml, and `seo.py` (meta tags, structured data, loading intro) |
| `scripts/build_site.sh` | Build `docs/` (GitHub Pages) with data served from Hugging Face |
| `docs/` | The published static site |

## Working locally

```bash
npm install -g @malloydata/malloyyo
cp malloy-config.example.json malloy-config.json
scripts/get_data.sh                 # ~150 MB from Hugging Face
malloyyo dashboard dev              # http://localhost:4173/?d=trade
```

To publish changes: `scripts/build_site.sh`, then `npx wrangler deploy` (Cloudflare, tradeexplorer.org; config in `wrangler.jsonc`) and commit and push `docs/` (GitHub Pages mirror).

## Updating to a new ITPD-E release

USITC publishes a new ITPD-E release about every two years. Download the CSV from
the [ITPD-E portal](https://www.usitc.gov/data/gravity/gravity_portal_itpd_e), then:

```bash
scripts/get_data.sh                                    # current lookups (once)
python3 scripts/update_itpde.py --source path/to/ITPD_E_RXXXX.csv --upload
scripts/build_site.sh && npx wrangler deploy
```

The script writes drop-in replacements (same filenames and columns), checks the
data, and prints anything that needs a manual follow-up (new year range, new
country codes, the domestic-data cut-off).

## Data the site loads

The live site downloads `web/ITPD_E_R2025_web.parquet` (81 MB) from Hugging Face
instead of the full 150 MB table: positive flows only, `trade` rounded to the
nearest $1,000 (values under $1,000 kept exact), and the unused `flag_mirror` /
name columns left empty. Local development (`scripts/get_data.sh`) uses the full
table.

## Data notes

Trade values are in whole current US dollars (ITPD-E reports millions; values
were multiplied by 1,000,000 and rounded). ITPD-E includes domestic sales
(exporter = importer); the dashboards show cross-border trade unless noted.
Coverage: agriculture from 1986, manufacturing and mining & energy from 1988,
services from 2000; domestic sales are complete only through 2021; gravity
variables (USITC DGD 2.1) run to 2019, GDP to 2018.
