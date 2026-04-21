// starline / lib / codex_rate.mjs
//
// Snapshot Codex CLI rate-limit state from ~/.codex/sessions/**/*.jsonl.
// Codex embeds `rate_limits.primary` (5h) and `rate_limits.secondary` (7d)
// on every token_count event. We read the LATEST and compute week-relative
// deltas (today's burn, min-since-reset).
//
// Also exposes a 5h→7d burn-ratio estimator used by the statusline to
// project a rough monthly-equivalent API spend when the user is on a
// subscription (Codex Plus / Pro / Enterprise), since those subs don't
// expose a hard dollar budget.

import fs from "node:fs";
import path from "node:path";

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

export function nearReset(a, b, toleranceSeconds = 90) {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= toleranceSeconds
  );
}

export function sameLocalDay(aMs, bMs) {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function collectRows(root, sinceMs) {
  const rows = [];
  for (const file of walkJsonl(root, sinceMs)) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "event_msg" || row.payload?.type !== "token_count") continue;
      const rateLimits = row.payload?.rate_limits;
      const tsMs = row.timestamp ? Date.parse(row.timestamp) : NaN;
      if (!Number.isFinite(tsMs) || !rateLimits?.secondary) continue;
      rows.push({
        tsMs,
        primary: rateLimits.primary ?? null,
        secondary: rateLimits.secondary ?? null,
      });
    }
  }
  rows.sort((a, b) => a.tsMs - b.tsMs);
  return rows;
}

export function rateSnapshot({ sessionsRoot, lookbackDays = 10 }) {
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const rows = collectRows(sessionsRoot, cutoffMs);
  const latest = rows.at(-1);
  if (!latest?.secondary) return {};

  const currentWeek = rows.filter((row) =>
    nearReset(row.secondary?.resets_at, latest.secondary?.resets_at)
  );
  const currentWeekToday = currentWeek.filter((row) =>
    sameLocalDay(row.tsMs, latest.tsMs)
  );

  const weekPercents = currentWeek.map((row) => row.secondary?.used_percent ?? Infinity);
  const minWeekUsed = weekPercents.length ? Math.min(...weekPercents) : Infinity;
  const firstToday = currentWeekToday[0] ?? null;
  const lastToday = currentWeekToday.at(-1) ?? null;

  return {
    five_hour: latest.primary ?? null,
    seven_day: {
      used_percent: latest.secondary.used_percent ?? null,
      resets_at: latest.secondary.resets_at ?? null,
      min_used_percent: Number.isFinite(minWeekUsed) ? minWeekUsed : null,
      delta_used_percent: Number.isFinite(minWeekUsed)
        ? (latest.secondary.used_percent ?? 0) - minWeekUsed
        : null,
      today_delta_used_percent:
        firstToday && lastToday
          ? (lastToday.secondary?.used_percent ?? 0) -
            (firstToday.secondary?.used_percent ?? 0)
          : null,
    },
  };
}

export function fiveToWeekMultiplier({ sessionsRoot, lookbackDays = 14 }) {
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const rows = collectRows(sessionsRoot, cutoffMs);

  const ratios = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (!nearReset(prev.primary?.resets_at, cur.primary?.resets_at)) continue;
    if (!nearReset(prev.secondary?.resets_at, cur.secondary?.resets_at)) continue;
    const primaryDelta = (cur.primary?.used_percent ?? 0) - (prev.primary?.used_percent ?? 0);
    const weekDelta = (cur.secondary?.used_percent ?? 0) - (prev.secondary?.used_percent ?? 0);
    if (!(primaryDelta >= 5) || !(weekDelta > 0)) continue;
    ratios.push(primaryDelta / weekDelta);
  }

  ratios.sort((a, b) => a - b);
  if (!ratios.length) return {};
  const pick = (p) =>
    ratios[Math.min(ratios.length - 1, Math.floor((ratios.length - 1) * p))];

  return {
    count: ratios.length,
    p25: pick(0.25),
    median: pick(0.5),
    p75: pick(0.75),
  };
}

// Script entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const mode = process.argv[2] ?? "snapshot";
    const sessionsRoot =
      process.env.CODEX_SESSIONS_ROOT ??
      path.join(process.env.HOME ?? "", ".codex", "sessions");

    if (!fs.existsSync(sessionsRoot)) {
      process.stdout.write("{}");
      process.exit(0);
    }

    let result;
    if (mode === "multiplier") {
      result = fiveToWeekMultiplier({ sessionsRoot });
    } else {
      result = rateSnapshot({ sessionsRoot });
    }
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(`codex_rate: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
