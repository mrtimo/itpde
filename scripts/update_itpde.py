#!/usr/bin/env python3
"""
Refresh the dashboard's data from a new ITPD-E release (USITC publishes one
about every two years).

Takes the release CSV as published by USITC and produces DROP-IN replacements
for every file the dashboard reads — same filenames and columns, so the Malloy
model and the website need no changes:

  ITPD_E_R2025_usd.parquet            full table, trade in whole US dollars
  web/ITPD_E_R2025_web.parquet        smaller copy the website downloads
  lookups/country_year.csv            ISO3 + year -> dynamic code + name
  lookups/industry.csv                industry id -> description, broad sector
  lookups/country.csv                 first/last year and display name refreshed
  aggregates/world_region_flows.parquet, aggregates/world_exporters.parquet

Processing (identical to the current files):
  * trade: millions of USD -> whole dollars (x 1,000,000, rounded), BIGINT
  * web copy: positive flows only; trade rounded to the nearest $1,000 with
    values under $1,000 kept exact; flag_mirror and the per-year names empty
  * zstd-compressed parquet, 1M-row row groups, sorted for compression

Usage
-----
    # 1. Download the release CSV from
    #    https://www.usitc.gov/data/gravity/gravity_portal_itpd_e
    # 2. Point SOURCE_CSV below at it (or pass --source), then:
    python3 scripts/update_itpde.py
    python3 scripts/update_itpde.py --source ~/Downloads/ITPD_E_R2027.csv
    python3 scripts/update_itpde.py --source new.csv --out-dir /tmp/test   # dry run elsewhere

Then (see the printed checklist): upload to Hugging Face, run
scripts/build_site.sh and `npx wrangler deploy`.

Requires: pip install duckdb  (huggingface_hub only for --upload)
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

import duckdb

# ─── Settings ────────────────────────────────────────────────────────────────
# Placeholder: path to the ITPD-E release CSV downloaded from USITC.
SOURCE_CSV = "PATH/TO/ITPD_E_RXXXX.csv"

# Output names are kept identical to the current release so the dashboard picks
# them up without code changes. (Renaming them would mean editing
# trade_flows.malloy and scripts/build_site.sh.)
FULL_PARQUET = "ITPD_E_R2025_usd.parquet"
WEB_PARQUET = "web/ITPD_E_R2025_web.parquet"
HF_REPO = "24601p/itpde"

# Columns of the ITPD-E CSV, in order, with the types we read them as.
COLUMNS = {
    "exporter_iso3": "VARCHAR",
    "exporter_iso3_dynamic": "VARCHAR",
    "exporter_name": "VARCHAR",
    "importer_iso3": "VARCHAR",
    "importer_iso3_dynamic": "VARCHAR",
    "importer_name": "VARCHAR",
    "broad_sector": "VARCHAR",
    "industry_id": "USMALLINT",
    "industry_descr": "VARCHAR",
    "year": "USMALLINT",
    "trade": "DOUBLE",          # millions of current USD in the source
    "flag_mirror": "USMALLINT",
    "flag_zero": "VARCHAR",
}
PARQUET_OPTS = "FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19, ROW_GROUP_SIZE 1000000"


def say(msg: str) -> None:
    print(msg, flush=True)


def step(title: str):
    say(f"\n▶ {title}")
    return time.time()


def done(t0: float, extra: str = "") -> None:
    say(f"  ✓ {time.time() - t0:5.1f}s {extra}")


def fail(msg: str) -> None:
    say(f"\n✗ {msg}")
    sys.exit(1)


def mb(path: Path) -> str:
    return f"{path.stat().st_size / 1e6:,.1f} MB"


def main() -> None:
    repo = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=SOURCE_CSV, help="ITPD-E release CSV (default: SOURCE_CSV in this script)")
    ap.add_argument("--out-dir", default=str(repo), help="where to write outputs (default: the repo root)")
    ap.add_argument("--threads", type=int, default=0, help="DuckDB threads (default: all cores)")
    ap.add_argument("--upload", action="store_true", help=f"upload the outputs to Hugging Face ({HF_REPO}) when done")
    args = ap.parse_args()

    src = Path(args.source).expanduser()
    if "PATH/TO" in str(src) or not src.is_file():
        fail(f"Source CSV not found: {src}\n  Set SOURCE_CSV at the top of this script or pass --source path/to/file.csv")
    out = Path(args.out_dir).expanduser().resolve()
    (out / "web").mkdir(parents=True, exist_ok=True)
    (out / "lookups").mkdir(parents=True, exist_ok=True)
    (out / "aggregates").mkdir(parents=True, exist_ok=True)
    country_csv_src = repo / "lookups" / "country.csv"      # curated ISO/UN/World Bank lookup
    dgd_pair = repo / "lookups" / "dgd_pair_year.parquet"   # USITC gravity data (separate release)
    for need in (country_csv_src, dgd_pair):
        if not need.is_file():
            fail(f"Missing {need} — run scripts/get_data.sh first (it downloads the lookups).")

    tmp = out / ".itpde_tmp"
    tmp.mkdir(exist_ok=True)
    con = duckdb.connect()
    con.execute(f"SET temp_directory='{tmp}'")
    if args.threads:
        con.execute(f"SET threads={args.threads}")
    say(f"ITPD-E refresh\n  source : {src} ({mb(src)})\n  output : {out}")

    # ─── 1. Read and validate the CSV ────────────────────────────────────────
    t0 = step("Reading and validating the CSV")
    header = src.open("r", encoding="utf-8-sig").readline().strip().split(",")
    header = [h.strip().strip('"') for h in header]
    if header != list(COLUMNS):
        missing = [c for c in COLUMNS if c not in header]
        extra = [c for c in header if c not in COLUMNS]
        fail("Column layout differs from the release this pipeline was built for.\n"
             f"  expected: {list(COLUMNS)}\n  found   : {header}\n"
             f"  missing : {missing}\n  extra   : {extra}\n"
             "  Update COLUMNS (and the Malloy model) before continuing.")
    cols = ", ".join(f"'{k}': '{v}'" for k, v in COLUMNS.items())
    con.execute(f"CREATE TABLE raw AS SELECT * FROM read_csv('{src}', header=true, columns={{{cols}}})")
    chk = con.execute("""
        SELECT count(*) n, min(year) y0, max(year) y1,
               count(*) FILTER (WHERE trade IS NULL) null_trade,
               count(*) FILTER (WHERE trade < 0) neg_trade,
               count(*) FILTER (WHERE exporter_iso3 IS NULL OR importer_iso3 IS NULL OR industry_id IS NULL OR year IS NULL) null_keys,
               count(*) FILTER (WHERE flag_zero NOT IN ('p','r','u') OR flag_zero IS NULL) bad_flag,
               count(*) FILTER (WHERE flag_zero = 'p' AND trade <= 0) p_not_positive,
               count(*) FILTER (WHERE flag_zero IN ('r','u') AND trade <> 0) zero_flag_nonzero,
               count(DISTINCT industry_id) industries
        FROM raw""").fetchone()
    n, y0, y1, null_trade, neg, null_keys, bad_flag, p_np, z_nz, n_ind = chk
    dup = con.execute("""SELECT count(*) FROM (SELECT 1 FROM raw GROUP BY exporter_iso3, importer_iso3, industry_id, year HAVING count(*) > 1)""").fetchone()[0]
    done(t0, f"{n:,} rows · years {y0}–{y1} · {n_ind} industries")
    problems = []
    if null_trade: problems.append(f"{null_trade:,} rows with empty trade")
    if neg: problems.append(f"{neg:,} rows with negative trade")
    if null_keys: problems.append(f"{null_keys:,} rows with an empty key column")
    if bad_flag: problems.append(f"{bad_flag:,} rows with flag_zero not in p/r/u")
    if dup: problems.append(f"{dup:,} duplicated exporter × importer × industry × year keys")
    if problems:
        fail("Validation failed:\n  - " + "\n  - ".join(problems))
    if p_np or z_nz:
        say(f"  ⚠ flag/value mismatches: {p_np:,} 'p' rows ≤ 0, {z_nz:,} 'r'/'u' rows ≠ 0 (kept as published)")

    # ─── 2. Full table in whole dollars ──────────────────────────────────────
    t0 = step(f"Writing {FULL_PARQUET} (trade in whole US dollars)")
    full = out / FULL_PARQUET
    con.execute(f"""
        COPY (SELECT * REPLACE (round(trade * 1e6)::BIGINT AS trade)
              FROM raw ORDER BY industry_id, exporter_iso3, importer_iso3, year)
        TO '{full}' ({PARQUET_OPTS})""")
    con.execute("DROP TABLE raw")
    con.execute(f"CREATE VIEW f AS FROM '{full}'")
    done(t0, mb(full))

    # ─── 3. Web copy ─────────────────────────────────────────────────────────
    t0 = step(f"Writing {WEB_PARQUET} (positive flows, $1,000 rounding, unused columns empty)")
    web = out / WEB_PARQUET
    con.execute(f"""
        COPY (SELECT * REPLACE (
                CASE WHEN trade < 1000 THEN trade ELSE round(trade / 1000)::BIGINT * 1000 END AS trade,
                NULL::USMALLINT AS flag_mirror,
                NULL::VARCHAR AS exporter_name,
                NULL::VARCHAR AS importer_name)
              FROM f WHERE trade > 0
              ORDER BY exporter_iso3, importer_iso3, industry_id, year)
        TO '{web}' ({PARQUET_OPTS})""")
    con.execute(f"CREATE VIEW w AS FROM '{web}'")
    wv = con.execute("""
        SELECT (SELECT count(*) FROM f WHERE trade > 0),
               (SELECT count(*) FROM w),
               (SELECT count(*) FROM w WHERE trade <= 0),
               (SELECT max(abs(a.s - b.s)) FROM
                  (SELECT exporter_iso3, importer_iso3, year, sum(trade) s FROM f GROUP BY ALL) a
                  JOIN (SELECT exporter_iso3, importer_iso3, year, sum(trade) s FROM w GROUP BY ALL) b
                  USING (exporter_iso3, importer_iso3, year))""").fetchone()
    if wv[0] != wv[1] or wv[2]:
        fail(f"Web copy check failed: positive rows full={wv[0]:,} web={wv[1]:,}, non-positive in web={wv[2]:,}")
    done(t0, f"{mb(web)} · {wv[1]:,} rows · largest pair-year difference ${wv[3]:,}")

    # ─── 4. Lookups derived from the data ────────────────────────────────────
    t0 = step("Refreshing lookups (country_year, industry, country first/last year)")
    con.execute(f"""
        COPY (SELECT DISTINCT exporter_iso3 AS iso3, year, exporter_iso3_dynamic AS iso3_dynamic, exporter_name AS "name" FROM f
              UNION SELECT DISTINCT importer_iso3, year, importer_iso3_dynamic, importer_name FROM f
              ORDER BY iso3, year)
        TO '{out / "lookups/country_year.csv"}' (HEADER)""")
    cy_dupes = con.execute(f"""SELECT count(*) FROM (SELECT iso3, year FROM read_csv('{out / "lookups/country_year.csv"}')
                                GROUP BY ALL HAVING count(*) > 1)""").fetchone()[0]
    if cy_dupes:
        say(f"  ⚠ {cy_dupes} country-years have more than one dynamic code or name — check lookups/country_year.csv")
    con.execute(f"""
        COPY (SELECT DISTINCT industry_id, industry_descr, broad_sector FROM f ORDER BY industry_id)
        TO '{out / "lookups/industry.csv"}' (HEADER)""")
    ind_dupes = con.execute(f"""SELECT count(*) - count(DISTINCT industry_id) FROM read_csv('{out / "lookups/industry.csv"}')""").fetchone()[0]
    if ind_dupes:
        say(f"  ⚠ {ind_dupes} industry ids have more than one description — check lookups/industry.csv")
    # country.csv: refresh the data-derived columns, keep the curated ISO/UN/World Bank ones.
    con.execute(f"CREATE TABLE c_old AS FROM read_csv('{country_csv_src}', all_varchar=true)")
    con.execute(f"""
        CREATE TABLE c_new AS
        WITH yrs AS (SELECT iso3, min(year) AS first_year_in_data, max(year) AS last_year_in_data
                     FROM read_csv('{out / "lookups/country_year.csv"}') GROUP BY iso3),
             nm AS (SELECT iso3, trim(arg_max("name", year)) AS country_name
                    FROM read_csv('{out / "lookups/country_year.csv"}') GROUP BY iso3)
        SELECT c.* REPLACE (coalesce(nm.country_name, c.country_name) AS country_name,
                            coalesce(yrs.first_year_in_data::VARCHAR, c.first_year_in_data) AS first_year_in_data,
                            coalesce(yrs.last_year_in_data::VARCHAR, c.last_year_in_data) AS last_year_in_data)
        FROM c_old c LEFT JOIN yrs USING (iso3) LEFT JOIN nm USING (iso3)""")
    new_codes = [r[0] for r in con.execute(f"""
        SELECT DISTINCT iso3 FROM read_csv('{out / "lookups/country_year.csv"}')
        WHERE iso3 NOT IN (SELECT iso3 FROM c_old) ORDER BY 1""").fetchall()]
    if new_codes:
        # Add a minimal row so joins don't drop the country; regions etc. must be filled by hand.
        con.execute(f"""
            INSERT INTO c_new (iso3, country_name, iso_status, first_year_in_data, last_year_in_data, note)
            SELECT iso3, trim(arg_max("name", year)), 'NEW CODE — fill in ISO/UN/World Bank fields',
                   min(year)::VARCHAR, max(year)::VARCHAR, 'Added automatically by update_itpde.py'
            FROM read_csv('{out / "lookups/country_year.csv"}')
            WHERE iso3 IN ({", ".join(f"'{c}'" for c in new_codes)}) GROUP BY iso3""")
    con.execute(f"COPY (FROM c_new ORDER BY iso3) TO '{out / 'lookups/country.csv'}' (HEADER)")
    if out != repo:  # aggregates also need the gravity pairs next to the outputs
        shutil.copy(dgd_pair, out / "lookups/dgd_pair_year.parquet")
    done(t0, f"{len(new_codes)} new country code(s)" if new_codes else "no new country codes")

    # ─── 5. World-tab aggregates ─────────────────────────────────────────────
    t0 = step("Rebuilding World-tab aggregates")
    con.execute(f"CREATE TABLE c AS FROM read_csv('{out / 'lookups/country.csv'}')")
    con.execute(f"CREATE TABLE pr AS FROM '{out / 'lookups/dgd_pair_year.parquet'}'")
    con.execute("""
        CREATE TABLE j AS
        SELECT t.year, t.industry_id, t.broad_sector, t.industry_descr, t.exporter_iso3,
               coalesce(ec.region, 'Other') AS exporter_region, coalesce(ic.region, 'Other') AS importer_region,
               t.trade, p.agree_pta, p.distance_km
        FROM f t
        LEFT JOIN c ec ON ec.iso3 = t.exporter_iso3
        LEFT JOIN c ic ON ic.iso3 = t.importer_iso3
        LEFT JOIN pr p ON p.dynamic_code_o = t.exporter_iso3_dynamic AND p.dynamic_code_d = t.importer_iso3_dynamic AND p.year = t.year
        WHERE t.exporter_iso3 <> t.importer_iso3 AND t.trade > 0""")
    con.execute("CREATE MACRO k(x) AS CASE WHEN x IS NULL THEN NULL WHEN x < 1000 THEN x::BIGINT ELSE (round(x / 1000) * 1000)::BIGINT END")
    con.execute(f"""
        COPY (SELECT year::USMALLINT AS year, industry_id, broad_sector, industry_descr, exporter_region, importer_region,
                     k(sum(trade)) AS trade_usd,
                     k(sum(trade) FILTER (WHERE agree_pta)) AS pta_trade_usd,
                     k(sum(trade) FILTER (WHERE agree_pta IS NOT NULL)) AS pta_known_trade_usd,
                     round(sum(trade::DOUBLE * distance_km) FILTER (WHERE distance_km IS NOT NULL)
                           / nullif(sum(trade) FILTER (WHERE distance_km IS NOT NULL), 0))::INTEGER AS avg_distance_km,
                     k(sum(trade) FILTER (WHERE distance_km IS NOT NULL)) AS distance_known_trade_usd
              FROM j GROUP BY ALL ORDER BY industry_id, exporter_region, importer_region, year)
        TO '{out / 'aggregates/world_region_flows.parquet'}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19)""")
    con.execute(f"""
        COPY (SELECT year::USMALLINT AS year, industry_id, broad_sector, industry_descr, exporter_iso3, k(sum(trade)) AS trade_usd
              FROM j GROUP BY ALL ORDER BY industry_id, exporter_iso3, year)
        TO '{out / 'aggregates/world_exporters.parquet'}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19)""")
    con.execute("DROP TABLE j")
    done(t0, f"{mb(out / 'aggregates/world_region_flows.parquet')} + {mb(out / 'aggregates/world_exporters.parquet')}")

    # ─── 6. Report ───────────────────────────────────────────────────────────
    t0 = step("Summary")
    by_year = con.execute("""
        SELECT year,
               round(sum(trade) FILTER (WHERE exporter_iso3 <> importer_iso3) / 1e12, 2) AS intl_tn,
               round(sum(trade) FILTER (WHERE exporter_iso3 =  importer_iso3) / 1e12, 2) AS domestic_tn,
               count(DISTINCT exporter_iso3) FILTER (WHERE exporter_iso3 = importer_iso3 AND trade > 0) AS domestic_countries
        FROM f GROUP BY year ORDER BY year""").fetchall()
    say("  year  cross-border $T  domestic $T  countries w/ domestic data")
    for y, intl, dom, nd in by_year[-10:]:
        say(f"  {y}  {intl:>15}  {dom:>11}  {nd:>27}")
    gravity_max = con.execute("SELECT max(year) FROM pr").fetchone()[0]
    con.close()
    shutil.rmtree(tmp, ignore_errors=True)

    say("\nFiles written:")
    for rel in [FULL_PARQUET, WEB_PARQUET, "lookups/country_year.csv", "lookups/industry.csv", "lookups/country.csv",
                "aggregates/world_region_flows.parquet", "aggregates/world_exporters.parquet"]:
        say(f"  {rel:42s} {mb(out / rel)}")

    say("\nFollow-ups to check by hand:")
    todo = []
    if y1 != 2023:
        todo.append(f"Data now runs {y0}–{y1}. In givens.malloy set range_max={y1} and the default "
                    f"f'[2000 to {y1}]' for B_/C_/W_YEAR_RANGE; update '1986–2023' text in dashboard_src/ and site_assets/seo.py.")
    todo.append("Domestic sales lag the trade data (complete only through 2021 in R2025). Check the table above and, if the "
                "cut-off moved, update the `r.year <= 2021` rule in dashboard_src/tab_country.jsx and the footer note.")
    if gravity_max and y1 > gravity_max:
        todo.append(f"The gravity data (USITC Dynamic Gravity Dataset) ends in {gravity_max}; a newer DGD release is a separate update.")
    if new_codes:
        todo.append(f"New country codes {new_codes}: fill in iso2/numeric/region/etc. in lookups/country.csv.")
    todo.append("World Bank income groups (lookups/wb_income_group.csv) are a separate yearly download (OGHIST.xlsx).")
    for i, t in enumerate(todo, 1):
        say(f"  {i}. {t}")

    if args.upload:
        say(f"\nUploading to Hugging Face ({HF_REPO})…")
        from huggingface_hub import HfApi
        api = HfApi()
        for rel in [FULL_PARQUET, WEB_PARQUET, "lookups/country_year.csv", "lookups/industry.csv", "lookups/country.csv",
                    "aggregates/world_region_flows.parquet", "aggregates/world_exporters.parquet"]:
            api.upload_file(path_or_fileobj=str(out / rel), path_in_repo=rel, repo_id=HF_REPO, repo_type="dataset",
                            commit_message=f"ITPD-E refresh: {rel}")
            say(f"  ↑ {rel}")

    say("\nNext steps:")
    if not args.upload:
        say(f"  1. Upload to Hugging Face:  python3 scripts/update_itpde.py --source ... --upload   (or `hf upload {HF_REPO} ...`)")
    say("  2. Rebuild the site:        scripts/build_site.sh")
    say("  3. Publish:                 npx wrangler deploy   (and commit/push docs/ for the GitHub mirror)")
    done(t0)


if __name__ == "__main__":
    main()
