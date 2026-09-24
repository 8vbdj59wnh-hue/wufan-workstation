#!/usr/bin/env bash

wufan_resolve_node_runtime() {
  local configured_node configured_npm configured_pm2 node_dir node_major

  configured_node="${WUFAN_NODE_COMMAND:-${WUFAN_NODE22_BIN:-}}"
  if [[ -n "$configured_node" && -d "$configured_node" ]]; then
    configured_node="$configured_node/node"
  fi
  if [[ -z "$configured_node" && -x /opt/homebrew/opt/node@22/bin/node ]]; then
    configured_node="/opt/homebrew/opt/node@22/bin/node"
  fi
  if [[ -z "$configured_node" ]]; then
    configured_node="$(command -v node || true)"
  fi
  [[ -n "$configured_node" && -x "$configured_node" ]] \
    || { echo "NODE_RUNTIME_FAIL: Node is unavailable" >&2; return 1; }

  node_major="$("$configured_node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [[ "$node_major" == "22" ]] \
    || { echo "NODE_RUNTIME_FAIL: Node.js major version must be 22" >&2; return 1; }

  node_dir="$(cd "$(dirname "$configured_node")" && pwd -P)"
  configured_npm="${WUFAN_NPM_COMMAND:-}"
  if [[ -z "$configured_npm" && -x "$node_dir/npm" ]]; then
    configured_npm="$node_dir/npm"
  fi
  if [[ -z "$configured_npm" ]]; then
    configured_npm="$(PATH="$node_dir:$PATH" command -v npm || true)"
  fi
  [[ -n "$configured_npm" && -x "$configured_npm" ]] \
    || { echo "NODE_RUNTIME_FAIL: npm for Node.js 22 is unavailable" >&2; return 1; }

  configured_pm2="${WUFAN_PM2_COMMAND:-}"
  if [[ -z "$configured_pm2" ]]; then
    configured_pm2="$(PATH="$node_dir:$PATH" command -v pm2 || true)"
  fi
  [[ -n "$configured_pm2" && -x "$configured_pm2" ]] \
    || { echo "NODE_RUNTIME_FAIL: PM2 is unavailable" >&2; return 1; }

  export NODE_COMMAND="$configured_node"
  export NPM_COMMAND="$configured_npm"
  export PM2_COMMAND="$configured_pm2"
  export PATH="$node_dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
}
