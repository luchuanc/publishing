#!/bin/sh
# Invoked by the owner's crontab. flock prevents duplicate Node processes.
set -eu
umask 077

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BIN=${1:?Pass the absolute Node.js 24 executable path}
export PATH="$(dirname -- "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
cd "$APP_DIR"
test -f .data/service.enabled || exit 0
exec 9>.data/supervisor.lock
flock -n 9 || exit 0
# Recheck after locking so a concurrent stop cannot start a new process.
test -f .data/service.enabled || exit 0
printf '%s\n' "$$" >.data/service.pid
exec "$NODE_BIN" --env-file=.env server/index.mjs >>.data/service.log 2>&1
