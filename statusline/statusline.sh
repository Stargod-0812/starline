#!/usr/bin/env bash
# starline — Claude Code + Codex cost & quota statusline.
#
# 4 lines:
#   1. TODAY  — today's Claude + Codex spend (API-equivalent dollars)
#   2. 30 DAY — trailing 30-day spend
#   3. QUOTA  — 5h / 1w usage for Claude + Codex, projected monthly
#   4. SESSION — current session model, cost, duration, context-bar
#
# Called by Claude Code via settings.json `statusLine.command`.
# Reads the session JSON passed on stdin.

set -u -o pipefail

input=$(cat)

STARLINE_ROOT="${STARLINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STARLINE_LIB="${STARLINE_LIB:-$STARLINE_ROOT/lib}"
STARLINE_CACHE="${STARLINE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/starline}"
mkdir -p "$STARLINE_CACHE"

# Binaries — resolved once at top, overridable for non-standard node installs.
CCUSAGE_BIN="${CCUSAGE_BIN:-$(command -v ccusage || true)}"
CODEX_USAGE_BIN="${CODEX_USAGE_BIN:-$(command -v ccusage-codex || true)}"

# Colors (tput-compatible ANSI). Keep definitions inline so the script has
# zero sourcing dependencies and renders the same in every terminal.
RS='\033[0m'; DM='\033[2m'; BD='\033[1m'; WH='\033[97m'
# Status colours — 256-colour bright variants chosen to stay clearly distinct
# from the Claude orange (214) and Codex blue (39) brand colours below.
# Using the standard 8-colour green/yellow/red (32/33/31) makes the yellow
# read as olive and collide visually with the orange brand label.
GN='\033[38;5;82m'   # lime green — for "plenty remaining"
YL='\033[38;5;220m'  # bright gold yellow — "pace yourself"
RD='\033[38;5;196m'  # saturated red — "about to throttle"
CA='\033[38;5;214m'  # Claude orange
CB='\033[38;5;39m'   # Codex blue
S="$DM · $RS"

if [ "${STARLINE_CAPTURE_HOOK:-0}" = "1" ]; then
  printf '%s' "$input" > "$STARLINE_CACHE/last-input.json"
fi

# -- helpers ---------------------------------------------------------------

_resolve_timeout_cmd() {
  if command -v timeout >/dev/null 2>&1; then
    echo "timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    echo "gtimeout"
  elif command -v perl >/dev/null 2>&1; then
    echo "perl"
  else
    echo "none"
  fi
}
STARLINE_TIMEOUT_CMD="$(_resolve_timeout_cmd)"

timed_eval() {
  local seconds="$1" cmd="$2"
  case "$STARLINE_TIMEOUT_CMD" in
    timeout|gtimeout) "$STARLINE_TIMEOUT_CMD" "$seconds" bash -lc "$cmd" ;;
    perl) perl -e 'alarm shift; exec @ARGV' "$seconds" bash -lc "$cmd" ;;
    none) bash -lc "$cmd" ;;
  esac
}

json_value() {
  local payload="$1" expr="$2" fallback="$3" value
  value=$(printf '%s' "$payload" | jq -r "$expr // $fallback" 2>/dev/null | head -n 1)
  if [ -n "$value" ]; then printf '%s' "$value"; else printf '%s' "$fallback"; fi
}

valid_json() { printf '%s' "$1" | jq -e . >/dev/null 2>&1; }

mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }

run_json() {
  # 180s timeout accommodates ccusage cold-start on heavy users (first
  # LiteLLM price fetch + scanning tens of thousands of jsonl lines can
  # take 60-90s). run_json is ONLY ever called from refresh_cache_async,
  # so it runs in a detached background subshell — the statusline render
  # itself never blocks on this timeout.
  local primary="$1" fallback="$2" out="" timeout="${STARLINE_REFRESH_TIMEOUT:-180}"
  out=$(timed_eval "$timeout" "$primary" 2>/dev/null || true)
  if [ -n "$out" ] && valid_json "$out"; then printf '%s' "$out"; return; fi
  out=$(timed_eval "$timeout" "$fallback" 2>/dev/null || true)
  if [ -n "$out" ] && valid_json "$out"; then printf '%s' "$out"; return; fi
  return 1
}

