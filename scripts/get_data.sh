#!/usr/bin/env bash
# Download the data files from Hugging Face into the paths the Malloy model
# reads (needed for local development: `malloyyo dashboard dev`).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${HF_BASE:-https://huggingface.co/datasets/24601p/itpde/resolve/main}"
for f in ITPD_E_R2025_usd.parquet lookups/country.csv lookups/country_successor.csv lookups/country_year.csv \
         lookups/dgd_country_year.csv lookups/dgd_pair_year.parquet lookups/flag_zero.csv lookups/industry.csv \
         lookups/wb_income_group.csv aggregates/world_region_flows.parquet aggregates/world_exporters.parquet; do
  mkdir -p "$(dirname "$f")"
  echo "↓ $f"; curl -fL --retry 3 -o "$f" "$BASE/$f"
done
