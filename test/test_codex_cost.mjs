// starline / test / test_codex_cost.mjs
//
// Unit tests for the codex cost parser. Zero external deps — uses node:test.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  loadPriceTable,
  resolvePrice,
  sumSessionFile,
  computeCodexCost,
  walkJsonl,
} from "../lib/codex_cost.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pricesPath = path.join(here, "..", "lib", "prices.json");
const table = loadPriceTable(pricesPath);

test("resolvePrice: direct hit", () => {
  const p = resolvePrice("gpt-5-codex", table);
  assert.equal(p.input, 1.25);
  assert.equal(p.cache, 0.125);
  assert.equal(p.output, 10);
});

test("resolvePrice: openai/ prefix strip", () => {
  const p = resolvePrice("openai/gpt-5.4", table);
  assert.equal(p.input, 2.5);
  assert.equal(p.output, 15);
});

test("resolvePrice: alias gpt-5.3-chat-latest -> gpt-5", () => {
  const p = resolvePrice("gpt-5.3-chat-latest", table);
  assert.equal(p.input, 1.25);
});

test("resolvePrice: unknown model returns null", () => {
  assert.equal(resolvePrice("gpt-42-imaginary", table), null);
  assert.equal(resolvePrice(null, table), null);
  assert.equal(resolvePrice("", table), null);
});

test("sumSessionFile: costs a known model and records unknown", () => {
  const fixture = fs.readFileSync(
    path.join(here, "fixtures", "codex_sample.jsonl"),
    "utf8"
  );
  const lines = fixture.split(/\r?\n/);
  const stats = {
    parseErrors: 0,
    costedEvents: 0,
    unknownModelEvents: 0,
    unknownModels: new Set(),
  };
  const startMs = Date.parse("2026-04-21T09:00:00.000Z");
  const { total, perModel } = sumSessionFile(lines, startMs, table, stats);

  // Event 1 (gpt-5-codex): last_token_usage 1M in / 200k cached / 500k out
  //   = (800k / 1M * 1.25) + (200k / 1M * 0.125) + (500k / 1M * 10)
  //   = 1.0 + 0.025 + 5.0 = 6.025
  // Event 2 (gpt-5-codex, delta from totals): +1M in / +200k cached / +500k out
  //   = same as event 1 = 6.025
  // Event 3 (openai/gpt-5.4 via prefix strip): 100k in / 0 cached / 50k out
  //   = (100k / 1M * 2.5) + 0 + (50k / 1M * 15) = 0.25 + 0.75 = 1.0
  // Event 4 (gpt-9-unknown-future-model): SKIPPED as unknown
  // Event 5 (rate-limit only, zero tokens): costs $0.
  const expected = 6.025 + 6.025 + 1.0;
  assert.ok(Math.abs(total - expected) < 1e-6, `expected ${expected}, got ${total}`);
  assert.equal(stats.unknownModelEvents, 1);
  assert.ok(stats.unknownModels.has("gpt-9-unknown-future-model"));
  assert.ok(stats.parseErrors >= 1, "malformed line should count");
  assert.equal(stats.costedEvents, 3);
  assert.ok(perModel.has("gpt-5-codex"));
  assert.ok(perModel.has("openai/gpt-5.4"));
});

test("sumSessionFile: events before startMs are ignored", () => {
  const fixture = fs.readFileSync(
    path.join(here, "fixtures", "codex_sample.jsonl"),
    "utf8"
  );
  const lines = fixture.split(/\r?\n/);
  const stats = {
    parseErrors: 0,
    costedEvents: 0,
    unknownModelEvents: 0,
    unknownModels: new Set(),
  };
  // Cutoff AFTER every event — nothing should be counted.
  const startMs = Date.parse("2026-04-21T23:00:00.000Z");
  const { total } = sumSessionFile(lines, startMs, table, stats);
  assert.equal(total, 0);
  assert.equal(stats.costedEvents, 0);
});

test("computeCodexCost: integration over synthetic dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "starline-codex-"));
  const day = path.join(tmp, "2026", "04", "21");
  fs.mkdirSync(day, { recursive: true });
  fs.copyFileSync(
    path.join(here, "fixtures", "codex_sample.jsonl"),
    path.join(day, "rollout.jsonl")
  );
  // Touch mtime so it's captured by walkJsonl.
  const now = Date.now();
  fs.utimesSync(path.join(day, "rollout.jsonl"), now / 1000, now / 1000);

  const startEpoch = Math.floor(
    Date.parse("2026-04-21T09:00:00.000Z") / 1000
  );
  const result = computeCodexCost({
    sessionsRoot: tmp,
    startEpoch,
    table,
  });
  assert.ok(result.costUSD > 13, `expected > $13, got ${result.costUSD}`);
  assert.ok(result.costUSD < 14, `expected < $14, got ${result.costUSD}`);
  assert.equal(result.stats.files, 1);
  assert.equal(result.stats.unknownModelEvents, 1);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("walkJsonl: recurses and filters by mtime", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "starline-walk-"));
  const old = path.join(tmp, "old.jsonl");
  const fresh = path.join(tmp, "fresh", "a.jsonl");
  fs.mkdirSync(path.dirname(fresh), { recursive: true });
  fs.writeFileSync(old, "{}\n");
  fs.writeFileSync(fresh, "{}\n");

  const oldTime = Date.now() / 1000 - 86400;
  fs.utimesSync(old, oldTime, oldTime);

  const sinceMs = Date.now() - 60 * 1000; // 1 min ago
  const hits = walkJsonl(tmp, sinceMs);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].endsWith("fresh/a.jsonl"));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("computeCodexCost: throws on non-positive startEpoch", () => {
  assert.throws(() => computeCodexCost({ sessionsRoot: "/nonexistent", startEpoch: 0, table }));
  assert.throws(() => computeCodexCost({ sessionsRoot: "/nonexistent", startEpoch: -1, table }));
});
