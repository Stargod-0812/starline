// starline / scripts / price_drift_check.mjs
//
// Scheduled job: diff committed lib/prices.json against vendor-advertised
// prices. On mismatch, exits 0 after rewriting prices.json with the latest
// values and marking changed rows `verified: false` so a human reviews.
//
// This is advisory scaffolding — the real vendor fetch + parser is vendor-
// specific and must be implemented per-provider. For now the script logs
// what it would do and leaves prices.json untouched. Once endpoints exist,
// fill in fetchOpenAIPrices() etc.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pricesPath = path.join(here, "..", "lib", "prices.json");
const current = JSON.parse(fs.readFileSync(pricesPath, "utf8"));

async function fetchOpenAIPrices() {
  // Placeholder. OpenAI does not publish a stable machine-readable pricing
  // JSON as of this writing; the real implementation would scrape the
  // rendered pricing page (ugly, brittle) or use a community-maintained
  // price feed. Until one exists, humans update prices.json via PRs.
  return null;
}

const latest = await fetchOpenAIPrices();
if (!latest) {
  console.log("price_drift_check: no vendor source configured yet — noop.");
  console.log("  Fill in fetchOpenAIPrices() in scripts/price_drift_check.mjs");
  console.log("  when a machine-readable feed is available.");
  process.exit(0);
}

let changed = 0;
const next = { ...current, models: { ...current.models } };
for (const [model, newPrice] of Object.entries(latest)) {
  const oldPrice = next.models[model];
  if (!oldPrice) {
    next.models[model] = { ...newPrice, verified: false };
    changed += 1;
    console.log(`+ added model: ${model}`);
    continue;
  }
  const diff = ["input", "cache", "output"].some(
    (k) => Math.abs((oldPrice[k] ?? 0) - (newPrice[k] ?? 0)) > 1e-9
  );
  if (diff) {
    next.models[model] = { ...newPrice, verified: false };
    changed += 1;
    console.log(`~ updated model: ${model}`);
  }
}

if (changed > 0) {
  next.updated_at = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(pricesPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`price_drift_check: rewrote prices.json (${changed} change(s)).`);
} else {
  console.log("price_drift_check: no drift.");
}
