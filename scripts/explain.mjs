// starline explain — per-session, per-model breakdown for audit.
//
// When a user says "wait, why did you say I spent $837 today?", this is how
// they check. Prints a table of sessions contributing non-zero cost, with
// token deltas and $-per-model, so the user can cross-check against the
// vendor billing dashboard.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPriceTable,
  walkJsonl,
  sumSessionFile,
} from "../lib/codex_cost.mjs";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function startOfLocalDayEpoch() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

function formatUSD(v) {
  return `$${v.toFixed(4)}`;
}

async function main() {
  const sessionsRoot =
    arg("--root") ??
    process.env.CODEX_SESSIONS_ROOT ??
    path.join(process.env.HOME ?? "", ".codex", "sessions");

  const since =
    arg("--since-epoch") != null
      ? Number(arg("--since-epoch"))
      : process.argv.includes("--today")
      ? startOfLocalDayEpoch()
      : Math.floor(Date.now() / 1000) - 24 * 3600;

  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const tablePath =
    arg("--prices") ?? process.env.STARLINE_PRICES ?? path.join(hereDir, "..", "lib", "prices.json");

  if (!fs.existsSync(sessionsRoot)) {
    console.log(`No Codex sessions dir: ${sessionsRoot}`);
    process.exit(0);
  }
  const table = loadPriceTable(tablePath);
  const startMs = since * 1000;

  console.log(`starline explain — Codex cost breakdown`);
  console.log(`  since:   ${new Date(startMs).toISOString()} (epoch ${since})`);
  console.log(`  root:    ${sessionsRoot}`);
  console.log(`  prices:  ${tablePath}`);
  console.log("");

  const rowsOut = [];
  let grand = 0;
  const grandPerModel = new Map();
  const stats = {
    parseErrors: 0,
    costedEvents: 0,
    unknownModelEvents: 0,
    unknownModels: new Set(),
  };

  for (const file of walkJsonl(sessionsRoot, startMs)) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const result = sumSessionFile(content.split(/\r?\n/), startMs, table, stats);
    if (result.total > 0) {
      rowsOut.push({ file: path.relative(sessionsRoot, file), total: result.total, perModel: result.perModel });
      grand += result.total;
      for (const [m, c] of result.perModel) {
        grandPerModel.set(m, (grandPerModel.get(m) ?? 0) + c);
      }
    }
  }

  rowsOut.sort((a, b) => b.total - a.total);

  if (!rowsOut.length) {
    console.log("(no Codex spend in this window)");
  } else {
    const maxFile = Math.max(...rowsOut.map((r) => r.file.length), 4);
    console.log("SESSION".padEnd(maxFile) + "   " + "TOTAL".padStart(10) + "   BREAKDOWN");
    for (const row of rowsOut) {
      const models = [...row.perModel.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([m, c]) => `${m}=${formatUSD(c)}`)
        .join(", ");
      console.log(`${row.file.padEnd(maxFile)}   ${formatUSD(row.total).padStart(10)}   ${models}`);
    }
  }

  console.log("");
  console.log("PER-MODEL TOTAL");
  for (const [model, cost] of [...grandPerModel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model.padEnd(24)} ${formatUSD(cost).padStart(12)}`);
  }
  console.log("-".repeat(42));
  console.log(`  ${"GRAND".padEnd(24)} ${formatUSD(grand).padStart(12)}`);

  if (stats.unknownModelEvents > 0) {
    console.log("");
    console.log(`Skipped ${stats.unknownModelEvents} event(s) from unpriced models:`);
    for (const m of stats.unknownModels) console.log(`  - ${m}`);
    console.log("(Add them to lib/prices.json to include these in the total.)");
  }
  if (stats.parseErrors > 0) {
    console.log("");
    console.log(`Skipped ${stats.parseErrors} unparseable line(s) across sessions.`);
  }
}

main().catch((err) => {
  process.stderr.write(`explain: ${err?.message ?? err}\n`);
  process.exit(1);
});
