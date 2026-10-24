#!/usr/bin/env bash
# Resolve lockfile conflicts during a merge on main by regenerating, never by hand-editing
# (docs/spec/16-ci-cd.md). Keeps main's lockfile, then lets cargo and pnpm add what the branch needs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git rev-parse -q --verify MERGE_HEAD >/dev/null || { echo "no merge in progress"; exit 2; }
conflicted=$(git diff --name-only --diff-filter=U)
for f in $conflicted; do
  case "$f" in
    Cargo.lock) git checkout --ours Cargo.lock && cargo metadata --format-version 1 >/dev/null && git add Cargo.lock && echo "regenerated Cargo.lock" ;;
    ui/pnpm-lock.yaml) git checkout --ours ui/pnpm-lock.yaml && pnpm -C ui install --no-frozen-lockfile --prefer-offline >/dev/null && git add ui/pnpm-lock.yaml && echo "regenerated ui/pnpm-lock.yaml" ;;
  esac
done
left=$(git diff --name-only --diff-filter=U)
[ -z "$left" ] || { echo "still conflicted (not lockfiles): $left"; exit 1; }