# Stale-while-revalidate cache. On hit returns cached value; on stale kicks
# off a background refresh and still returns the stale value, so the shell
# prompt never blocks on network calls. Hard TTL (5 × soft TTL) forces a
# blocking refresh to bound staleness.
refresh_cache_async() {
  local file="$1" lock="$2" primary="$3" fallback="$4" stale_lock_secs="${5:-300}"
  if [ -f "$lock" ] && [ $(( $(date +%s) - $(mtime "$lock") )) -ge "$stale_lock_secs" ]; then
    rm -f "$lock"
  fi
  [ -f "$lock" ] && return
  : > "$lock"
  # `disown` + stdout/stderr to /dev/null + stdin from /dev/null keeps the
  # background worker fully detached so bash's `$(...)` command substitution
  # in gc_json returns as soon as the worker forks — the statusline command
  # never blocks waiting for ccusage / node to complete.
  (
    trap 'rm -f "$lock"' EXIT
    local out
    out=$(run_json "$primary" "$fallback")
    # Only write the cache if we got a non-empty, valid JSON with actual
    # content. A partial / timed-out ccusage run that yields
    # `{"totalCost":0}` for a user who actually spent hundreds today is
    # worse than no cache — skip the write, next tick retries.
    if valid_json "$out" && [ "$(printf '%s' "$out" | tr -d '[:space:]')" != '{}' ]; then
      printf '%s' "$out" > "$file"
    fi
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

gc_json() {
  local key="$1" ttl="$2" primary="$3" fallback="$4" file lock now out age stale_lock_secs hard_ttl
  file="$STARLINE_CACHE/$key"
  lock="${file}.lock"
  now=$(date +%s)
  stale_lock_secs=$(( ttl > 300 ? ttl : 300 ))
  hard_ttl=$(( ttl * 5 ))
  [ "$hard_ttl" -lt 300 ] && hard_ttl=300

  if [ -f "$lock" ] && [ $((now - $(mtime "$lock"))) -ge "$stale_lock_secs" ]; then
    rm -f "$lock"
  fi

  # Cache HIT — return the cached value immediately. If stale (past soft TTL
  # but under hard TTL), kick off a background refresh. If blown past hard
  # TTL, *still* return the stale value synchronously and refresh in the
  # background — never block the statusline render on network I/O, even on
  # a very stale cache. The previous sync-refresh-on-hard-ttl path could
  # stall for tens of seconds on a ccusage cold start and make Claude Code
  # time out the entire statusline command (user sees an empty bar).
  if [ -f "$file" ]; then
    age=$((now - $(mtime "$file")))
    if [ "$age" -ge "$ttl" ]; then
      refresh_cache_async "$file" "$lock" "$primary" "$fallback" "$stale_lock_secs"
    fi
    cat "$file"; return
  fi

  # Cache MISS — this is the cold-start / new-window path. Never block here
  # either. Fire the refresh into the background and return an empty JSON
  # object so the render completes in milliseconds. The next tick (cursor
  # move, model response, timer) will read the now-populated cache.
  refresh_cache_async "$file" "$lock" "$primary" "$fallback" "$stale_lock_secs"
  printf '{}'
}

# -- formatting helpers ----------------------------------------------------

money_sum() {
  awk -v a="${1:-0}" -v b="${2:-0}" 'BEGIN { printf "%.2f", (a + 0) + (b + 0) }'
}

money_project_periods() {
  awk -v used="${1:-0}" -v pct="${2:-0}" -v periods="${3:-1}" 'BEGIN {
    if ((pct + 0) <= 0) printf "0.00";
    else printf "%.2f", (((used + 0) * 100) / (pct + 0)) * (periods + 0);
  }'
}

f() { printf '$%.2f' "${1:-0}"; }

fshort() {
  awk -v v="${1:-0}" 'BEGIN {
    abs = (v < 0 ? -v : v);
    if (abs >= 1000000) printf "$%.1fm", v / 1000000;
    else if (abs >= 1000) printf "$%.1fk", v / 1000;
    else printf "$%.2f", v;
  }'
}

