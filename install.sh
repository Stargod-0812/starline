#!/usr/bin/env bash
# starline install — wire up ~/.claude/settings.json to point at statusline.sh.
#
# Invocation modes:
#   1. Local checkout:   ./install.sh  (from `git clone`)
#   2. Homebrew install: bin/starline install  (STARLINE_ROOT set upstream)
#   3. Remote one-liner: curl -sSL .../install.sh | bash
#      (detects piped invocation and bootstraps a shallow clone first)
#
# Idempotent: running twice produces the same end state.
# Safe: backs up settings.json to settings.json.bak.<ts> before editing.
# Honest: fails loud if jq / node / ccusage are missing, with exact install cmds.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [ -z "${STARLINE_ROOT:-}" ] && [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/statusline/statusline.sh" ]; then
  STARLINE_ROOT="$SCRIPT_DIR"
fi

if [ -z "${STARLINE_ROOT:-}" ] || [ ! -f "$STARLINE_ROOT/statusline/statusline.sh" ]; then
  # Piped via `curl | bash` — clone to a stable location and re-exec.
  CLONE_DEST="${STARLINE_CLONE_DEST:-$HOME/.local/share/starline}"
  STARLINE_REPO_URL="${STARLINE_REPO_URL:-https://github.com/Stargod-0812/starline}"
  mkdir -p "$(dirname "$CLONE_DEST")"
  if [ -d "$CLONE_DEST/.git" ]; then
    printf 'starline: updating existing checkout at %s\n' "$CLONE_DEST"
    git -C "$CLONE_DEST" fetch --depth=1 origin main
    git -C "$CLONE_DEST" reset --hard origin/main
  else
    printf 'starline: cloning %s → %s\n' "$STARLINE_REPO_URL" "$CLONE_DEST"
    git clone --depth=1 "$STARLINE_REPO_URL" "$CLONE_DEST"
  fi
  exec bash "$CLONE_DEST/install.sh" "$@"
fi

STATUSLINE_PATH="$STARLINE_ROOT/statusline/statusline.sh"
SETTINGS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

DIM='\033[2m'; BD='\033[1m'; GN='\033[32m'; YL='\033[33m'; RD='\033[31m'; RS='\033[0m'

say()   { printf '%b\n' "$*"; }
info()  { say "${DIM}•${RS} $*"; }
ok()    { say "${GN}✓${RS} $*"; }
warn()  { say "${YL}!${RS} $*"; }
fail()  { say "${RD}✗${RS} $*" >&2; exit 1; }

# ---- preflight ----------------------------------------------------------

require() {
  local name="$1" install_hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    fail "$name not found. Install: $install_hint"
  fi
}

require jq     "brew install jq  (macOS) · apt install jq (Linux)"
require node   "brew install node  (macOS) · https://nodejs.org/ (all platforms)"

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "node >= 18 required (built-in test runner). Found: $(node -v 2>&1 || true)"
fi

if ! command -v ccusage >/dev/null 2>&1; then
  warn "ccusage not found — Claude-side cost totals will show \$0.00."
  warn "  Install: npm i -g ccusage"
fi
if ! command -v ccusage-codex >/dev/null 2>&1; then
  info "ccusage-codex not found — Codex-side cost totals will fall back to starline's direct parser."
  info "  If you want ccusage's numbers instead: npm i -g ccusage-codex"
fi

# ---- statusline presence ------------------------------------------------

if [ ! -x "$STATUSLINE_PATH" ]; then
  chmod +x "$STATUSLINE_PATH" 2>/dev/null || fail "cannot chmod +x $STATUSLINE_PATH"
fi
[ -x "$STATUSLINE_PATH" ] || fail "statusline script not executable: $STATUSLINE_PATH"

# ---- settings.json patch ------------------------------------------------

mkdir -p "$SETTINGS_DIR"
if [ ! -f "$SETTINGS_FILE" ]; then
  info "Creating fresh settings.json at $SETTINGS_FILE"
  echo '{}' > "$SETTINGS_FILE"
fi

if ! jq -e . "$SETTINGS_FILE" >/dev/null 2>&1; then
  fail "$SETTINGS_FILE is not valid JSON. Fix or move it aside before running install."
fi

ts=$(date +%Y%m%d-%H%M%S)
backup="$SETTINGS_FILE.bak.$ts"
cp -p "$SETTINGS_FILE" "$backup"

tmp=$(mktemp)
jq \
  --arg cmd "$STATUSLINE_PATH" \
  '.statusLine = { type: "command", command: $cmd, padding: 0 }' \
  "$SETTINGS_FILE" > "$tmp"

mv "$tmp" "$SETTINGS_FILE"
ok "Patched $SETTINGS_FILE (backup: $backup)"

# ---- smoke test ---------------------------------------------------------

info "Running a smoke render…"
sample='{"model":{"display_name":"Opus 4.7"},"cost":{"total_cost_usd":0.0,"total_duration_ms":0},"context_window":{"used_percentage":0,"context_window_size":200000}}'
if echo "$sample" | STARLINE_ROOT="$STARLINE_ROOT" "$STATUSLINE_PATH" >/dev/null 2>&1; then
  ok "statusline renders."
else
  warn "statusline render failed — run 'starline doctor' for a diagnosis."
fi

cat <<EOF

${BD}starline installed.${RS}

  Status line command: $STATUSLINE_PATH
  Cache:               ${XDG_CACHE_HOME:-$HOME/.cache}/starline
  Prices:              $STARLINE_ROOT/lib/prices.json

Open a new Claude Code session — the 3-line statusline will appear at the
bottom of the UI. The numbers warm up after the first cache cycle (~90s).

Next steps:
  starline doctor       See resolved paths and sample parse output.
  starline explain      Per-session, per-model cost breakdown for audit.
  starline uninstall    Restore the previous settings.json.
EOF
