#!/usr/bin/env bash
# The one entry point for checks, locally and in CI (docs/spec/16-ci-cd.md). Protected: only the maintainer edits it.
# One line per check; on failure, the tail of its log. Full logs: .verify/<check>.log.
#   scripts/verify.sh            lint + test + e2e smoke + quick perf + mutation testing of changed lines  (before feature.py done)
#   scripts/verify.sh --quick    lint + test                               (while iterating; first thing a builder runs)
#   scripts/verify.sh --full     everything, including e2e-app, full perf and supply chain
#   scripts/verify.sh --stage lint|test|e2e|e2e-app|perf|full|mutants      (CI jobs; mutants runs only locally)
#   -v / LECTER_VERIFY_VERBOSE=1   print every PASS line (default: one summary line; FAIL lines always print)
#   --no-cache / LECTER_VERIFY_NOCACHE=1   ignore the green cache below (the gardener always does)
# Green cache (local only, never in CI): when the staged code tree, the done state of the features that switch
# checks on and the toolchain versions match a run that already passed, the heavy checks (Rust, UI, e2e, perf) are
# reused and only the cheap lint checks run again. Needs no unstaged or untracked changes (a staged merge is fine).
# --no-cache forces a full run. Agents never touch the cache folder (scripts/hooks/guard.py).
# A check whose tool or file doesn't exist yet is skipped until the feature that adds it is done; after
# that, a missing tool or file is a failure. Ends with VERIFY OK or VERIFY FAILED.
set -uo pipefail
cd "$(dirname "$0")/.."
VERBOSE="${LECTER_VERIFY_VERBOSE:-0}"
ARGS=(); for a in "$@"; do case "$a" in -v) VERBOSE=1 ;; --no-cache) LECTER_VERIFY_NOCACHE=1 ;; *) ARGS+=("$a") ;; esac; done
set -- "${ARGS[@]+"${ARGS[@]}"}"
STAGES="lint test e2e-smoke perf-quick mutants"
case "${1:-}" in
  --quick) STAGES="lint test" ;;
  --full) STAGES="lint test e2e-smoke e2e-full e2e-app perf full mutants" ;;
  --stage) STAGES="${2:?stage name}"; [ "$STAGES" = e2e ] && STAGES="e2e-full" ;;
  "") ;;
  *) echo "usage: scripts/verify.sh [--quick | --full | --stage lint|test|e2e|e2e-app|perf|full|mutants]"; exit 2 ;;
esac
for st in $STAGES; do
  case "$st" in lint|test|e2e-smoke|e2e-full|e2e-app|perf|perf-quick|full|mutants) ;; *) echo "unknown stage: $st"; exit 2 ;; esac
done
on() { [[ " $STAGES " == *" $1 "* ]]; }
mkdir -p .verify
export CARGO_TERM_COLOR=never NO_COLOR=1 FORCE_COLOR=0
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
PY=$(command -v python3 || command -v python)
FAIL=0
DONE=" $("$PY" -c 'import json;print(" ".join(f["id"] for f in json.load(open("docs/features.json"))["features"] if f["status"]=="done"))' 2>/dev/null) "

NPASS=0; PASSED=""; SKIPPED=""
run() { # name, command...
  local name="$1"; shift
  local log=".verify/$name.log"
  if "$@" >"$log" 2>&1; then NPASS=$((NPASS+1)); PASSED="$PASSED $name"; [ "$VERBOSE" = 1 ] && echo "PASS  $name"
  else
    echo "FAIL  $name   (full log: $log)"
    tail -n 40 "$log" | sed 's/^/      /'
    FAIL=1
  fi
}
have() { command -v "$1" >/dev/null 2>&1; }
# need <check> <owner F-id> <condition...>: true if the check can run; else SKIP before the owner is done, FAIL after.
need() {
  local name="$1" owner="$2"; shift 2
  if "$@" >/dev/null 2>&1; then return 0; fi
  if [[ "$DONE" == *" $owner "* ]]; then echo "FAIL  $name   ($owner is done but '$*' is not true)"; FAIL=1
  else SKIPPED="$SKIPPED $name($owner)"; [ "$VERBOSE" = 1 ] && echo "SKIP  $name   (arrives with $owner)"; fi
  return 1
}

