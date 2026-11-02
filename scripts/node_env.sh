# Sourced, not run: `. scripts/node_env.sh`. Used by scripts that may start without a login shell
# (loop.sh, live.sh, worktree_setup.sh), where `fnm env` from an interactive rc file never ran.
# When `node` isn't the version pinned in ui/package.json (engines.node), put fnm's install of that version
# first on PATH. That dir also holds npm, corepack and, after `corepack enable`, the pnpm shim. It reads fnm's
# folder directly instead of `fnm env`/`fnm use`, which write a link under XDG_RUNTIME_DIR that the sandbox
# mounts read-only. Never fails the caller; prints a one-line hint when the pinned Node is missing (D-130).
# init.sh and verify.sh carry their own inline copy of this lookup (D-074: verify.sh sources nothing).
_lnv_want=$(sed -n 's/^ *"node": *"\([0-9.]*\)".*/\1/p' "$(dirname "${BASH_SOURCE[0]:-$0}")/../ui/package.json" 2>/dev/null | head -n 1)
if [ -n "$_lnv_want" ] && [ "$(node --version 2>/dev/null)" != "v$_lnv_want" ]; then
  _lnv_bin="${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}/node-versions/v$_lnv_want/installation/bin"
  if [ -x "$_lnv_bin/node" ]; then
    export PATH="$_lnv_bin:$PATH"
  elif command -v fnm >/dev/null 2>&1; then
    echo "node_env: Node $_lnv_want isn't installed. Outside the sandbox: fnm install $_lnv_want && corepack enable" >&2
  else
    echo "node_env: Node $_lnv_want not found. Install fnm (https://github.com/Schniz/fnm), then: fnm install $_lnv_want && corepack enable" >&2
  fi
fi
unset _lnv_want _lnv_bin
true
