#!/usr/bin/env bash
# Set up a clean checkout. Idempotent. Ends with INIT OK.
#   scripts/init.sh --check   only report missing tools
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TERM_COLOR=never NO_COLOR=1
# The same environment block is in init.sh and verify.sh (kept inline: verify.sh is protected and must not
# source an unprotected file that changes PATH).
# pnpm reads npm_config_* before HTTPS_PROXY, but inside the Claude Code sandbox only HTTPS_PROXY and NO_PROXY
# point at the sandbox proxy, so make pnpm follow them (no effect when no proxy is set). D-057.
if [ -n "${HTTPS_PROXY:-}" ]; then
  export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" npm_config_noproxy="${NO_PROXY:-}"
fi
# ui/package.json pins engines.node (D-058). When plain `node` is another version, put a `node` link to the
# fallback first on PATH (D-061), in a dir the user owns (the user cache, else the sandbox's per-user TMPDIR);
# a link that points anywhere else is replaced.
NODE_WANT=$(sed -n 's/^ *"node": *"\([0-9.]*\)".*/\1/p' ui/package.json 2>/dev/null | head -n 1)
NODE_FALLBACK="${LECTER_NODE_FALLBACK:-/usr/bin/node-24}" NODE_NOTE=""
if [ -n "$NODE_WANT" ] && [ "$(node --version 2>/dev/null)" != "v$NODE_WANT" ] && [ -x "$NODE_FALLBACK" ] \
  && [ "$("$NODE_FALLBACK" --version 2>/dev/null)" = "v$NODE_WANT" ]; then
  for _shim in "${XDG_CACHE_HOME:-$HOME/.cache}/lecter/node-v$NODE_WANT" "${TMPDIR:+$TMPDIR/lecter-node-v$NODE_WANT}"; do
    [ -n "$_shim" ] && mkdir -p -m 700 "$_shim" 2>/dev/null && [ -O "$_shim" ] || continue
    [ "$(readlink "$_shim/node" 2>/dev/null)" = "$NODE_FALLBACK" ] || ln -sfn "$NODE_FALLBACK" "$_shim/node" 2>/dev/null || continue
    export PATH="$_shim:$PATH" NODE_NOTE="node: using $NODE_FALLBACK (v$NODE_WANT)"; break
  done
fi
# pnpm keeps its store lock under XDG_RUNTIME_DIR, which the sandbox mounts read-only. And when the home store is
# on another mount than the checkout (sandbox bind mounts), pnpm puts a ~300 MB store in the checkout, which
# gitleaks then scans; keep it in the home store (pnpm 12 reads pnpm_config_*). CI never hits either.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
if [ -z "${pnpm_config_store_dir:-}" ] && [ -f ui/package.json ] && command -v pnpm >/dev/null 2>&1; then
  case "$(pnpm -C ui store path 2>/dev/null)" in
    "$PWD"/*) export pnpm_config_store_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store" ;;
  esac
fi
# Every missing tool is listed with the Fedora command that installs it.
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1 ($2)"); }
PNPM_WANT=$(sed -n 's/^ *"packageManager": *"pnpm@\([0-9.]*\)".*/\1/p' ui/package.json 2>/dev/null | head -n 1)
need git     "sudo dnf install git"
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || missing+=("python3 (3.10+: sudo dnf install python3)")
need cargo   "rustup: sudo dnf install rustup && rustup-init -y"
node_found=$(node --version 2>/dev/null || true)
if [ -z "$node_found" ] || { [ -n "$NODE_WANT" ] && [ "$node_found" != "v$NODE_WANT" ]; }; then
  missing+=("node ${NODE_WANT:-LTS} (found ${node_found:-none}: sudo dnf install nodejs24, which provides $NODE_FALLBACK)")
fi
need pnpm    "${PNPM_WANT:-latest}: sudo npm install -g pnpm@${PNPM_WANT:-latest}"
need gitleaks "secret scan: sudo dnf install gitleaks"
if [ "$(uname -s)" = "Linux" ]; then
  pkg-config --exists webkit2gtk-4.1 2>/dev/null || missing+=("webkit2gtk-4.1 (Tauri 2 prerequisites: sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel && sudo dnf group install c-development)")
  [ -n "${CI:-}" ] || need bwrap "Claude Code sandbox: sudo dnf install bubblewrap"
  [ -n "${CI:-}" ] || need socat "Claude Code sandbox: sudo dnf install socat"
  need xvfb-run "headless app runs: sudo dnf install xorg-x11-server-Xvfb"
fi
[ -z "$NODE_NOTE" ] || echo "$NODE_NOTE"
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
# Under CI only the lockfiles count: a manifest that doesn't match them fails the job instead of being
# re-resolved, so a PR can't go green on a rewritten lockfile (SEC-50). Locally, fall back and update them.
if [ -f Cargo.toml ]; then
  if [ -n "${CI:-}" ]; then
    cargo fetch --locked -q || { echo "Cargo.lock does not match the manifests: run 'cargo fetch' locally and commit Cargo.lock."; exit 1; }
    cargo build --workspace --locked -q
  else
    cargo fetch --locked -q 2>/dev/null || cargo fetch -q
    cargo build --workspace -q
  fi
fi
if [ -f ui/package.json ]; then
  if [ -n "${CI:-}" ]; then
    pnpm -C ui install --frozen-lockfile --reporter=append-only \
      || { echo "ui/pnpm-lock.yaml does not match ui/package.json: run 'pnpm -C ui install' locally and commit ui/pnpm-lock.yaml."; exit 1; }
  else
    pnpm -C ui install --frozen-lockfile --silent 2>/dev/null || pnpm -C ui install --reporter=append-only   # fallback shows errors
  fi
  if grep -q '"build"' ui/package.json; then pnpm --silent -C ui run build; fi
  # Playwright's Chromium for the e2e smoke test, into ~/.cache/ms-playwright (no-op when present).
  # Skipped when PLAYWRIGHT_BROWSERS_PATH is set: whoever set it manages the browsers.
  if grep -q '"@playwright/test"' ui/package.json && [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    pnpm --silent -C ui exec playwright install chromium
  fi
fi
echo "INIT OK"