is_positive() { awk -v v="${1:-0}" 'BEGIN { exit !((v + 0) > 0) }'; }

fd() {
  local ms="${1:-0}" s h m
  s=$((ms / 1000)); h=$((s / 3600)); m=$(((s % 3600) / 60))
  [ "$h" -gt 0 ] && { printf '%dh%dm' "$h" "$m"; return; }
  [ "$m" -gt 0 ] && { printf '%dm' "$m"; return; }
  printf '%ds' "$s"
}

cc() { [ "${1:-0}" -lt 50 ] && echo "$GN" || { [ "${1:-0}" -lt 80 ] && echo "$YL" || echo "$RD"; }; }

# cc_left: colour a quota-remaining percentage. > 50 green, > 20 yellow, else red.
# Mirror of cc() but inverted for "left" semantics (the higher the better).
cc_left() { [ "${1:-0}" -gt 50 ] && echo "$GN" || { [ "${1:-0}" -gt 20 ] && echo "$YL" || echo "$RD"; }; }

bar() {
  local p="${1:-0}" fl em i
  [ "$p" -lt 0 ] && p=0; [ "$p" -gt 100 ] && p=100
  fl=$((p * 16 / 100)); em=$((16 - fl))
  printf '%b' "$(cc "$p")"
  for ((i = 0; i < fl; i++)); do printf '━'; done
  printf '%b' "$DM"
  for ((i = 0; i < em; i++)); do printf '─'; done
  printf '%b' "$RS"
}

# -- data fetch ------------------------------------------------------------

TD=$(date +%Y%m%d)
D30=$(date -v-30d +%Y%m%d 2>/dev/null || date -d '30 days ago' +%Y%m%d 2>/dev/null)

# Graceful degradation when ccusage is missing: still render quota + session.
#
# IMPORTANT: never fall back to `ccusage --offline`. Its embedded price table
# ships with whatever ccusage release the user installed; new Anthropic /
# OpenAI models (Opus 4.7, newer Sonnet/Haiku, GPT-5.x) are priced at ~0 in
# that table and undercount real usage by 50×–150×. If the online fetch
# fails, poison cache with the wrong number is strictly worse than showing
# the previous stale-but-correct value. So BOTH primary and fallback are
# online — primary gets one shot, fallback is a retry, neither is offline.
#
# LOG_LEVEL=0 silences ccusage's stdout "[ccusage] ℹ Loaded pricing..." log
# on cold start; without it, the JSON validation in run_json would fail and
# silently trigger the fallback branch (which used to mean offline → poison).
CT='{}'; XT='{}'; C3='{}'; X3='{}'
if [ -n "$CCUSAGE_BIN" ]; then
  CT=$(gc_json "claude_today_${TD}" 90 \
    "LOG_LEVEL=0 \"$CCUSAGE_BIN\" daily --json --breakdown --since $TD" \
    "LOG_LEVEL=0 \"$CCUSAGE_BIN\" daily --json --breakdown --since $TD")
  C3=$(gc_json "claude_30d_${TD}" 600 \
    "LOG_LEVEL=0 \"$CCUSAGE_BIN\" daily --json --breakdown --since $D30" \
    "LOG_LEVEL=0 \"$CCUSAGE_BIN\" daily --json --breakdown --since $D30")
