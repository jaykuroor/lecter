#!/usr/bin/env bash
# Set up a clean checkout. Idempotent. Ends with INIT OK.
#   scripts/init.sh --check   only report missing tools
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TERM_COLOR=never NO_COLOR=1
# pnpm reads npm_config_* before HTTPS_PROXY, but inside the Claude Code sandbox only HTTPS_PROXY and NO_PROXY
# point at the sandbox proxy, so make pnpm follow them (no effect when no proxy is set). D-057.
if [ -n "${HTTPS_PROXY:-}" ]; then
  export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" npm_config_noproxy="${NO_PROXY:-}"
fi
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1 ($2)"); }
need git     "https://git-scm.com"
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || missing+=("python3 (3.10+)")
need cargo   "rustup: https://rustup.rs"
need node    "Node LTS: https://nodejs.org"
need pnpm    "corepack enable && corepack prepare pnpm@latest --activate"
need gitleaks "secret scan: Fedora 'sudo dnf install gitleaks'; others: https://github.com/gitleaks/gitleaks/releases"
if [ "$(uname -s)" = "Linux" ]; then
  pkg-config --exists webkit2gtk-4.1 2>/dev/null || missing+=("webkit2gtk-4.1 dev headers (Tauri 2 Linux prerequisites)")
  [ -n "${CI:-}" ] || need bwrap "Claude Code sandbox: sudo dnf install bubblewrap"
  [ -n "${CI:-}" ] || need socat "Claude Code sandbox: sudo dnf install socat"
  need xvfb-run "headless app runs: sudo dnf install xorg-x11-server-Xvfb"
fi
command -v pdftotext >/dev/null 2>&1 || echo "optional: pdftotext (poppler-utils) lets check_private.py fingerprint private PDFs"
if [ "${1:-}" = "--check" ]; then
  for t in cargo-nextest cargo-deny; do command -v "$t" >/dev/null 2>&1 || missing+=("$t (cargo install $t --locked)"); done
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing tools:"; printf '  - %s\n' "${missing[@]}"
  [ "${1:-}" = "--check" ] && exit 1
  echo "Install them, then rerun scripts/init.sh"; exit 1
fi
# The Claude Code sandbox only grants writes to folders that already exist (.claude/settings.json
# sandbox.filesystem.allowWrite), so create them; inside the sandbox mkdir can fail, so say how.
dirs=(~/.cargo ~/.rustup ~/.local/share/pnpm ~/.cache/pnpm ~/.cache/node/corepack ~/.cache/ms-playwright ~/.cache/sccache)
nodir=()
for d in "${dirs[@]}"; do [ -d "$d" ] || mkdir -p "$d" 2>/dev/null || nodir+=("$d"); done
if [ ${#nodir[@]} -gt 0 ]; then
  echo "The sandbox can't create these folders. Run this in a normal terminal, then rerun scripts/init.sh:"
  echo "  mkdir -p ${nodir[*]}"; exit 1
fi
[ "${1:-}" = "--check" ] && { echo "TOOLS OK"; exit 0; }

# Required cargo tools (CI installs prebuilt ones first with taiki-e/install-action, so this is a no-op there).
for t in cargo-nextest cargo-deny; do
  command -v "$t" >/dev/null 2>&1 || cargo install "$t" --locked -q
done
command -v cargo-audit >/dev/null 2>&1 || echo "optional (used by --full): cargo install cargo-audit --locked"

[ -e .git ] || git init -q -b main   # -e: in a worktree .git is a file
if [ -f Cargo.toml ]; then
  cargo fetch --locked -q 2>/dev/null || cargo fetch -q
  cargo build --workspace -q
fi
if [ -f ui/package.json ]; then
  pnpm -C ui install --frozen-lockfile --silent 2>/dev/null || pnpm -C ui install --reporter=append-only   # fallback shows errors
  if grep -q '"build"' ui/package.json; then pnpm --silent -C ui run build; fi
  # Playwright's Chromium for the e2e smoke test, into ~/.cache/ms-playwright (no-op when present).
  # Skipped when PLAYWRIGHT_BROWSERS_PATH is set: whoever set it manages the browsers.
  if grep -q '"@playwright/test"' ui/package.json && [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    pnpm --silent -C ui exec playwright install chromium
  fi
fi
echo "INIT OK"
