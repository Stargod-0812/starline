#!/usr/bin/env bash
# starline uninstall — restore settings.json, leave the repo and cache intact.

set -euo pipefail

SETTINGS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

DIM='\033[2m'; GN='\033[32m'; YL='\033[33m'; RD='\033[31m'; RS='\033[0m'
say()  { printf '%b\n' "$*"; }
info() { say "${DIM}•${RS} $*"; }
ok()   { say "${GN}✓${RS} $*"; }
warn() { say "${YL}!${RS} $*"; }
fail() { say "${RD}✗${RS} $*" >&2; exit 1; }

if [ ! -f "$SETTINGS_FILE" ]; then
  warn "No settings.json at $SETTINGS_FILE — nothing to remove."
  exit 0
fi

if ! jq -e . "$SETTINGS_FILE" >/dev/null 2>&1; then
  fail "$SETTINGS_FILE is not valid JSON. Not touching it."
fi

current=$(jq -r '.statusLine.command // ""' "$SETTINGS_FILE")
if ! printf '%s' "$current" | grep -q 'starline'; then
  info "statusLine.command does not look like starline (value: $current)."
  info "Leaving settings.json alone. If you want to remove it anyway, edit by hand."
  exit 0
fi

ts=$(date +%Y%m%d-%H%M%S)
backup="$SETTINGS_FILE.bak.$ts"
cp -p "$SETTINGS_FILE" "$backup"

tmp=$(mktemp)
jq 'del(.statusLine)' "$SETTINGS_FILE" > "$tmp"
mv "$tmp" "$SETTINGS_FILE"

ok "Removed statusLine from $SETTINGS_FILE (backup: $backup)"
info "The starline repo at \$STARLINE_ROOT was not touched."
info "Cache dir \${XDG_CACHE_HOME:-\$HOME/.cache}/starline was not touched."
