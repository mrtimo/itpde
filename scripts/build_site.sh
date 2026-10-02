#!/usr/bin/env bash
# Build the static GitHub Pages site into docs/, with the data served from
# Hugging Face instead of being copied into the repo.
#
#   1. `malloyyo dashboard bundle` builds the site (it copies the data files
#      into docs/ because the model reads local paths);
#   2. we point the bundle's data map (window.__TABLE_FILES__) at the same
#      files on Hugging Face and delete the local copies from docs/;
#   3. site_assets/seo.py makes index.html the explorer itself and adds SEO
#      metadata, structured data, a loading intro, robots.txt and sitemap.xml.
#
# The browser downloads each data file ONCE per visit (the trade table is the
# 81 MB web copy on Hugging Face, not the 150 MB full table); the explorer is a single
# page with tabs, so switching views never reloads the data.
set -euo pipefail
cd "$(dirname "$0")/.."

HF_BASE="${HF_BASE:-https://huggingface.co/datasets/24601p/itpde/resolve/main}"
TITLE="${TITLE:-International Trade Explorer}"

python3 dashboard_src/build.py
malloyyo lint
rm -rf docs
malloyyo dashboard bundle --out docs --title "$TITLE" --no-serve

python3 - "$HF_BASE" <<'PY'
import json, pathlib, re, sys
base = sys.argv[1].rstrip("/")
docs = pathlib.Path("docs")
mf = docs / "assets" / "model-files.js"
s = mf.read_text()
m = re.search(r"__TABLE_FILES__ = (\{.*?\})", s)
files = json.loads(m.group(1))
remote = {k: f"{base}/{k}" for k in files}
# The site reads the smaller web copy of the trade table (positive flows only,
# trade rounded to $1,000, unused columns empty) — 81 MB instead of 150 MB.
remote["ITPD_E_R2025_usd.parquet"] = f"{base}/web/ITPD_E_R2025_web.parquet"
s = s.replace(m.group(0), "__TABLE_FILES__ = " + json.dumps(remote))
mf.write_text(s)
# remove the local data copies (the data lives on Hugging Face)
for k, v in files.items():
    p = (docs / v).resolve()
    if p.is_file():
        p.unlink()
for d in sorted({(docs / v).parent for v in files.values()}, reverse=True):
    if d != docs and d.is_dir() and not any(d.iterdir()):
        d.rmdir()
# the explorer has its own tab bar; drop the one-link site nav and send / to it
t = docs / "trade.html"
t.write_text(re.sub(r'<nav class="dash-nav">.*?</nav>\n?', "", t.read_text(), flags=re.S))
print("data served from", base)
for k, v in remote.items():
    print("  ", k, "->", v)
PY
python3 site_assets/seo.py   # titles, meta tags, structured data, intro, robots/sitemap
du -sh docs