# Green cache. Key = staged tree minus the handoff docs + done state of the features named in `need` lines
# (they turn SKIP into FAIL) + toolchain versions. The cheap lint checks (private corpus, secrets, tests-guard,
# deps, spec refs, features) always run.
CACHE_DIR=""; CACHE_KEY=""; HEAVY=1
if [ -z "${CI:-}" ] && [ "${LECTER_VERIFY_NOCACHE:-0}" != 1 ] && [ -e .git ] \
   && git diff --quiet 2>/dev/null \
   && [ -z "$(git ls-files --others --exclude-standard 2>/dev/null | grep -vE '^(\.verify|\.evidence|\.loop)/')" ]; then
  OWNERS_DONE=""
  for o in $(grep -oE '\bneed [a-z-]+ F-[0-9]+' "$0" | awk '{print $3}' | sort -u); do
    [[ "$DONE" == *" $o "* ]] && OWNERS_DONE="$OWNERS_DONE $o"
  done
  CACHE_DIR="$(git rev-parse --git-common-dir)/lecter-verify-cache"
  CACHE_KEY=$( { git ls-files -s | grep -vE $'\t(docs/(PROGRESS|DECISIONS|QUESTIONS)\.md|CHANGELOG\.md|README\.md|docs/features\.json)$'
                 echo "done:$OWNERS_DONE"; rustc -V 2>/dev/null; node -v 2>/dev/null; } | git hash-object --stdin )
fi
cache_has() { # a run covering these stages already passed on this key
  [ -n "$CACHE_KEY" ] || return 1
  local want="$1" f
  for f in "$CACHE_DIR/$CACHE_KEY".*; do
    [ -e "$f" ] || continue
    local have; have=" $(cat "$f") "
    local ok=1 st
    for st in $want; do [[ "$have" == *" $st "* ]] || ok=0; done
    [ "$ok" = 1 ] && return 0
  done
  return 1
}
if cache_has "$STAGES"; then HEAVY=0; echo "CACHED  heavy checks (this code tree already passed: $STAGES)"; fi
heavy() { [ "$HEAVY" = 1 ]; }
exists() { [ -e "$1" ]; }
ui_script() { [ -f ui/package.json ] && grep -q "\"$1\"" ui/package.json; }

placeholders() {
  local hits
  hits=$(grep -rnE 'todo!\(|unimplemented!\(|\bTODO\b|FIXME' --include='*.rs' --include='*.ts' --include='*.tsx' \
    crates app ui/src 2>/dev/null | grep -vE '/tests?/|\.test\.|\.spec\.|TODO\(#[0-9]+\)' || true)
  [ -z "$hits" ] || { printf '%s\n' "$hits"; return 1; }
}
versions_match() { # Cargo workspace, tauri.conf.json and ui/package.json agree (16-ci-cd.md#versions-and-changelog)
  "$PY" - <<'PYV'
import json, re, sys
cargo = re.search(r'(?ms)^\[workspace\.package\].*?^version\s*=\s*"([^"]+)"', open("Cargo.toml").read())
v = {"Cargo.toml": cargo and cargo.group(1), "app/tauri.conf.json": json.load(open("app/tauri.conf.json")).get("version"),
     "ui/package.json": json.load(open("ui/package.json")).get("version")}
print(v); sys.exit(0 if len(set(v.values())) == 1 and None not in v.values() else 1)
PYV
}
headless() { if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then xvfb-run -a "$@"; else "$@"; fi; }

