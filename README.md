# starline

**Claude Code + Codex cost & quota statusline.** One 4-line bar at the bottom of every Claude Code session that tells you, at a glance:

- what you've spent today and this month across *both* tools
- how much 5-hour and weekly quota is left on each
- what your Claude subscription is worth in pay-as-you-go dollars right now
- current session model, burn, and context window

Built for engineers who run Claude Code and Codex in parallel sessions and want to know, without opening a browser, whether this week's quota will hold.

```
TODAY  · Claude $12.40 · Codex $8.70   =  $21.10
30 DAY · Claude $512.80 · Codex $471.20   =  $984.00  API equivalent
QUOTA  · Claude 5h 22% · Codex 5h 38% · Claude 1w 63% · Codex 1w 84% · Claude month $19.5k
Opus 4.7 · session $0.12 · 7m   ━━━━━━──────────  43%  of 1M
```

---

## Why

`ccusage` shows you Claude spend. Nothing reads Codex sessions. Neither shows the two together, and neither projects "what would this subscription cost me on pay-as-you-go?" — which is the actual question when you're deciding whether to bump a plan or throttle your own usage.

starline reads `~/.codex/sessions/*.jsonl` directly, reuses `ccusage`'s data loader for Claude, and normalizes both into API-equivalent dollars. All data stays on disk; no telemetry, no network calls except ccusage's standard price fetch.

---

## Install

Two ways. Pick one.

### Homebrew (recommended on macOS)

```bash
brew install liaoruoxing/tap/starline
starline install
```

### curl one-liner

```bash
curl -sSL https://raw.githubusercontent.com/liaoruoxing/starline/main/install.sh | bash
```

This clones the repo to `~/.local/share/starline`, verifies dependencies, and patches `~/.claude/settings.json`. Re-run any time to upgrade — `install.sh` is idempotent.

Open a new Claude Code session afterwards. The statusline appears at the bottom. Numbers warm up after the first cache cycle (~90s).

---

## Requirements

- **node** >= 18 (built-in `node:test`)
- **jq** (JSON editing on install)
- **bash** 3.2+ (macOS default works)
- **ccusage** for Claude-side cost data: `npm i -g ccusage`
- **ccusage-codex** (optional) — if absent, starline parses `~/.codex/sessions/*.jsonl` directly

Works on macOS and Linux. Windows not supported (Claude Code statusline is POSIX-only in the CLI).

---

## The four lines, annotated

| Line | Content | Source |
|------|---------|--------|
| 1 | Today's Claude + Codex spend, separate and summed | `ccusage daily` + direct Codex jsonl parse |
| 2 | Trailing 30-day Claude + Codex spend, labelled "API equivalent" | same, 30-day window |
| 3 | `Claude 5h` / `Codex 5h` remaining, `1w` remaining, projected monthly Claude API cost | Claude Code session payload + Codex `rate_limits` on every event |
| 4 | Session model · session cost · session duration · context-window bar | Claude Code session payload (stdin) |

**"API equivalent" means**: if you were paying pay-as-you-go at the vendor's per-token rates, this is what the last N days would have cost. Measured against your Claude/Codex subscription, it's the concrete dollar-value you're getting.

**"Claude month $X"** is `current-week spend ÷ current-week quota-used × 4`. It's a linear extrapolation, not a forecast — assumes you keep burning at your current 7-day rate.

---

## Commands

```
starline install            Wire up ~/.claude/settings.json (idempotent).
starline uninstall          Remove from settings.json. Backs up first.
starline doctor             Diagnose. Shows resolved paths, sample parse, warnings.
starline explain [--today]  Per-session, per-model cost audit breakdown.
starline render             Render the statusline once (reads stdin JSON).
starline version            Print the installed version.
```

All commands exit non-zero on hard failure. Diagnostic output is stable to grep.

---

## `starline explain` — audit mode

```
$ starline explain --today
starline explain — Codex cost breakdown
  since:   2026-04-21T00:00:00.000Z
  root:    /home/star/.codex/sessions

SESSION                          TOTAL   BREAKDOWN
2026/04/21/rollout-…19daef6.jsonl  $19.06  gpt-5.4=$19.0639
2026/04/21/rollout-…19daec9.jsonl   $3.35  gpt-5.4=$3.3451
…

PER-MODEL TOTAL
  gpt-5.4                          $52.37
  gpt-5.4-pro                       $8.90
------------------------------------------
  GRAND                            $61.27
```

