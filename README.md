<h1 align="center">starline</h1>

<p align="center">
  <strong>One terminal statusline. Every cost, every quota, across Claude Code and Codex CLI.</strong>
</p>

<p align="center">
  <em>A 3-line dashboard that shows — at every cursor tick — exactly how much you've spent today, how much quota is left in each rolling window, and what your subscription is worth in pay-as-you-go dollars.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/install-brew%20%7C%20curl-2563eb?style=for-the-badge&logo=homebrew" alt="install">
  <img src="https://img.shields.io/badge/tests-17%20passing-16a34a?style=for-the-badge" alt="tests">
  <img src="https://img.shields.io/badge/license-MIT-6b7280?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/macOS-supported-111827?style=for-the-badge&logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-supported-111827?style=for-the-badge&logo=linux" alt="Linux">
  <img src="https://img.shields.io/badge/Node-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="node">
</p>

<p align="center">
  <a href="#english">English</a>
  &nbsp;·&nbsp;
  <a href="#中文">中文 / 简体中文</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liaoruoxing/starline/issues">Issues</a>
  &nbsp;·&nbsp;
  <a href="#faq">FAQ</a>
</p>

<hr>

<a id="english"></a>

```
TODAY  Claude $12.40 · Codex $8.70  =  $21.10       30D $984 API-eq
Claude 5h 78% · 7d 63% · mo $19.5k        Codex 5h 62% · 7d 16%
Opus 4.7 · session $0.12 · 7m   ━━━━━━──────────  43% of 1M
```

<sub>↑ Quota numbers are **remaining**. Green > 50%, yellow 20–50%, red ≤ 20%. The `Codex 7d 16%` above would flash red in your terminal — "this week's Codex quota is almost gone."</sub>

---

## What is starline?

**starline is a Claude Code statusline plugin that unifies cost and quota tracking across Claude Code *and* Codex CLI in a single 3-line terminal bar.** It's built for engineers who juggle multiple AI coding sessions in parallel and need to know, without opening a dashboard, whether this week's quota will hold.