fi
if [ -n "$CODEX_USAGE_BIN" ]; then
  XT=$(gc_json "codex_today_${TD}" 90 \
    "LOG_LEVEL=0 \"$CODEX_USAGE_BIN\" daily --json --since $TD" \
    "LOG_LEVEL=0 \"$CODEX_USAGE_BIN\" daily --json --since $TD")
  X3=$(gc_json "codex_30d_${TD}" 600 \
    "LOG_LEVEL=0 \"$CODEX_USAGE_BIN\" daily --json --since $D30" \
    "LOG_LEVEL=0 \"$CODEX_USAGE_BIN\" daily --json --since $D30")
fi

XR=$(gc_json "codex_rate_${TD}" 60 \
  "node \"$STARLINE_LIB/codex_rate.mjs\" snapshot" \
  "node \"$STARLINE_LIB/codex_rate.mjs\" snapshot")

MO=$(json_value "$input" '.model.display_name' '"—"')
SC=$(json_value "$input" '.cost.total_cost_usd' '0')
DU=$(json_value "$input" '.cost.total_duration_ms' '0')
CP=$(json_value "$input" '.context_window.used_percentage' '0')
CP=${CP%%.*}
CS=$(json_value "$input" '.context_window.context_window_size' '200000')
R5=$(json_value "$input" '.rate_limits.five_hour.used_percentage' '""')
R7=$(json_value "$input" '.rate_limits.seven_day.used_percentage' '""')
R7R=$(json_value "$input" '.rate_limits.seven_day.resets_at' '""')
X5=$(json_value "$XR" '.five_hour.used_percent' '""')
X7P=$(json_value "$XR" '.seven_day.used_percent' '""')

# Claude weekly window cost — used to project the monthly-equivalent API
# spend for the Claude subscription.
#
# IMPORTANT: we anchor the window to a FIXED "now − 7×24h" rather than to
# Anthropic's rate_limits.seven_day.resets_at. That reset_at marks the end
# of the Claude *rolling* window — which means if the user has gone idle
# for a few days, the oldest in-window burn has already aged out and the
# effective window start creeps toward now. That undercounts real 7-day
# spend by up to ~6×, making the `mo` projection read 1/6 of its actual
# ceiling.
#
# Fixed "now − 7d" gives a stable, intuitive 7-day window that matches
# what `ccusage daily --since 7days_ago` reports.
#
# Cache key is quantised to the hour so the JSON cache stays warm inside
# a 1-hour band without constantly invalidating on a moving cws.
WEEK_SECS=604800
NOW=$(date +%s)
cws=$(( (NOW / 3600) * 3600 - WEEK_SECS ))
# Both primary and fallback are online (offline=0). claude_window's offline
# mode relies on ccusage's embedded price table, which missing new models
# makes the dollar total undercount by up to ~100× for heavy Opus users.
CW=$(gc_json "claude_window_${cws}" 600 \
  "node \"$STARLINE_LIB/claude_window.mjs\" $cws 0" \
  "node \"$STARLINE_LIB/claude_window.mjs\" $cws 0")

cct=$(json_value "$CT" '.totals.totalCost' '0')
cxt=$(json_value "$XT" '.totals.costUSD' '0')
cc3=$(json_value "$C3" '.totals.totalCost' '0')
cx3=$(json_value "$X3" '.totals.costUSD' '0')
ccw=$(json_value "$CW" '.totalCost' '0')
tt=$(money_sum "$cct" "$cxt")
t3=$(money_sum "$cc3" "$cx3")

# -- render ----------------------------------------------------------------
#
# Three lines:
#   L1 — today (Claude + Codex, summed) with 30-day total hanging on the right
#   L2 — quota: Claude {5h · 7d · mo} gap Codex {5h · 7d}, all shown as REMAINING
#   L3 — session: model, duration, context bar
#
# Quota semantics are uniformly "left" (remaining). 5h and 7d are the API
# field names from Anthropic's rate_limits object (five_hour / seven_day)
# — we display them matched so the user can cross-reference without
# mental arithmetic. "mo" is an API-equivalent monthly projection driven
# by the 7-day rolling spend and remaining quota.

