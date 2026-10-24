#!/usr/bin/env bash
# Secret scan with gitleaks (docs/spec/13-security.md#secrets). Used by the lint stage and the Stop hook.
#   scripts/secret_scan.sh                  commits since the base + staged + unstaged + untracked files
#   scripts/secret_scan.sh --since REV      commits in REV..HEAD only (the Stop hook)
#   scripts/secret_scan.sh --all            the whole history (CI)
# Works with the old (detect/protect) and new (git/dir) gitleaks CLIs. Findings are redacted.
set -uo pipefail
cd "$(dirname "$0")/.."
command -v gitleaks >/dev/null || { echo "gitleaks is not installed (Fedora: sudo dnf install gitleaks)"; exit 1; }
CONF=(); [ -f .gitleaks.toml ] && CONF=(--config .gitleaks.toml)
NEW=0; gitleaks git --help >/dev/null 2>&1 && NEW=1
G=(--no-banner --redact --verbose --log-level warn --exit-code 1 "${CONF[@]}")
FAIL=0
history() { # log-opts
  if [ "$NEW" = 1 ]; then gitleaks git "${G[@]}" ${1:+--log-opts="$1"} . || FAIL=1
  else gitleaks detect "${G[@]}" ${1:+--log-opts="$1"} --source . || FAIL=1; fi
}
uncommitted() {
  if [ "$NEW" = 1 ]; then gitleaks git "${G[@]}" --pre-commit . || FAIL=1; gitleaks git "${G[@]}" --staged . || FAIL=1
  else gitleaks protect "${G[@]}" --source . || FAIL=1; gitleaks protect "${G[@]}" --staged --source . || FAIL=1; fi
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    if [ "$NEW" = 1 ]; then gitleaks dir "${G[@]}" "$f" || FAIL=1
    else gitleaks detect "${G[@]}" --no-git --source "$f" || FAIL=1; fi
  done < <(git ls-files --others --exclude-standard)
}
git rev-parse --verify -q HEAD >/dev/null || { uncommitted; [ $FAIL = 0 ] && echo "SECRETS OK" || echo "SECRETS FOUND"; exit $FAIL; }
case "${1:-}" in
  --all) history "" ;;
  --since) REV="${2:?revision}"; [ "$REV" = none ] && history "" || history "$REV..HEAD" ;;
  "") BASE=$(python3 -c 'import sys; sys.path.insert(0,"scripts"); from lib_git import find_base; print(find_base(".") or "")')
      if [ -n "$BASE" ]; then history "$BASE..HEAD"; else history ""; fi
      uncommitted ;;
  *) echo "usage: scripts/secret_scan.sh [--since REV | --all]"; exit 2 ;;
esac
if [ $FAIL = 0 ]; then echo "SECRETS OK"; else echo "SECRETS FOUND: stop, do not push, and report it (Jay rotates the secret and removes it from history)"; fi
exit $FAIL
