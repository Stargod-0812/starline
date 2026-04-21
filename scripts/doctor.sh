#!/usr/bin/env bash
# starline doctor — diagnose why the statusline says "waiting for rate data"
# or why today's number looks wrong. Runs every external dep, prints what it
# found, dumps the first parse error if any.

set -uo pipefail

STARLINE_ROOT="${STARLINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

DIM='\033[2m'; BD='\033[1m'; GN='\033[32m'; YL='\033[33m'; RD='\033[31m'; RS='\033[0m'
ok()   { printf '  %b✓%b  %s\n' "$GN" "$RS" "$*"; }
warn() { printf '  %b!%b  %s\n' "$YL" "$RS" "$*"; }
bad()  { printf '  %b✗%b  %s\n' "$RD" "$RS" "$*"; }
info() { printf '  %b·%b  %s\n' "$DIM" "$RS" "$*"; }

section() { printf '\n%b%s%b\n' "$BD" "$*" "$RS"; }

section "Environment"
info "starline repo:   $STARLINE_ROOT"
info "version:         $(cat "$STARLINE_ROOT/VERSION")"
info "uname:           $(uname -sr)"
info "shell:           ${SHELL:-?}  (statusline runs under bash)"

section "Required dependencies"
if command -v bash >/dev/null 2>&1;   then ok "bash:   $(bash --version | head -n1)"; else bad "bash missing"; fi
if command -v jq >/dev/null 2>&1;     then ok "jq:     $(jq --version)"; else bad "jq missing — brew install jq"; fi
if command -v node >/dev/null 2>&1;   then ok "node:   $(node -v)"; else bad "node missing — brew install node"; fi

section "Claude-side"
if command -v ccusage >/dev/null 2>&1; then
  ok "ccusage: $(ccusage --version 2>/dev/null || echo 'present')"
else
  bad "ccusage not found — Claude costs will be \$0.00. Fix: npm i -g ccusage"
fi

loader=$(node -e '
  import("'$STARLINE_ROOT'/lib/claude_window.mjs").then(m => {
    const p = m.resolveLoaderPath();
    process.stdout.write(p || "");
  }).catch(() => process.exit(1));
' 2>/dev/null || true)
if [ -n "$loader" ] && [ -f "$loader" ]; then
  ok "ccusage data-loader: $loader"
else
  warn "ccusage data-loader not auto-resolved. Set CCUSAGE_LOADER=/path/to/data-loader-*.js"
fi

section "Codex-side"
if command -v ccusage-codex >/dev/null 2>&1; then
  ok "ccusage-codex: present"
else
  info "ccusage-codex absent — starline falls back to its own parser (no action needed)"
fi

codex_root="${CODEX_SESSIONS_ROOT:-$HOME/.codex/sessions}"
if [ -d "$codex_root" ]; then
  n=$(find "$codex_root" -name '*.jsonl' -mtime -7 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then
    ok "Codex sessions dir: $codex_root  ($n jsonl files modified in last 7d)"
  else
    warn "Codex sessions dir exists but no recent jsonl. Have you run Codex in the last week?"
  fi
else
  warn "Codex sessions dir missing: $codex_root  (fine if you don't use Codex)"
fi

section "Price table"
prices="${STARLINE_PRICES:-$STARLINE_ROOT/lib/prices.json}"
if [ -f "$prices" ]; then
  ok "prices.json:  $prices"
  info "updated_at:   $(jq -r '.updated_at' "$prices")"
  info "models:       $(jq -r '.models | keys | length' "$prices")"
  unverified=$(jq -r '[.models[] | select(.verified == false)] | length' "$prices")
  if [ "$unverified" -gt 0 ]; then
    warn "$unverified models marked verified:false — re-check against vendor pricing page"
  fi
else
  bad "prices.json missing at $prices"
fi

section "Live parse (if Codex dir present)"
if [ -d "$codex_root" ]; then
  since=$(( $(date +%s) - 3600 ))
  out=$(node "$STARLINE_ROOT/lib/codex_cost.mjs" "$since" 2>&1 || true)
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | jq '.' 2>/dev/null || printf '%s\n' "$out"
  fi
else
  info "Skipped (no Codex sessions)."
fi

section "Cache"
cache="${STARLINE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/starline}"
if [ -d "$cache" ]; then
  ok "cache dir:   $cache"
  info "files:       $(ls -1 "$cache" 2>/dev/null | wc -l | tr -d ' ')"
else
  info "cache dir not created yet (will be on first statusline render)"
fi

section "Claude Code settings"
settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
if [ -f "$settings" ]; then
  current=$(jq -r '.statusLine.command // "(none)"' "$settings")
  info "statusLine.command: $current"
  if printf '%s' "$current" | grep -q 'starline'; then
    ok "settings.json points at starline."
  else
    warn "settings.json does NOT point at starline. Run: starline install"
  fi
else
  warn "settings.json missing at $settings. Run: starline install"
fi

printf '\n'
