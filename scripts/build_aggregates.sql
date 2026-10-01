-- Pre-aggregated tables for the World tab (run from the repo root:
--   duckdb < scripts/build_aggregates.sql
-- needs the full data from scripts/get_data.sh). Cross-border flows with
-- positive trade only; money rounded to the nearest $1,000 (values under
-- $1,000 kept exact), like the web copy of the trade table.
SET threads=8;
CREATE TEMP TABLE c AS FROM read_csv('lookups/country.csv');
CREATE TEMP TABLE pr AS FROM 'lookups/dgd_pair_year.parquet';
CREATE TEMP TABLE j AS
  SELECT t.year, t.industry_id, t.broad_sector, t.industry_descr, t.exporter_iso3,
         coalesce(ec.region, 'Other') AS exporter_region, coalesce(ic.region, 'Other') AS importer_region,
         t.trade, p.agree_pta, p.distance_km
  FROM 'ITPD_E_R2025_usd.parquet' t
  LEFT JOIN c ec ON ec.iso3 = t.exporter_iso3
  LEFT JOIN c ic ON ic.iso3 = t.importer_iso3
  LEFT JOIN pr p ON p.dynamic_code_o = t.exporter_iso3_dynamic AND p.dynamic_code_d = t.importer_iso3_dynamic AND p.year = t.year
  WHERE t.exporter_iso3 <> t.importer_iso3 AND t.trade > 0;
CREATE MACRO k(x) AS CASE WHEN x IS NULL THEN NULL WHEN x < 1000 THEN x::BIGINT ELSE (round(x / 1000) * 1000)::BIGINT END;
-- Region-to-region flows by year and industry, with trade-agreement and distance pieces.
COPY (
  SELECT year::USMALLINT AS year, industry_id, broad_sector, industry_descr, exporter_region, importer_region,
         k(sum(trade)) AS trade_usd,
         k(sum(trade) FILTER (WHERE agree_pta)) AS pta_trade_usd,
         k(sum(trade) FILTER (WHERE agree_pta IS NOT NULL)) AS pta_known_trade_usd,
         round(sum(trade::DOUBLE * distance_km) FILTER (WHERE distance_km IS NOT NULL)
               / nullif(sum(trade) FILTER (WHERE distance_km IS NOT NULL), 0))::INTEGER AS avg_distance_km,
         k(sum(trade) FILTER (WHERE distance_km IS NOT NULL)) AS distance_known_trade_usd
  FROM j GROUP BY ALL ORDER BY industry_id, exporter_region, importer_region, year
) TO 'aggregates/world_region_flows.parquet' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19);
-- Cross-border exports by exporting country, year and industry.
COPY (
  SELECT year::USMALLINT AS year, industry_id, broad_sector, industry_descr, exporter_iso3, k(sum(trade)) AS trade_usd
  FROM j GROUP BY ALL ORDER BY industry_id, exporter_iso3, year
) TO 'aggregates/world_exporters.parquet' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19);
