#!/bin/bash
# Finder starts with a minimal PATH. Resolve and verify a runtime before using it.
set -eu
optracall_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
optracall_node=''
for optracall_candidate in \
  "$optracall_root/.runtime/node/bin/node" \
  "$HOME/Library/Application Support/OptraCall/runtime/node/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$optracall_candidate" ] && [ -x "$optracall_candidate" ] && \
    "$optracall_candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 25 ? 0 : 1)' >/dev/null 2>&1; then
    optracall_node=$optracall_candidate
    break
  fi
done
if [ -z "$optracall_node" ]; then
  printf '%s\n' 'OptraCall 需要 Node.js 25 或更新版本。请反馈部署问题；启动入口不会自动安装或更新。' >&2
  exit 1
fi
PATH="$(dirname -- "$optracall_node"):$optracall_root/.runtime/python/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PATH
cd -- "$optracall_root"
exec "$optracall_node" "$optracall_root/scripts/trial-launcher.mjs" "$@"
