# Sourced by scripts/init.sh and scripts/verify.sh from the repository root: the environment both
# need, the same way locally, inside the Claude Code sandbox and in CI.

# pnpm reads npm_config_* before HTTPS_PROXY, but inside the Claude Code sandbox only HTTPS_PROXY and NO_PROXY
# point at the sandbox proxy, so make pnpm follow them (no effect when no proxy is set). D-057.
if [ -n "${HTTPS_PROXY:-}" ]; then
  export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" npm_config_noproxy="${NO_PROXY:-}"
fi

# Node: ui/package.json pins engines.node (D-058). When plain `node` is another version, put a `node` link to
# the fallback binary first on PATH (D-061: Jay's system node stays on 22; Fedora's nodejs24 is node-24).
NODE_WANT=$(sed -n 's/^ *"node": *"\([0-9.]*\)".*/\1/p' ui/package.json 2>/dev/null | head -n 1)
NODE_FALLBACK="${LECTER_NODE_FALLBACK:-/usr/bin/node-24}"
NODE_NOTE=""
if [ -n "$NODE_WANT" ] && [ "$(node --version 2>/dev/null)" != "v$NODE_WANT" ] \
  && [ -x "$NODE_FALLBACK" ] && [ "$("$NODE_FALLBACK" --version 2>/dev/null)" = "v$NODE_WANT" ]; then
  _shim="${TMPDIR:-/tmp}/lecter-node-v$NODE_WANT"
  mkdir -p "$_shim" 2>/dev/null && { [ -e "$_shim/node" ] || ln -s "$NODE_FALLBACK" "$_shim/node" 2>/dev/null || true; }
  if [ "$("$_shim/node" --version 2>/dev/null)" = "v$NODE_WANT" ]; then
    export PATH="$_shim:$PATH"
    NODE_NOTE="node: using $NODE_FALLBACK (v$NODE_WANT)"
  fi
  unset _shim
fi

# pnpm keeps its store lock under XDG_RUNTIME_DIR, which the sandbox mounts read-only.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
# When the home store is on another mount than the checkout (the sandbox bind-mounts the checkout), pnpm puts a
# ~300 MB store inside the checkout, which gitleaks then scans. Keep it in the home store instead. pnpm 12 reads
# pnpm_config_*, not npm_config_*. CI never hits this, so its pnpm cache path is unchanged.
if [ -z "${pnpm_config_store_dir:-}" ] && [ -f ui/package.json ] && command -v pnpm >/dev/null 2>&1; then
  case "$(pnpm -C ui store path 2>/dev/null)" in
    "$PWD"/*) export pnpm_config_store_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store" ;;
  esac
fi