if on lint; then
  run kit-tests "$PY" -m unittest discover -s scripts/tests -q
  run spec-refs "$PY" scripts/spec.py --check
  run sec-coverage "$PY" scripts/check_sec_ids.py
  run features "$PY" scripts/feature.py validate
  run placeholders placeholders
  run size "$PY" scripts/check_size.py
  run arch "$PY" scripts/check_arch.py
  if [ -e .git ]; then   # -e: in a worktree .git is a file
    run private-corpus "$PY" scripts/check_private.py
    run tests-guard "$PY" scripts/check_tests.py
    run deps "$PY" scripts/check_deps.py
    if have gitleaks; then run secrets scripts/secret_scan.sh
    else echo "FAIL  secrets   (gitleaks is not installed: scripts/init.sh --check says how)"; FAIL=1; fi
  fi
  if heavy && need rust-lint F-010 exists Cargo.toml; then
    run fmt cargo fmt --all -- --check
    run clippy cargo clippy --workspace --all-targets --locked -q -- -D warnings
    if need deny F-010 have cargo-deny; then run deny cargo deny check licenses bans sources; fi
  fi
  if [ -f Cargo.toml ] && [ -f ui/package.json ] && [ -f app/tauri.conf.json ]; then run versions versions_match; fi
  if heavy && need bindings-stale F-017 exists app/src/bin/export-bindings.rs; then
    run bindings-stale cargo run -q --locked -p lecter-app --bin export-bindings -- --check
  fi
  if heavy && need ui-lint F-011 exists ui/package.json; then
    run tsc pnpm -C ui exec tsc --noEmit
    run biome pnpm -C ui exec biome ci --colors=off .
  fi
  if heavy && need jscpd F-014 exists ui/.jscpd.json; then run jscpd pnpm -C ui exec jscpd --config .jscpd.json; fi
  if heavy && need knip F-014 exists ui/knip.json; then run knip pnpm -C ui exec knip; fi
fi

if on test && heavy; then
  if need rust-tests F-010 exists Cargo.toml; then
    if have cargo-nextest; then run rust-tests cargo nextest run --workspace --locked --status-level fail --final-status-level fail
    else run rust-tests cargo test --workspace --locked -q; fi
  fi
  if need app-build F-012 exists app/Cargo.toml; then run app-build cargo build -p lecter-app --locked -q; fi
  if need ui-tests F-011 exists ui/package.json; then run ui-tests pnpm -C ui exec vitest run --reporter=dot; fi
fi

if on e2e-smoke && heavy && need e2e-smoke F-011 ui_script test:e2e:smoke; then run e2e-smoke pnpm -C ui run test:e2e:smoke; fi
if on e2e-full && heavy && need e2e F-011 ui_script test:e2e; then run e2e pnpm -C ui run test:e2e; fi
if on e2e-app && heavy && need e2e-app F-016 exists scripts/e2e-app.sh; then run e2e-app headless bash scripts/e2e-app.sh; fi
if on perf-quick && heavy && need perf F-025 exists tests/perf/budgets.sh; then run perf bash tests/perf/budgets.sh --quick; fi
if on perf && heavy && need perf F-025 exists tests/perf/budgets.sh; then run perf bash tests/perf/budgets.sh; fi
# Until F-025 adds tests/perf/budgets.sh, the perf stages run the mocked-core keystroke check alone (D-120).
if { on perf-quick || on perf; } && heavy && ! exists tests/perf/budgets.sh && need keystroke F-020 ui_script test:perf; then
  run keystroke pnpm -C ui run test:perf
fi
# Mutation testing of the lines this change touched (14-quality.md#mutation-testing). Not in CI: nightly runs the full tree.
if on mutants && heavy && [ -z "${CI:-}" ]; then
  M_OK=1
  need mutants-rust F-010 have cargo-mutants || M_OK=0
  if [ -f ui/package.json ]; then need mutants-ui F-011 exists ui/node_modules/@stryker-mutator/vitest-runner/package.json || M_OK=0; fi
  [ "$M_OK" = 1 ] && run mutants "$PY" scripts/mutants.py
fi

if on full; then
  if [ -f Cargo.toml ] && have cargo-deny; then run deny-advisories cargo deny check advisories; fi
  if [ -f ui/package.json ]; then run pnpm-audit pnpm -C ui audit --prod; fi
  [ -e .git ] && have gitleaks && run secrets-history scripts/secret_scan.sh --all
fi

[ "$VERBOSE" = 1 ] || echo "PASS  $NPASS checks:$PASSED"
[ -n "$SKIPPED" ] && [ "$VERBOSE" != 1 ] && echo "SKIP  not built yet:$SKIPPED"
if [ "$FAIL" = 0 ]; then
  if [ -n "$CACHE_KEY" ] && [ "$HEAVY" = 1 ]; then mkdir -p "$CACHE_DIR" && echo "$STAGES" > "$CACHE_DIR/$CACHE_KEY.$(echo "$STAGES" | tr ' ' '-')"; fi
  echo "VERIFY OK"
else echo "VERIFY FAILED"; exit 1; fi