Unlike [`ccusage`](https://github.com/ryoppippi/ccusage) (which covers Claude only) or OpenAI's billing page (which only shows Codex), starline reads both `~/.claude/` and `~/.codex/sessions/` directly, normalises every event into API-equivalent dollars, and renders everything in one scannable 3-line bar.

Everything runs locally. No telemetry. No network calls except the ones `ccusage` already makes for its own price fetch.

---

## Why starline?

| You want to know                                                  | Before starline                                   | With starline              |
|-------------------------------------------------------------------|---------------------------------------------------|----------------------------|
| How much I've spent today across *all* AI coding tools            | Two tabs, manual addition                         | Line 1, always visible     |
| How much Claude 5-hour quota I have left                          | Claude Code's default tells you "used", you flip  | Line 2, shown as remaining |
| How much Codex weekly quota I have left                           | Not shown anywhere Codex-side                     | Line 2                     |
| What my Claude subscription is "worth" at pay-as-you-go pricing   | Nowhere                                           | Line 2, `mo $N` column     |
| Whether today's burn is faster than last week's                   | Guess                                             | 30-day total on Line 1     |
| Per-session, per-model cost breakdown for audit                   | `ccusage session` for Claude, nothing for Codex   | `starline explain`         |
| All of the above without a polling daemon or background service   | —                                                 | stale-while-revalidate cache, renders in ~50 ms |

---

## Install

> [!IMPORTANT]
> Requires `node >= 18`, `jq`, `bash >= 3.2`, plus [`ccusage`](https://github.com/ryoppippi/ccusage) for Claude cost totals (`npm i -g ccusage`). macOS and Linux supported. See [Requirements](#requirements) for the full list.

### Homebrew (recommended on macOS)

```bash
brew install liaoruoxing/tap/starline
starline install
```

### curl one-liner (cross-platform)

```bash
curl -fsSL https://raw.githubusercontent.com/liaoruoxing/starline/main/install.sh | bash
```

This shallow-clones starline to `~/.local/share/starline`, verifies every dependency, and patches `~/.claude/settings.json` to wire up the statusline. Re-run any time to upgrade — `install.sh` is idempotent.

### Manual (for the cautious)

```bash
git clone https://github.com/liaoruoxing/starline ~/.local/share/starline
cd ~/.local/share/starline
./bin/starline doctor    # see what's missing, if anything
./bin/starline install   # patch ~/.claude/settings.json
```

Open a fresh Claude Code session afterwards. Numbers warm up after the first cache cycle (~90 s).

---

## Requirements

| Dependency | Why | How to install |
|---|---|---|
| **node** ≥ 18 | Pure-stdlib `node:test` + ES modules + `~/.codex/sessions` parser | `brew install node` · [nodejs.org](https://nodejs.org) |
| **jq** | Atomic settings.json edits on install | `brew install jq` · `apt install jq` |
| **bash** ≥ 3.2 | The statusline itself. macOS default works | — |
| **ccusage** (optional) | Claude-side daily + 30-day totals | `npm i -g ccusage` |
| **ccusage-codex** (optional) | Codex daily + 30-day totals. If absent, starline uses its own parser | `npm i -g ccusage-codex` |

Windows is **not** supported — Claude Code's statusline hook is POSIX-only on the CLI side.

---

## How to read the statusline

```
TODAY  Claude $12.40 · Codex $8.70  =  $21.10       30D $984 API-eq
Claude 5h 78% · 7d 63% · mo $19.5k        Codex 5h 62% · 7d 16%
Opus 4.7 · session $0.12 · 7m   ━━━━━━──────────  43% of 1M
```

### Line 1 — Spend

| Segment | Meaning |
|---|---|
| `TODAY  Claude $X · Codex $Y  =  $Z` | Today's spend broken down by tool, summed on the right |
| `30D $W API-eq` | Trailing 30-day total at pay-as-you-go pricing |

"API-eq" means: *if you were on pay-as-you-go*, what the last N days would have cost. Comparing it to your subscription fee tells you how much value you're extracting.

### Line 2 — Quota (everything is *remaining*)

| Segment | Meaning |
|---|---|
| `Claude 5h N%` | Remaining quota in the last-5-hour rolling window (Anthropic's `rate_limits.five_hour`) |
| `Claude 7d N%` | Remaining quota in the last-7-day rolling window (Anthropic's `rate_limits.seven_day`) |
| `Claude mo $M` | Projection — `weekly-spend ÷ weekly-quota-used × 4`. "If I keep burning at this week's rate, this is my monthly pay-as-you-go bill." |
| `Codex 5h N%` | Same as Claude, reading Codex's `rate_limits.primary` |
| `Codex 7d N%` | Same, reading `rate_limits.secondary` |

Colour threshold:

| State | Remaining | Meaning |
|---|---|---|
| Green | > 50% | Plenty left |
| Yellow | 20 – 50% | Pace yourself |
| Red | ≤ 20% | About to throttle |

### Line 3 — Session

The model name, this session's cost and duration, then the context-window bar. The bar is coloured by **used%** (the opposite of the quota row) because "how full is my context" is a fullness question, not a remaining question.

---

## Commands

```text
starline install            Wire up ~/.claude/settings.json (idempotent).
starline uninstall          Restore previous settings.json. Keeps the repo on disk.
starline doctor             Diagnose: resolved paths, ccusage version, live sample parse.
starline explain [--today]  Per-session, per-model Codex cost breakdown (audit mode).
starline render             Render the statusline once (reads stdin JSON).
starline version            Print the installed version.
starline help               Short reference.
```

### `starline doctor` — when something looks off

Example output (truncated):

```
Environment
  · starline repo:   /home/star/.local/share/starline
  · version:         0.1.0

Required dependencies
  ✓ bash:   GNU bash, 3.2.57
  ✓ jq:     jq-1.7.1
  ✓ node:   v22.21.0

Claude-side
  ✓ ccusage: 18.0.10
  ✓ ccusage data-loader resolved

Codex-side
  ✓ Codex sessions dir: ~/.codex/sessions  (304 jsonl files in last 7d)

Live parse (last hour)
  { "costUSD": 2.9460, "perModel": { "gpt-5.4": 2.9460 }, "files": 2, "costedEvents": 37 }

Claude Code settings
  ✓ settings.json points at starline
```

### `starline explain` — audit mode

Use this when you see a number on the statusline you don't trust. It prints the exact session jsonl files, tokens used, and per-model dollars that rolled up to the total.

```
$ starline explain --today
SESSION                                                  TOTAL   BREAKDOWN
2026/04/21/rollout-…01.jsonl                           $19.06   gpt-5.4=$19.0639
2026/04/21/rollout-…b8.jsonl                            $3.35   gpt-5.4=$3.3451
2026/04/20/rollout-…f1.jsonl                           $13.69   gpt-5.4=$13.6911
…

PER-MODEL TOTAL
  gpt-5.4                            $52.37
  gpt-5.4-pro                         $8.90
------------------------------------------
  GRAND                              $61.27
```

Compare this against OpenAI's billing dashboard for the same window to sanity-check starline's pricing.

---

## How it works

```
                                 ┌─── ccusage daily --json         ┐ Claude today + 30d
                                 │                                  │
Claude Code  ──statusline.command──►  statusline.sh  ──►  ccusage data-loader    Claude 7-day window
  (stdin JSON)                   │                                  │
                                 ├─── node lib/codex_cost.mjs       ┤ Codex today + 30d + window
                                 │                                  │
                                 └─── node lib/codex_rate.mjs       ┘ Codex rate-limit snapshot

                                 (stale-while-revalidate cache at $XDG_CACHE_HOME/starline)
```

- **Claude costs** come from ccusage — the community-standard Claude usage parser. starline embeds zero pricing logic for Claude; we defer to ccusage's price source-of-truth.
- **Codex costs** are computed by starline's own parser over `~/.codex/sessions/**/*.jsonl`. ccusage does not read Codex sessions as of this writing, so this is the only way to close the loop.
- **Caching**: every expensive query is cached per day / per resets_at boundary. On read, if the cache is fresh we serve it; if stale, we fire an async refresh and still return the stale value — the statusline never blocks the prompt.
- **No daemon**. Everything runs inline with Claude Code's statusline command, usually in ~50 ms.

File layout:

```
bin/starline             — CLI dispatcher
statusline/statusline.sh — the bash renderer (the thing Claude Code invokes)
lib/
  codex_cost.mjs         — Codex jsonl → cost (pure, fully unit-tested)
  codex_rate.mjs         — Codex jsonl → rate-limit snapshot (pure, unit-tested)
  claude_window.mjs      — ccusage data-loader wrapper for 7-day window
  prices.json            — per-token prices, with source URL + verified flag
install.sh / uninstall.sh
scripts/doctor.sh scripts/explain.mjs
test/                    — node:test + fixtures
```

---

## Price transparency

`lib/prices.json` is the single source of truth for Codex-side pricing. Every model ships with a `"verified"` flag and `"updated_at"` metadata.

> [!WARNING]
> At v0.1.0 all entries are `verified: false` — the prices were imported from the legacy statusline and have **not** been cross-checked against OpenAI's pricing page on release day. starline's value is **relative trend**, not penny-accurate invoicing. For penny-accuracy, use `starline explain` and cross-check against the vendor dashboard.

**PRs updating prices.json are welcome.** The [weekly price-drift workflow](.github/workflows/price-drift.yml) will open a PR automatically when a community-maintained pricing feed becomes available.

---

<a id="faq"></a>

## FAQ

### Is starline an official Anthropic or OpenAI tool?

No. starline is an independent community tool. It reads local files that Claude Code and Codex CLI write to your home directory, and uses the community-maintained [`ccusage`](https://github.com/ryoppippi/ccusage) package for Claude price calculation. There is no affiliation with Anthropic or OpenAI.

### How is this different from ccusage?

[`ccusage`](https://github.com/ryoppippi/ccusage) is excellent for Claude-only workflows — it's where starline gets its Claude pricing from. starline extends ccusage's model across both Claude Code and Codex CLI, projects the monthly API-equivalent for subscription plans, and packages everything as a Claude Code statusline plugin.

### Does it send my data anywhere?

Only what `ccusage` itself sends (a standard per-token price fetch). All session data stays on disk. No telemetry, no analytics.

### Will it slow down Claude Code?

Typical render time is ~50 ms, backed by an on-disk stale-while-revalidate cache. The statusline never blocks on network I/O — the very first render after install may show `waiting for rate data` for one cycle while the cache fills.

### Can I use it with only Claude (no Codex) or only Codex (no Claude)?

Yes. Missing side degrades gracefully — the corresponding columns simply don't appear on the statusline.

### What does "API equivalent" mean on the 30-day line?

At the vendor's pay-as-you-go per-token rates, it's what the last 30 days of usage would have cost. Comparing this to your subscription fee tells you the dollar-value you're extracting from the subscription. Most heavy users find `API-eq / subscription-fee` between 10× and 50×.

### The monthly projection (`mo $X`) looks too high / too low. Why?

It's a linear extrapolation from the current 7-day window: `weekly-spend ÷ weekly-quota-used × 4`. If your burn is bursty (heavy one day, quiet the next), the projection overshoots early in the week and undershoots late. It's meant as a ballpark for "should I bump my plan?", not as a billing forecast.

### Why is `5h` written as `5h` and `7-day` as `7d`, not `1w`?

To match Anthropic's API field names (`rate_limits.five_hour`, `rate_limits.seven_day`) and keep the units parallel (`5h` / `7d` — both "number + unit letter"). `1w` breaks parallelism.

### Can I customise the colours or the layout?

Not via a config file yet. Starline is opinionated on v0.1 — the layout was designed by asking "what's the smallest bar that answers *'can I keep going?'* at a glance?". If you need a different layout, open an issue with your use case.

### Is there a Windows version?

No, and probably never — Claude Code's statusline hook is POSIX on the CLI side. WSL works.

### How do I update the price table?

Edit `lib/prices.json`, bump `updated_at`, flip the `verified` flag to `true` for checked models, and open a PR with a link to the vendor's pricing page.

---

## Troubleshooting

### `waiting for rate data`

The statusline couldn't find either (a) a `rate_limits.seven_day` field in the Claude Code session payload, or (b) a recent Codex token-count event with rate-limit info. Either run a quick Codex command to generate one, or wait until your Claude Code session advertises weekly quota. Run `starline doctor` to see which one is missing.

### `Claude month $0.00`

Requires `rate_limits.seven_day.resets_at` in the session payload. Fresh accounts show $0 until their first weekly quota consumption.

### Wrong cost total

Run `starline explain --today` to see the per-session breakdown. If a model shows up that you don't recognise, it's probably missing from `lib/prices.json` and silently unpriced — the `doctor` command lists any unpriced models.

### Install messed up my settings.json

Every `starline install` writes a backup to `~/.claude/settings.json.bak.<timestamp>`. Restore it:

```bash
cp ~/.claude/settings.json.bak.<timestamp> ~/.claude/settings.json
```

### Colours aren't showing

Set `TERM=xterm-256color` or use a modern terminal (iTerm2, Alacritty, Kitty, WezTerm, GNOME Terminal, VS Code integrated). The raw ANSI codes are compatible with any terminal that supports 256-colour output.

---

## Roadmap

- **v0.2** — Config file for layout, thresholds, and hidden columns
- **v0.3** — Per-project cost attribution (tag sessions with repo path)
- **v0.4** — Burn-rate warnings (`↑12% vs last week`)
- **v1.0** — Stable, community-verified price table with drift automation

---

## Contributing

PRs welcome. Repo:

```bash
git clone https://github.com/liaoruoxing/starline
cd starline
./bin/starline doctor
node --test test/*.mjs
```

- **Code style**: shell follows [Google Shell Style](https://google.github.io/styleguide/shellguide.html); JS/TS follows [Google TS Style](https://google.github.io/styleguide/tsguide.html). We run `shellcheck` (advisory) in CI.
- **Tests**: all pure functions in `lib/*.mjs` must have unit tests. New parser logic needs a fixture in `test/fixtures/`.
- **Commit messages**: conventional-commits format (`feat:`, `fix:`, `docs:`, etc.).

## Security

Found a security issue? Email the maintainer or open a private security advisory on GitHub. Please don't file public issues for vulnerabilities.

## License

MIT — see [LICENSE](./LICENSE). Do whatever you want, just don't sue me.

## Credits

- [ccusage](https://github.com/ryoppippi/ccusage) — the Claude usage parser starline leans on
- [ccstatusline](https://github.com/sirmalloc/ccstatusline) — prior art for Claude Code statuslines
- Anthropic and OpenAI for publishing the session formats that make this tool possible

<hr>

<a id="中文"></a>

# starline — 中文说明

**一行终端状态栏，把 Claude Code 和 Codex CLI 的花费、配额、剩余量全部聚合进来。**

专为同时跑多个 Claude Code + Codex 会话的工程师设计。不需要打开网页仪表盘就能知道这周的配额还够不够撑完项目。

```
TODAY  Claude $12.40 · Codex $8.70  =  $21.10       30D $984 API-eq
Claude 5h 78% · 7d 63% · mo $19.5k        Codex 5h 62% · 7d 16%
Opus 4.7 · session $0.12 · 7m   ━━━━━━──────────  43% of 1M
```

<sub>↑ 所有百分比都是**剩余**配额。绿色 > 50%，黄色 20–50%，红色 ≤ 20%。上面的 `Codex 7d 16%` 在真实终端里会飘红——"这周 Codex 快不够用了"。</sub>

---

## 这是什么？

**starline 是一个 Claude Code 状态栏插件**，把 Claude Code 和 Codex CLI 两边的成本、配额、限流状态统一渲染到一条 3 行的终端状态栏上。你在每次光标 tick 的瞬间就能看到：

- **今天花了多少**，按工具拆分（Claude / Codex 分别 + 总和）
- **还剩多少配额**（5 小时滚动窗 + 7 天滚动窗，两边工具都有）
- **订阅折合 API 等价美元是多少**（决定要不要升级订阅的关键指标）
- **当前 session 状态**（模型、花费、时长、上下文窗口）

和 [`ccusage`](https://github.com/ryoppippi/ccusage)（只覆盖 Claude）或 OpenAI 官方账单页（只显示 Codex）不同，starline 直接读 `~/.claude/` 和 `~/.codex/sessions/` 两边的本地文件，把每个事件归一化成 API 等价美元，最后渲染成一行状态栏。

**数据完全本地。无埋点。无外部请求**（除了 `ccusage` 自己为拿价格做的那一次）。

---

## 为什么用 starline？

| 你想知道什么                                    | 不用 starline                                    | 用 starline          |
|-------------------------------------------------|--------------------------------------------------|-----------------------|
| 今天在 AI 编码工具上花了多少（两边合计）        | 开两个 tab，手动加                               | 第 1 行，长驻显示     |
| Claude 5 小时配额还剩多少                       | Claude Code 默认显示的是"已用"，还要脑内反转     | 第 2 行，直接显示剩余 |
| Codex 一周配额还剩多少                          | Codex 那边压根不显示                             | 第 2 行               |
| 订阅折 API 按量付费是多少                       | 无处可查                                         | 第 2 行 `mo $N`       |
| 今天花的是不是比上周多                          | 猜                                               | 第 1 行 30 天累计      |
| 每个 session、每个模型单独的花费（审计用）      | Claude 用 `ccusage session`，Codex 没工具        | `starline explain`    |
| 以上全部，但不要轮询 daemon、不要后台服务       | —                                                | stale-while-revalidate 缓存，~50ms 渲染 |

---

## 安装

> [!IMPORTANT]
> 需要 `node >= 18`、`jq`、`bash >= 3.2`，再加 [`ccusage`](https://github.com/ryoppippi/ccusage) (`npm i -g ccusage`) 来算 Claude 费用。支持 macOS 和 Linux。

### Homebrew（macOS 推荐）

```bash
brew install liaoruoxing/tap/starline
starline install
```

### curl 一行命令（跨平台）

```bash
curl -fsSL https://raw.githubusercontent.com/liaoruoxing/starline/main/install.sh | bash
```

这行会把 starline 浅克隆到 `~/.local/share/starline`，检查依赖，然后 patch 你的 `~/.claude/settings.json`。幂等，随时重跑就是升级。

### 手动安装（保守派）

```bash
git clone https://github.com/liaoruoxing/starline ~/.local/share/starline
cd ~/.local/share/starline
./bin/starline doctor    # 看缺啥
./bin/starline install   # 改 settings.json
```

装完开一个新的 Claude Code session 就看到了。数字会在第一轮缓存（约 90 秒）之后稳定下来。

---

## 三行各显示什么

```
TODAY  Claude $12.40 · Codex $8.70  =  $21.10       30D $984 API-eq
Claude 5h 78% · 7d 63% · mo $19.5k        Codex 5h 62% · 7d 16%
Opus 4.7 · session $0.12 · 7m   ━━━━━━──────────  43% of 1M
```

### 第 1 行：花费

| 片段 | 含义 |
|---|---|
| `TODAY  Claude $X · Codex $Y  =  $Z` | 今天的花费，按工具拆、右边汇总 |
| `30D $W API-eq` | 过去 30 天按 API 按量付费折算的总花费 |

"API-eq" 的意思是：*假设你走 API 按量付费*，过去 N 天的使用会是多少钱。拿这个数除以订阅费，就是你从订阅里榨出的价值倍数。

### 第 2 行：配额（所有百分比都是**剩余**）

| 片段 | 含义 |
|---|---|
| `Claude 5h N%` | Claude 最近 5 小时滚动窗口的剩余配额（Anthropic `rate_limits.five_hour`） |
| `Claude 7d N%` | Claude 最近 7 天滚动窗口的剩余配额（Anthropic `rate_limits.seven_day`） |
| `Claude mo $M` | 月度投影——`周花费 ÷ 周已用百分比 × 4`，即"按本周节奏烧，一个月 API 按量付费要多少"|
| `Codex 5h N%` | 同 Claude，读 Codex 的 `rate_limits.primary` |
| `Codex 7d N%` | 同 Claude，读 Codex 的 `rate_limits.secondary` |

颜色阈值：

| 状态 | 剩余 | 含义 |
|---|---|---|
| 绿 | > 50% | 够用 |
| 黄 | 20–50% | 悠着点 |
| 红 | ≤ 20% | 快被限流了 |

### 第 3 行：Session

模型名、本次 session 花费和时长、上下文窗口条。进度条按**已用**着色（和配额行相反），因为"上下文多满"是个"满度"问题，不是"剩多少"问题。

---

## 命令速查

```text
starline install            改 ~/.claude/settings.json（幂等）
starline uninstall          恢复原始 settings.json，repo 留在磁盘上
starline doctor             诊断：路径、ccusage 版本、实时解析样本
starline explain [--today]  每个 session / 每个模型的花费明细（审计用）
starline render             单次渲染状态栏（读 stdin JSON）
starline version            当前版本号
starline help               帮助
```

### `starline doctor` — 状态栏不对劲时跑它

检查所有依赖的可用性、解析一小段实时数据、给你看 settings.json 到底指向哪里。80% 的"为啥不显示"问题都能从 doctor 的输出里一眼看出原因。

### `starline explain` — 审计模式

看到状态栏上一个数字觉得不对？跑这个看每个 session 的 jsonl 文件、用了多少 token、按什么模型价格算出来的每一分钱。直接对照 OpenAI 账单页就能验证。

---

## 原理

```
                                 ┌─── ccusage daily --json          ┐ Claude 今天 + 30 天
                                 │                                   │
Claude Code  ──statusline.command──►  statusline.sh  ──►  ccusage data-loader    Claude 7 天窗口
  (stdin JSON)                   │                                   │
                                 ├─── node lib/codex_cost.mjs        ┤ Codex 今天 + 30 天 + 窗口
                                 │                                   │
                                 └─── node lib/codex_rate.mjs        ┘ Codex 限流快照

                                 （磁盘缓存：$XDG_CACHE_HOME/starline，stale-while-revalidate）
```

- **Claude 费用**：调 ccusage（社区标准的 Claude 解析器）。starline 自己不维护 Claude 的价格表，都让 ccusage 负责。
- **Codex 费用**：starline 自己的 parser 直接读 `~/.codex/sessions/**/*.jsonl`。ccusage 不读 Codex，所以这一侧只能自己干。
- **缓存**：每个昂贵查询按"日期+周期"缓存。读的时候新鲜就直接返回；过期就触发异步刷新，仍返回旧值——状态栏永远不会卡。
- **没有 daemon**：全部内联在 Claude Code 的 statusline 命令里，通常 ~50ms 完成。

---

## 价格数据透明度

`lib/prices.json` 是 Codex 一侧价格的唯一真相来源。每个模型都带 `verified` 标志和 `updated_at` 元数据。

> [!WARNING]
> v0.1.0 所有条目都是 `verified: false` —— 这些价格是从旧版 statusline 直接迁移过来的，没有在发版日和 OpenAI 官方价格页重新核对过。starline 的真正价值是**趋势对比**，不是到分的账单。要到分精度请用 `starline explain` + 官方账单页交叉验证。

**欢迎提 PR 更新价格**。我配了一个每周跑的 [price-drift workflow](.github/workflows/price-drift.yml)，社区维护的价格 feed 出现后会自动开 PR。

---

## 常见问题（中文 FAQ）

### starline 是官方工具吗？

不是。starline 是社区独立工具。它只读 Claude Code 和 Codex CLI 已经写到你本地家目录的文件，通过社区维护的 [`ccusage`](https://github.com/ryoppippi/ccusage) 计算 Claude 价格。与 Anthropic 和 OpenAI 无从属关系。

### 和 ccusage 有什么区别？

`ccusage` 只管 Claude——starline 依赖它算 Claude 价格。starline 把模型扩展到了 Codex CLI，又加了订阅折 API 按量付费的月度投影，最后打包成 Claude Code 的 statusline 插件。

### 会不会上传我的数据？

只有 `ccusage` 本身会请求的价格 fetch。所有 session 数据都留在本地。无埋点、无分析。

### 会拖慢 Claude Code 吗？

典型渲染 ~50ms，后面是 stale-while-revalidate 磁盘缓存。状态栏永远不会因为网络 I/O 卡住。刚装完的第一轮可能会显示一次 `waiting for rate data`，那是缓存正在填。

### 只用 Claude 不用 Codex（或者反过来）能用吗？

能。缺的那一侧对应的列会自动不显示。

### 30 天那行的 "API equivalent" 是什么？

假设你走 API 按量付费，过去 30 天会花多少钱。拿这个数除以订阅费就是你的"订阅利用倍数"。重度用户通常在 10–50 倍之间。

### 月度投影 `mo $X` 看起来偏高 / 偏低，怎么回事？

它是按当前 7 天窗口的线性外推：`周花费 ÷ 周已用百分比 × 4`。如果你用量有突发性（一天猛烧、一天不烧），早周偏高、晚周偏低。它是给"要不要升订阅"做的 ballpark，不是账单预测。

### 为什么是 `5h` 和 `7d`，不是 `1w`？

为了和 Anthropic API 字段名对齐（`rate_limits.five_hour`、`rate_limits.seven_day`），且和 `5h` 结构统一——都是"数字+单位字母"。`1w` 打破这种对称。

### 能自定义颜色或布局吗？

v0.1 还不行。当前布局是围绕"最能一眼回答'我还能不能继续冲'的最小状态栏"设计的。有别的用例欢迎开 issue。

### 支持 Windows 吗？

不支持，且可能永远不支持——Claude Code 的 statusline hook 在 CLI 侧是 POSIX 的。WSL 可以。

---

## 疑难排查

**`waiting for rate data`**：状态栏没在 Claude Code session payload 里找到 `rate_limits.seven_day`，也没在 Codex 最近 10 天的 session 里找到带 rate_limits 的 token_count 事件。跑一条 Codex 命令就能触发一个，或者等你 Claude Code session 提示周配额后再看。

**`Claude month $0.00`**：需要 session payload 里有 `rate_limits.seven_day.resets_at`。新账号第一次消耗周配额之前一直是 $0。

**价格不对**：跑 `starline explain --today` 看明细。如果有你不认识的模型名，多半是 `lib/prices.json` 没覆盖，`doctor` 命令会列出所有未定价模型。

**install 把 settings.json 改坏了**：每次 `starline install` 都会先把原 settings.json 备份到 `~/.claude/settings.json.bak.<时间戳>`。

**没颜色**：设 `TERM=xterm-256color`，或者换个现代终端（iTerm2、Alacritty、Kitty、WezTerm、GNOME Terminal、VS Code 内置）。

---

## 路线图

- **v0.2** — 配置文件（布局、阈值、隐藏列）
- **v0.3** — 按项目归属的费用（给 session 打 repo 标签）
- **v0.4** — 烧率预警（`↑12% vs 上周`）
- **v1.0** — 稳定、社区核过的价格表 + 漂移自动同步

---

## 贡献

欢迎 PR。

```bash
git clone https://github.com/liaoruoxing/starline
cd starline
./bin/starline doctor
node --test test/*.mjs
```

- 代码风格：shell 遵循 [Google Shell Style](https://google.github.io/styleguide/shellguide.html)，JS/TS 遵循 [Google TS Style](https://google.github.io/styleguide/tsguide.html)。CI 跑 `shellcheck`（advisory）。
- 测试：`lib/*.mjs` 里所有纯函数必须有单测。新 parser 逻辑要在 `test/fixtures/` 放个 fixture。
- 提交信息：conventional commits（`feat:`、`fix:`、`docs:` 等）。

## 安全问题

发现安全漏洞？邮件联系维护者或在 GitHub 上开私有安全报告。请**不要**在公开 issue 里披露漏洞。

## 开源协议

MIT。看 [LICENSE](./LICENSE)。随便用，别告我。

## 致谢

- [ccusage](https://github.com/ryoppippi/ccusage) — starline 依赖的 Claude 用量解析器
- [ccstatusline](https://github.com/sirmalloc/ccstatusline) — Claude Code statusline 的先行者
- Anthropic 和 OpenAI，感谢他们把 session 格式开放出来，才让这种工具成为可能

<br>

<p align="center">
  <sub>
    <b>Keywords</b>:
    Claude Code statusline · Claude Code plugin · Claude Code cost tracker · Claude Code rate limit monitor ·
    Codex CLI cost · Codex CLI statusline · GPT-5 Codex tracker · ccusage alternative · ccusage companion ·
    AI CLI cost monitor · terminal statusline AI · Anthropic rate limit display · OpenAI Codex session cost ·
    Claude Code 状态栏 · Claude Code 费用 · Claude 配额监控 · Codex 成本统计 · Codex CLI 用量 ·
    AI 编程终端仪表盘 · Claude Code 插件 · Claude 订阅价值 · 多 Agent 成本监控
  </sub>
</p>
