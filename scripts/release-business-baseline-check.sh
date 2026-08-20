#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH=""
BASELINE_PATH=""

fail() {
  echo "DATABASE_BASELINE_CHECK_FAIL: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database) DATABASE_PATH="${2:-}"; shift 2 ;;
    --baseline) BASELINE_PATH="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$DATABASE_PATH" == /* && -f "$DATABASE_PATH" ]] || fail "database must be an existing absolute file"
[[ "$BASELINE_PATH" == /* && -f "$BASELINE_PATH" ]] || fail "baseline must be an existing absolute file"

count_table() {
  local table="$1"
  local exists
  exists="$(sqlite3 "file:$DATABASE_PATH?mode=ro" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")"
  [[ "$exists" == "1" ]] || { echo 0; return; }
  sqlite3 "file:$DATABASE_PATH?mode=ro" "SELECT COUNT(*) FROM $table;"
}

export DATABASE_PATH BASELINE_PATH
export ERP_SKUS_COUNT="$(count_table erp_skus)"
export SALES_OBJECTS_COUNT="$(count_table sales_objects)"
export PRODUCTS_COUNT="$(count_table products)"
export LINKS_COUNT="$(count_table sales_links)"
export DAILY_FACTS_COUNT="$(count_table connection_sku_sales_daily_facts)"

node <<'NODE'
const fs = require("fs");
const baseline = JSON.parse(fs.readFileSync(process.env.BASELINE_PATH, "utf8"));
if (baseline?.version !== 1 || typeof baseline.counts !== "object" || baseline.counts === null) {
  throw new Error("database_baseline_invalid");
}
const counts = {
  erpSkus: Number(process.env.ERP_SKUS_COUNT),
  salesObjects: Number(process.env.SALES_OBJECTS_COUNT),
  products: Number(process.env.PRODUCTS_COUNT),
  links: Number(process.env.LINKS_COUNT),
  dailyFacts: Number(process.env.DAILY_FACTS_COUNT),
};
const minimums = {
  erpSkus: 1000,
  salesObjects: 1000,
  products: 500,
  links: 1000,
  dailyFacts: 1000,
  ...(baseline.minimumCounts ?? {}),
};
const maximumDeclineRatio = Number.isFinite(Number(baseline.maximumDeclineRatio))
  ? Number(baseline.maximumDeclineRatio)
  : 0.25;
const failures = [];
for (const key of Object.keys(counts)) {
  const current = counts[key];
  const previous = Number(baseline.counts[key] ?? 0);
  const minimum = Number(minimums[key] ?? 0);
  if (current < minimum) failures.push({ code: "below_absolute_minimum", object: key, current, minimum });
  if (previous > 0 && current < previous * (1 - maximumDeclineRatio)) {
    failures.push({ code: "decline_ratio_exceeded", object: key, current, previous, maximumDeclineRatio });
  }
}
const result = {
  status: failures.length === 0 ? "ok" : "baseline_failed",
  databasePath: process.env.DATABASE_PATH,
  baselinePath: process.env.BASELINE_PATH,
  counts,
  baselineCounts: baseline.counts,
  minimumCounts: minimums,
  maximumDeclineRatio,
  failures,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (failures.length > 0) process.exit(1);
NODE