Use this when you want to cross-check starline's totals against the OpenAI usage dashboard. The per-session, per-model dollars are computed the same way the statusline computes them — just un-aggregated.

---

## Price table honesty

`lib/prices.json` is the single source of truth for Codex-side per-token pricing. Every model ships with `"verified": true | false`. At v0.1.0 all entries are `verified: false` — they were imported from the legacy statusline and have *not* been cross-checked against OpenAI's pricing page on release day.

starline's value is **relative trend** (is this week burning faster than last week?), not **penny-accurate invoicing**. If you need the latter, cross-check the vendor's dashboard; `starline explain` is the tool for that.

**PRs updating prices.json are welcome.** Fill in `verified: true`, bump `updated_at`, and add the vendor-page URL to the PR description. A GitHub Action runs weekly and opens a PR when vendor pricing drifts from the committed table.

---

## How it works

```
Claude Code
     │
     │  statusline.command  (settings.json)
     ▼
statusline/statusline.sh
     │
     ├── ccusage daily --json                   → Claude today / 30d totals
     ├── node lib/claude_window.mjs <epoch>     → Claude weekly window (ccusage loader)
     ├── node lib/codex_cost.mjs  <epoch>       → direct Codex jsonl parse
     └── node lib/codex_rate.mjs  snapshot      → Codex rate-limit snapshot

Caching:  ${XDG_CACHE_HOME:-~/.cache}/starline/*.json
          stale-while-revalidate — prompt never blocks on I/O
          90s TTL for "today" queries, 10m TTL for 30-day, 5m for windowed
```

### Why bash + Node and not a single runtime?

Claude Code invokes `statusline.command` *on every cursor tick* — anything that takes more than ~200ms makes the UI feel sluggish. Bash spawns cheaply; Node's jsonl parser is fast enough. The hot path is entirely cached data reads; cold paths happen in a detached background subshell.

### Why not ship a single binary?

Codex's jsonl format is a moving target. Keeping the parser in readable `.mjs` means "weird total today" is a `node lib/codex_cost.mjs $(date +%s -d '1 hour ago')` away from understanding, not an opaque binary.

---

## Troubleshooting

**`waiting for rate data`**: your Claude Code session hasn't exposed `rate_limits.seven_day` yet, and starline hasn't captured a Codex token-count event in the last 10 days. Run a one-line Codex command to kick off a session; within a minute the numbers appear. If not, `starline doctor` explains why.

**`Claude month $0.00`**: the Claude weekly-window cost calc requires `rate_limits.seven_day.resets_at` in the session payload, which is only present once you have an active weekly quota. Fresh accounts show $0 until first quota consumption.

**Wrong total dollar amount**: see "Price table honesty" above. Run `starline explain` to see the breakdown and file a PR updating prices.json.

**Rendering without colour**: your terminal has `TERM=dumb` or no 256-color support. Not currently configurable; open an issue.

**Install broke my settings.json**: every install writes a backup at `~/.claude/settings.json.bak.<timestamp>`. Restore it if needed.

---

## Contributing

- Report bugs + open PRs at https://github.com/liaoruoxing/starline
- Run tests: `node --test test/*.mjs`
- Lint (local, optional): `shellcheck statusline/statusline.sh install.sh uninstall.sh bin/starline scripts/doctor.sh`

### Development

```bash
git clone https://github.com/liaoruoxing/starline
cd starline
./bin/starline doctor        # sanity-check your env
node --test test/*.mjs       # unit + integration tests
echo '{"model":{"display_name":"Opus"}}' | ./statusline/statusline.sh   # smoke render
```

### Price-table updates

Edit `lib/prices.json`. Set `updated_at` to today, flip the affected models' `verified: true`, reference the vendor pricing URL in your PR description. The weekly price-drift job will nag until this is done for major vendor price changes.

---

## License

MIT. See [LICENSE](./LICENSE).