# L1 — today + 30d on one line
L1="${BD}${WH}TODAY${RS}  ${CA}Claude $(f "$cct")${RS}${S}${CB}Codex $(f "$cxt")${RS}  ${DM}=${RS}  ${BD}${WH}$(f "$tt")${RS}       ${DM}30D $(f "$t3") API-eq${RS}"

# L2 — quota, split by brand, all percentages read as remaining
claude_month=""
if [ -n "$R7" ] && [ "$R7" != '""' ] && is_positive "$ccw"; then
  claude_month=$(money_project_periods "$ccw" "$R7" 4)
fi

claude_parts=""
add_claude() {
  if [ -z "$claude_parts" ]; then claude_parts="$1"; else claude_parts="${claude_parts}${S}$1"; fi
}
codex_parts=""
add_codex() {
  if [ -z "$codex_parts" ]; then codex_parts="$1"; else codex_parts="${codex_parts}${S}$1"; fi
}

# Colour hierarchy on this line:
#   brand (Claude orange / Codex blue) — identity, on the prefix only
#   dim — structural labels (5h / 7d / mo) and separators
#   state (green/yellow/red) — percentages; the data the user acts on
#   brand — the "mo $N" dollar figure (because it's a Claude-related $)

if [ -n "$R5" ] && [ "$R5" != '""' ]; then
  r5u=${R5%%.*}; r5_left=$((100 - r5u))
  [ "$r5_left" -lt 0 ] && r5_left=0
  [ "$r5_left" -gt 100 ] && r5_left=100
  add_claude "${DM}5h${RS} $(cc_left "$r5_left")${r5_left}%${RS}"
fi
if [ -n "$R7" ] && [ "$R7" != '""' ]; then
  r7u=${R7%%.*}; r7_left=$((100 - r7u))
  [ "$r7_left" -lt 0 ] && r7_left=0
  [ "$r7_left" -gt 100 ] && r7_left=100
  add_claude "${DM}7d${RS} $(cc_left "$r7_left")${r7_left}%${RS}"
fi
if [ -n "$claude_month" ] && is_positive "$claude_month"; then
  add_claude "${DM}mo${RS} ${CA}$(fshort "$claude_month")${RS}"
fi

if [ -n "$X5" ] && [ "$X5" != '""' ]; then
  x5u=${X5%%.*}; x5_left=$((100 - x5u))
  [ "$x5_left" -lt 0 ] && x5_left=0
  [ "$x5_left" -gt 100 ] && x5_left=100
  add_codex "${DM}5h${RS} $(cc_left "$x5_left")${x5_left}%${RS}"
fi
if [ -n "$X7P" ] && [ "$X7P" != '""' ]; then
  x7u=${X7P%%.*}; x7_left=$((100 - x7u))
  [ "$x7_left" -lt 0 ] && x7_left=0
  [ "$x7_left" -gt 100 ] && x7_left=100
  add_codex "${DM}7d${RS} $(cc_left "$x7_left")${x7_left}%${RS}"
fi

claude_block=""
codex_block=""
[ -n "$claude_parts" ] && claude_block="${BD}${CA}Claude${RS} ${claude_parts}"
[ -n "$codex_parts" ]  && codex_block="${BD}${CB}Codex${RS} ${codex_parts}"

if [ -n "$claude_block" ] && [ -n "$codex_block" ]; then
  L2="${claude_block}        ${codex_block}"
elif [ -n "$claude_block" ]; then
  L2="$claude_block"
elif [ -n "$codex_block" ]; then
  L2="$codex_block"
else
  L2="${DM}waiting for rate data${RS}"
fi

# L3 — session
CL="200k"; [ "$CS" -ge 1000000 ] && CL="1M"
L3="${BD}${CA}${MO}${RS}${S}${DM}session${RS} $(f "$SC")${S}${DM}$(fd "$DU")${RS}  $(bar "$CP") $(cc "$CP")${CP}%${RS} ${DM}of $CL${RS}"

echo -e "$L1"
echo -e "$L2"
echo -e "$L3"
