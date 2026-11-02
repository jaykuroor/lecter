#!/usr/bin/env bash
# F-016 criterion 6 (16-ci-cd.md release-check job; SEC-34): a release-profile build passes
# scripts/check_release_binary.sh, and debug builds fail it, both asserted, so the check is known
# to see the test hooks and the embedded WebDriver server, not just to pass.
#   tests/e2e/release-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
EXE=lecter-app
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=lecter-app.exe ;; esac
FAIL=0
build() { cargo build -p lecter-app --locked -q "$@" || { echo "FAIL  cargo build $*"; exit 1; }; }
# expect <pass|fail> <label> <grep pattern the output must contain or ""> <binary>
expect() {
  local want="$1" label="$2" must="$3" bin="$4" out code
  out=$(bash scripts/check_release_binary.sh "$bin" 2>&1); code=$?
  if [ "$want" = pass ] && [ "$code" = 0 ]; then echo "PASS  $label: check passes"
  elif [ "$want" = fail ] && [ "$code" = 1 ] && { [ -z "$must" ] || grep -qE "$must" <<<"$out"; }; then echo "PASS  $label: check fails, as it must"
  else echo "FAIL  $label: expected the check to $want (exit $code)"; FAIL=1; fi
  sed 's/^/      /' <<<"$out"
}

[ -d ui/dist ] || pnpm --silent -C ui run build || { echo "FAIL  ui build"; exit 1; }

build --release --features custom-protocol
expect pass "release build" "" "target/release/$EXE"

build
expect fail "debug build" "LECTER_TEST_PICK" "target/debug/$EXE"

build --features custom-protocol,test-hooks
expect fail "debug build with the WebDriver server (e2e-app)" "wdio.webdriver" "target/debug/$EXE"

[ "$FAIL" = 0 ] && echo "RELEASE-CHECK ASSERTIONS OK" || echo "RELEASE-CHECK ASSERTIONS FAILED"
exit "$FAIL"
