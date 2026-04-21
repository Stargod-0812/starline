// starline / lib / claude_window.mjs
//
// Sum Claude Code spend inside a sliding window (typically the last 7 days,
// aligned to the user's rate-limit reset) by driving ccusage's internal
// data loader. This lets us project a "monthly API-equivalent cost" for
// the subscription — users pay a flat fee, but we show what it would cost
// on pay-as-you-go so the value is measurable against the bill.
//
// Requires ccusage installed globally (npm i -g ccusage). We locate its
// data-loader via $CCUSAGE_LOADER so users can override on non-standard
// node installs (nvm, volta, pnpm).
//
// CRITICAL: ccusage's internal logger writes `[ccusage] ℹ Loaded pricing...`
// to STDOUT when it fetches the latest LiteLLM price feed. If we emit that
// alongside our JSON, the bash caller's `jq -e .` validation fails and the
// statusline silently falls back to --offline mode, which uses stale embedded
// prices that are missing newer Anthropic models (Opus 4.7 1M, etc.) and
// undercount the real cost by up to 60%. Force LOG_LEVEL=0 before ccusage
// loads to keep stdout clean.
if (process.env.LOG_LEVEL === undefined) process.env.LOG_LEVEL = "0";

import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";

export async function claudeWindowCost({ startEpoch, offline = false, loaderPath }) {
  if (!loaderPath) throw new Error("claudeWindowCost: loaderPath is required");
  if (!(startEpoch > 0)) throw new Error("claudeWindowCost: startEpoch must be > 0");

  const m = await import(loaderPath);
  const filesWithBase = await m.u(m.pt(m.s()));
  const fetcher = new m.A(offline);
  const processed = new Set();
  const startMs = startEpoch * 1000;
  let total = 0;

  for (const { file } of filesWithBase) {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (!data?.timestamp || !data?.message?.usage) continue;
      const hash = m.i(data);
      if (processed.has(hash)) continue;
      processed.add(hash);
      if (new Date(data.timestamp).getTime() < startMs) continue;
      total += await m.r(data, "auto", fetcher);
    }
  }

  return total;
}

export function resolveLoaderPath() {
  if (process.env.CCUSAGE_LOADER) return process.env.CCUSAGE_LOADER;
  const candidates = [
    path.join(process.env.HOME ?? "", ".npm-global/lib/node_modules/ccusage/dist"),
    "/usr/local/lib/node_modules/ccusage/dist",
    "/opt/homebrew/lib/node_modules/ccusage/dist",
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((name) => name.startsWith("data-loader-") && name.endsWith(".js"));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// Script entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const startEpoch = Number(process.argv[2] ?? process.env.START_EPOCH ?? 0);
    const offline = (process.argv[3] ?? process.env.OFFLINE ?? "0") === "1";
    const loaderPath = process.env.CCUSAGE_LOADER || resolveLoaderPath();

    if (!loaderPath) {
      process.stderr.write("claude_window: ccusage data-loader not found. Install ccusage (npm i -g ccusage) or set CCUSAGE_LOADER=/path/to/data-loader-*.js\n");
      process.exit(1);
    }
    if (!(startEpoch > 0)) {
      process.stdout.write(JSON.stringify({ totalCost: 0, error: "missing_start_epoch" }));
      process.exit(0);
    }

    const total = await claudeWindowCost({ startEpoch, offline, loaderPath });
    process.stdout.write(JSON.stringify({ totalCost: total }));
  } catch (err) {
    process.stderr.write(`claude_window: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
