// starline / lib / codex_cost.mjs
//
// Sum Codex CLI spend since a given epoch-second cutoff by reading
// ~/.codex/sessions/**/*.jsonl directly. No ccusage dependency for Codex
// because ccusage does not see Codex sessions today.
//
// Exported functions are pure and unit-tested in test/test_codex_cost.mjs.
// When invoked as a script (node lib/codex_cost.mjs <startEpoch>), prints
// {"costUSD": N, "skipped": {...}} to stdout.

import fs from "node:fs";
import path from "node:path";

export function loadPriceTable(tablePath) {
  const raw = JSON.parse(fs.readFileSync(tablePath, "utf8"));
  return {
    models: raw.models ?? {},
    aliases: new Map(Object.entries(raw.aliases ?? {})),
    prefixStrip: Array.isArray(raw.prefix_strip) ? raw.prefix_strip : [],
  };
}

export function resolvePrice(model, table) {
  if (model == null || model === "") return null;
  if (table.models[model] != null) return table.models[model];
  const aliased = table.aliases.get(model);
  if (aliased != null && table.models[aliased] != null) return table.models[aliased];
  for (const prefix of table.prefixStrip) {
    if (model.startsWith(prefix)) {
      const stripped = model.slice(prefix.length);
      if (table.models[stripped] != null) return table.models[stripped];
      const aliasedStripped = table.aliases.get(stripped);
      if (aliasedStripped != null && table.models[aliasedStripped] != null) {
        return table.models[aliasedStripped];
      }
    }
  }
  return null;
}

export function walkJsonl(root, sinceMs) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !full.endsWith(".jsonl")) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.mtimeMs >= sinceMs) out.push(full);
    }
  }
  return out;
}

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractModel(row) {
  return (
    row.payload?.model ??
    row.payload?.model_name ??
    row.payload?.info?.model ??
    row.payload?.info?.model_name ??
    null
  );
}

function deltaFromTotals(total, previous) {
  if (!previous) return null;
  return {
    input_tokens: (total.input_tokens ?? 0) - (previous.input_tokens ?? 0),
    cached_input_tokens: (total.cached_input_tokens ?? 0) - (previous.cached_input_tokens ?? 0),
    output_tokens: (total.output_tokens ?? 0) - (previous.output_tokens ?? 0),
    reasoning_output_tokens:
      (total.reasoning_output_tokens ?? 0) - (previous.reasoning_output_tokens ?? 0),
    total_tokens: (total.total_tokens ?? 0) - (previous.total_tokens ?? 0),
  };
}

function costForDelta(raw, price) {
  const inputTokens = Math.max((raw.input_tokens ?? 0) - (raw.cached_input_tokens ?? 0), 0);
  const cacheTokens = Math.min(raw.cached_input_tokens ?? 0, raw.input_tokens ?? 0);
  const outputTokens = Math.max(raw.output_tokens ?? 0, 0);
  let cost = 0;
  cost += (inputTokens / 1e6) * price.input;
  cost += (cacheTokens / 1e6) * price.cache;
  cost += (outputTokens / 1e6) * price.output;
  return cost;
}

export function sumSessionFile(lines, startMs, table, stats) {
  let previousTotals = null;
  let currentModel = null;
  let total = 0;
  const perModel = new Map();

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = safeParseJson(line);
    if (!row) {
      stats.parseErrors += 1;
      continue;
    }
    if (row.type === "turn_context") {
      const model = extractModel(row);
      if (model != null) currentModel = model;
      continue;
    }
    if (row.type !== "event_msg" || row.payload?.type !== "token_count") continue;

    const info = row.payload?.info ?? {};
    const totalUsage = info.total_token_usage;
    let raw = info.last_token_usage;

    if (raw == null && totalUsage != null && previousTotals != null) {
      raw = deltaFromTotals(totalUsage, previousTotals);
    }
    if (totalUsage != null) previousTotals = totalUsage;

    const tsMs = row.timestamp ? Date.parse(row.timestamp) : NaN;
    if (raw == null || !(tsMs >= startMs)) continue;

    const inTok = raw.input_tokens ?? 0;
    const cacheTok = raw.cached_input_tokens ?? 0;
    const outTok = raw.output_tokens ?? 0;
    if (inTok === 0 && cacheTok === 0 && outTok === 0) continue;

    const explicitModel = extractModel(row);
    if (explicitModel != null) currentModel = explicitModel;
    const modelKey = explicitModel ?? currentModel;
    const price = resolvePrice(modelKey, table);
    if (price == null) {
      stats.unknownModelEvents += 1;
      if (modelKey != null) stats.unknownModels.add(modelKey);
      continue;
    }

    const cost = costForDelta(raw, price);
    total += cost;
    perModel.set(modelKey, (perModel.get(modelKey) ?? 0) + cost);
    stats.costedEvents += 1;
  }

  return { total, perModel };
}

export function computeCodexCost({ sessionsRoot, startEpoch, table }) {
  if (!(startEpoch > 0)) {
    throw new Error("computeCodexCost: startEpoch must be a positive epoch-second");
  }
  const startMs = startEpoch * 1000;
  const stats = {
    files: 0,
    parseErrors: 0,
    costedEvents: 0,
    unknownModelEvents: 0,
    unknownModels: new Set(),
  };
  const perModel = new Map();
  let total = 0;

  for (const file of walkJsonl(sessionsRoot, startMs)) {
    stats.files += 1;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    const result = sumSessionFile(lines, startMs, table, stats);
    total += result.total;
    for (const [model, cost] of result.perModel) {
      perModel.set(model, (perModel.get(model) ?? 0) + cost);
    }
  }

  return {
    costUSD: total,
    perModel: Object.fromEntries(perModel),
    stats: {
      files: stats.files,
      parseErrors: stats.parseErrors,
      costedEvents: stats.costedEvents,
      unknownModelEvents: stats.unknownModelEvents,
      unknownModels: [...stats.unknownModels],
    },
  };
}

// Script entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const startEpoch = Number(process.argv[2] ?? process.env.START_EPOCH ?? 0);
    const explicitRoot = process.argv[3] ?? process.env.CODEX_SESSIONS_ROOT;
    const sessionsRoot = explicitRoot ?? path.join(process.env.HOME ?? "", ".codex", "sessions");
    const tablePath = process.env.STARLINE_PRICES ?? new URL("./prices.json", import.meta.url).pathname;

    if (!(startEpoch > 0)) {
      process.stdout.write(JSON.stringify({ costUSD: 0, error: "missing_start_epoch" }));
      process.exit(0);
    }
    if (!fs.existsSync(sessionsRoot)) {
      process.stdout.write(JSON.stringify({ costUSD: 0, stats: { files: 0 } }));
      process.exit(0);
    }

    const table = loadPriceTable(tablePath);
    const result = computeCodexCost({ sessionsRoot, startEpoch, table });
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`codex_cost: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
