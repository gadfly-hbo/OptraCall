#!/bin/bash
set -eu
optracall_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec /bin/bash "$optracall_root/scripts/trial-command.sh" update "$@"
