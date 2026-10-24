#!/usr/bin/env bash
# The one entry point for checks, locally and in CI (docs/spec/16-ci-cd.md). Protected: only Jay edits it.
# One line per check; on failure, the tail of its log. Full logs: .verify/<check>.log.
#   scripts/verify.sh            lint + test + e2e smoke + quick perf      (before feature.py done)
#   scripts/verify.sh --quick    lint + test                               (while iterating; first thing a builder runs)
#   scripts/verify.sh --full     everything, including e2e-app, full perf and supply chain
#   scripts/verify.sh --stage lint|test|e2e|e2e-app|perf|full              (CI jobs)
# A check whose tool or file doesn't exist yet is skipped until the feature that adds it is done; after
# that, a missing tool or file is a failure. Ends with VERIFY OK or VERIFY FAILED.
set -uo pipefail
cd "$(dirname "$0")/.."
STAGES="lint test e2e-smoke perf-quick"
case "${1:-}" in
  --quick) STAGES="lint test" ;;
  --full) STAGES="lint test e2e-smoke e2e-full e2e-app perf full" ;;
  --stage) STAGES="${2:?stage name}"; [ "$STAGES" = e2e ] && STAGES="e2e-full" ;;
  "") ;;
  *) echo "usage: scripts/verify.sh [--quick | --full | --stage lint|test|e2e|e2e-app|perf|full]"; exit 2 ;;
esac
for st in $STAGES; do
  case "$st" in lint|test|e2e-smoke|e2e-full|e2e-app|perf|perf-quick|full) ;; *) echo "unknown stage: $st"; exit 2 ;; esac
done
on() { [[ " $STAGES " == *" $1 "* ]]; }
mkdir -p .verify
export CARGO_TERM_COLOR=never NO_COLOR=1 FORCE_COLOR=0
. scripts/lib_env.sh   # pnpm proxy, the Node 24 fallback, pnpm's store outside the checkout (D-057, D-061)
PY=$(command -v python3 || command -v python)
FAIL=0
DONE=" $("$PY" -c 'import json;print(" ".join(f["id"] for f in json.load(open("docs/features.json"))["features"] if f["status"]=="done"))' 2>/dev/null) "

run() { # name, command...
  local name="$1"; shift
  local log=".verify/$name.log"
  if "$@" >"$log" 2>&1; then echo "PASS  $name"
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
  else echo "SKIP  $name   (arrives with $owner)"; fi
  return 1
}
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
  run features "$PY" scripts/feature.py validate
  run placeholders placeholders
  run size "$PY" scripts/check_size.py
  run arch "$PY" scripts/check_arch.py
  if [ -e .git ]; then   # -e: in a worktree .git is a file
    run private-corpus "$PY" scripts/check_private.py
    run tests-guard "$PY" scripts/check_tests.py
    run deps "$PY" scripts/check_deps.py
    if have gitleaks; then run secrets scripts/secret_scan.sh
    else echo "FAIL  secrets   (gitleaks is not installed: Fedora 'sudo dnf install gitleaks'; see the build guide)"; FAIL=1; fi
  fi
  if need rust-lint F-010 exists Cargo.toml; then
    run fmt cargo fmt --all -- --check
    run clippy cargo clippy --workspace --all-targets --locked -q -- -D warnings
    if need deny F-010 have cargo-deny; then run deny cargo deny check licenses bans sources; fi
  fi
  if [ -f Cargo.toml ] && [ -f ui/package.json ] && [ -f app/tauri.conf.json ]; then run versions versions_match; fi
  if need bindings-stale F-017 exists app/src/bin/export-bindings.rs; then
    run bindings-stale cargo run -q --locked -p lecter-app --bin export-bindings -- --check
  fi
  if need ui-lint F-011 exists ui/package.json; then
    run tsc pnpm -C ui exec tsc --noEmit
    run biome pnpm -C ui exec biome ci --colors=off .
  fi
  if need jscpd F-014 exists ui/.jscpd.json; then run jscpd pnpm -C ui exec jscpd --config .jscpd.json; fi
  if need knip F-014 exists ui/knip.json; then run knip pnpm -C ui exec knip; fi
fi

if on test; then
  if need rust-tests F-010 exists Cargo.toml; then
    if have cargo-nextest; then run rust-tests cargo nextest run --workspace --locked --status-level fail --final-status-level fail
    else run rust-tests cargo test --workspace --locked -q; fi
  fi
  if need app-build F-012 exists app/Cargo.toml; then run app-build cargo build -p lecter-app --locked -q; fi
  if need ui-tests F-011 exists ui/package.json; then run ui-tests pnpm -C ui exec vitest run --reporter=dot; fi
fi

if on e2e-smoke && need e2e-smoke F-011 ui_script test:e2e:smoke; then run e2e-smoke pnpm -C ui run test:e2e:smoke; fi
if on e2e-full && need e2e F-011 ui_script test:e2e; then run e2e pnpm -C ui run test:e2e; fi
if on e2e-app && need e2e-app F-016 exists scripts/e2e-app.sh; then run e2e-app headless bash scripts/e2e-app.sh; fi
if on perf-quick && need perf F-025 exists tests/perf/budgets.sh; then run perf bash tests/perf/budgets.sh --quick; fi
if on perf && need perf F-025 exists tests/perf/budgets.sh; then run perf bash tests/perf/budgets.sh; fi

if on full; then
  if [ -f Cargo.toml ] && have cargo-deny; then run deny-advisories cargo deny check advisories; fi
  if [ -f ui/package.json ]; then run pnpm-audit pnpm -C ui audit --prod; fi
  [ -e .git ] && have gitleaks && run secrets-history scripts/secret_scan.sh --all
fi

if [ "$FAIL" = 0 ]; then echo "VERIFY OK"; else echo "VERIFY FAILED"; exit 1; fi
