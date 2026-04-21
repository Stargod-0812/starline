// starline / test / test_codex_rate.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  nearReset,
  sameLocalDay,
  rateSnapshot,
  fiveToWeekMultiplier,
} from "../lib/codex_rate.mjs";

test("nearReset: tolerates small drift", () => {
  assert.ok(nearReset(1_745_846_400, 1_745_846_450));
  assert.ok(nearReset(1_745_846_400, 1_745_846_400));
});

test("nearReset: rejects large drift", () => {
  assert.equal(nearReset(1_745_846_400, 1_745_846_600), false);
});

test("nearReset: handles NaN / non-finite", () => {
  assert.equal(nearReset(NaN, 1), false);
  assert.equal(nearReset(1, undefined), false);
  assert.equal(nearReset(null, 1), false);
});

test("sameLocalDay: true for same local date", () => {
  const a = new Date(2026, 3, 21, 1, 0, 0).getTime();
  const b = new Date(2026, 3, 21, 23, 0, 0).getTime();
  assert.ok(sameLocalDay(a, b));
});

test("sameLocalDay: false across midnight", () => {
  const a = new Date(2026, 3, 20, 23, 0, 0).getTime();
  const b = new Date(2026, 3, 21, 1, 0, 0).getTime();
  assert.equal(sameLocalDay(a, b), false);
});

function writeFixture(root, dayPath, lines, mtime) {
  const full = path.join(root, ...dayPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (mtime) fs.utimesSync(full, mtime / 1000, mtime / 1000);
  return full;
}

test("rateSnapshot: empty dir returns {}", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "starline-rate-empty-"));
  const snap = rateSnapshot({ sessionsRoot: tmp });
  assert.deepEqual(snap, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("rateSnapshot: extracts latest and week-min", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "starline-rate-"));
  const now = Date.now();
  const weekResetAt = Math.floor(now / 1000) + 86400;

  const mkRow = (minutesAgo, primaryPct, weekPct) => ({
    timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        primary: { used_percent: primaryPct, resets_at: Math.floor(now / 1000) + 3600 },
        secondary: { used_percent: weekPct, resets_at: weekResetAt },
      },
    },
  });

  writeFixture(tmp, ["session.jsonl"], [
    mkRow(300, 10, 20),
    mkRow(200, 30, 30),
    mkRow(100, 60, 45),
    mkRow(10,  80, 55),
  ], now);

  const snap = rateSnapshot({ sessionsRoot: tmp });
  assert.equal(snap.seven_day.used_percent, 55);
  assert.equal(snap.seven_day.min_used_percent, 20);
  assert.equal(snap.seven_day.delta_used_percent, 35);
  assert.equal(snap.five_hour.used_percent, 80);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("fiveToWeekMultiplier: empty dir returns {}", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "starline-mult-"));
  const result = fiveToWeekMultiplier({ sessionsRoot: tmp });
  assert.deepEqual(result, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});
