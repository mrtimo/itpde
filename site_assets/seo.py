#!/usr/bin/env python3
"""Make the built site search- and share-friendly (run by scripts/build_site.sh).

- index.html IS the explorer (no redirect); trade.html is kept for old links.
- Title, description, canonical URL, Open Graph / Twitter tags, favicon.
- schema.org JSON-LD (WebApplication, based on the ITPD-E dataset).
- A real, readable intro inside #root that doubles as the loading screen;
  React replaces it as soon as the app mounts.
- robots.txt, sitemap.xml, favicon, social preview image.
"""
import html, json, pathlib, re, shutil, sys

SITE = "https://tradeexplorer.org/"
TITLE = "International Trade Explorer | Interactive World Trade Data, 1986–2023"
DESC = ("Free interactive dashboard of world trade for students and the public: compare any two countries, "
        "see where a country's exports go, and test the gravity model with USITC ITPD-E data, 1986–2023.")
ITPDE = "https://www.usitc.gov/data/gravity/gravity_portal_itpd_e"

root = pathlib.Path(__file__).resolve().parent.parent
docs = root / "docs"
assets = root / "site_assets"

jsonld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "International Trade Explorer",
    "url": SITE,
    "description": DESC,
    "applicationCategory": "EducationalApplication",
    "operatingSystem": "Any (web browser)",
    "isAccessibleForFree": True,
    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
    "inLanguage": "en",
    "image": SITE + "og-image.png",
    "keywords": "international trade, bilateral trade, gravity model, trade balance, exports, imports, ITPD-E, USITC, economics education",
    "audience": {"@type": "EducationalAudience", "educationalRole": "student"},
    "isBasedOn": {
        "@type": "Dataset",
        "name": "International Trade and Production Database for Estimation (ITPD-E), release 2025",
        "url": ITPDE,
        "creator": {"@type": "GovernmentOrganization", "name": "U.S. International Trade Commission"},
    },
    "sameAs": ["https://github.com/mrtimo/itpde", "https://huggingface.co/datasets/24601p/itpde"],
}

head = f"""<meta name="description" content="{html.escape(DESC)}">
<link rel="canonical" href="{SITE}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0b1d33">
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="International Trade Explorer">
<meta property="og:title" content="International Trade Explorer">
<meta property="og:description" content="{html.escape(DESC)}">
<meta property="og:url" content="{SITE}">
<meta property="og:image" content="{SITE}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="International Trade Explorer dashboard showing United States and China trade">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="International Trade Explorer">
<meta name="twitter:description" content="{html.escape(DESC)}">
<meta name="twitter:image" content="{SITE}og-image.png">
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
<style>
.seo-intro{{min-height:100vh;margin:0;padding:48px 32px;box-sizing:border-box;color:#fff;
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(1200px 400px at 85% -10%,rgba(57,135,229,.35),transparent 60%),
  radial-gradient(900px 380px at 5% 120%,rgba(235,104,52,.22),transparent 60%),linear-gradient(135deg,#0b1d33,#123a63)}}
.seo-intro .wrap{{max-width:820px}}
.seo-intro .eyebrow{{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#9cc3f0;font-weight:600}}
.seo-intro h1{{font-size:34px;line-height:1.15;margin:8px 0 10px;letter-spacing:-.01em}}
.seo-intro p,.seo-intro li{{color:#c9d6e6}}
.seo-intro h2{{font-size:16px;margin:22px 0 6px;color:#fff}}
.seo-intro a{{color:#fff}}
.seo-intro .loading{{display:inline-flex;align-items:center;gap:10px;margin:14px 0 6px;padding:8px 14px;border-radius:999px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#9cc3f0;font-size:13px}}
.seo-intro .spin{{width:13px;height:13px;border-radius:50%;border:2px solid rgba(156,195,240,.35);border-top-color:#9cc3f0;animation:seo-spin .8s linear infinite}}
@keyframes seo-spin{{to{{transform:rotate(360deg)}}}}
</style>
"""

intro = f"""<main class="seo-intro"><div class="wrap">
<div class="eyebrow">International trade · ITPD-E 1986–2023</div>
<h1>International Trade Explorer</h1>
<p>{html.escape(DESC)}</p>
<div class="loading" role="status"><span class="spin"></span>Loading the explorer…</div>
<noscript><p><strong>This explorer needs JavaScript.</strong> Please enable JavaScript to use the interactive dashboard.</p></noscript>
<h2>Three ways to explore world trade</h2>
<ul>
<li><strong>Two countries:</strong> exports in each direction, the bilateral trade balance, partner dependence, top industries, the Grubel–Lloyd intra-industry trade index, and gravity variables such as distance, shared borders and trade agreements.</li>
<li><strong>One country:</strong> exports and imports over time, destination regions, top export markets and import sources, top industries, and a live gravity-model regression across all trading partners.</li>
<li><strong>The world:</strong> world trade by sector, the top exporters, region-to-region trade flows, the share of trade under trade agreements, and how far the average dollar of trade travels.</li>
</ul>
<h2>Data</h2>
<p>Built on the U.S. International Trade Commission's <a href="{ITPDE}">International Trade and Production Database for Estimation (ITPD-E)</a>, release 2025: 87.5 million exporter–importer–industry–year flows for 170 industries, 1986–2023, linked to the USITC Dynamic Gravity Dataset, World Bank income groups and UN regions. Data: <a href="https://huggingface.co/datasets/24601p/itpde">Hugging Face</a> · Code: <a href="https://github.com/mrtimo/itpde">GitHub</a>.</p>
</div></main>"""

def seo_page(src: str) -> str:
    s = re.sub(r"<title>.*?</title>", f"<title>{html.escape(TITLE)}</title>", src, count=1, flags=re.S)
    s = s.replace("</head>", head + "</head>", 1)
    s = s.replace('<div id="root"></div>', f'<div id="root">{intro}</div>', 1)
    return s

app = (docs / "trade.html").read_text()
page = seo_page(app)
(docs / "index.html").write_text(page)   # the home page is the explorer itself
(docs / "trade.html").write_text(page)   # old links keep working; canonical points to /
# Keep the explorer's shareable links on the root URL (tradeexplorer.org/?...)
# instead of /trade.html?... — the runtime builds them as `./<dashboard>.html`.
js = docs / "assets" / "trade.js"
code = js.read_text()
pat = re.compile(r"new URL\(`\./\$\{(\w+)\}\.html`,document\.baseURI\)")
if pat.search(code):
    code = pat.sub(lambda m: f'new URL({m.group(1)}==="trade"?"./":`./${{{m.group(1)}}}.html`,document.baseURI)', code)
    js.write_text(code)
    print("SEO: share links now use the root URL")
else:
    print("SEO WARNING: runtime URL pattern not found; links will use /trade.html", file=sys.stderr)

for name in ["favicon.svg", "robots.txt", "sitemap.xml", "og-image.png"]:
    if (assets / name).exists():
        shutil.copy(assets / name, docs / name)
print("SEO: index.html + trade.html updated;", ", ".join(p.name for p in assets.iterdir() if p.suffix in {".svg", ".txt", ".xml", ".png"}))
