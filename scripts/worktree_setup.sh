#!/usr/bin/env bash
# Builder worktree setup (.claude/agents/builder.md#setup). Run from inside the builder's worktree.
#   scripts/worktree_setup.sh F-0NN <slug>          new feature branch feat/F-0NN-<slug>
#   scripts/worktree_setup.sh --resume <branch>     continue a branch from an earlier builder
#   scripts/worktree_setup.sh --ci <short-sha>      CI fix branch fix/ci-<sha>
# Then: brings in the orchestrator's local main, runs init.sh, links the private corpus read-only,
# and runs verify --quick as a baseline. Exit 3 = main itself is red: report BLOCKED, don't build on it.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
[ -f .git ] || { echo "not a git worktree: run this inside the builder's worktree"; exit 2; }
case "${1:-}" in
  --resume) BR="${2:?branch}"; git switch -q "$BR" || exit 1; git merge -q --no-edit main || { echo "merge of main conflicts: resolve, commit, re-run"; exit 1; } ;;
  --ci) BR="fix/ci-${2:?sha}"; git switch -q -c "$BR" main || exit 1 ;;
  F-[0-9]*) BR="feat/$1-${2:?slug}"; git switch -q -c "$BR" main || exit 1 ;;   # always from local main, whatever the worktree started on
  *) echo "usage: scripts/worktree_setup.sh F-0NN <slug> | --resume <branch> | --ci <sha>"; exit 2 ;;
esac
echo "branch $BR at $(git rev-parse --short HEAD)"
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
if [ -d "$MAIN/tests/corpus/private" ] && [ ! -e tests/corpus/private ]; then
  mkdir -p tests/corpus && ln -s "$MAIN/tests/corpus/private" tests/corpus/private
  echo "linked the private corpus (git-ignored; read only)"
fi
# Warm start: clone main's Rust build output when the filesystem shares blocks (btrfs, XFS): instant, no extra
# space. Anywhere else the copy fails at once and the build starts cold, as before. Cargo rebuilds what changed.
if [ -d "$MAIN/target" ] && [ ! -e target ] && [ "$(uname -s)" = Linux ]; then
  if cp -a --reflink=always "$MAIN/target" target 2>/dev/null; then echo "warm start: cloned main's target/"
  else rm -rf ./target; fi
fi
scripts/init.sh >/dev/null 2>.verify-init.err || { cat .verify-init.err; rm -f .verify-init.err; echo "init.sh failed"; exit 1; }
rm -f .verify-init.err
# Usually a cache hit: the orchestrator verified this code tree when it merged it (scripts/verify.sh green cache).
if BASE_OUT=$(scripts/verify.sh --quick 2>&1); then echo "baseline: VERIFY OK"
else
  printf '%s\n' "$BASE_OUT" | grep -E '^(FAIL|VERIFY)'
  [ "${1:-}" = --resume ] && { echo "baseline red on a resumed branch: fix your own branch first"; exit 1; }
  echo "baseline red: main itself fails. Report STATUS: BLOCKED with these lines; don't build on it."; exit 3
fi
