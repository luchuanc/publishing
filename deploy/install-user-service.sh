#!/bin/sh
# Install only this application's entries, preserving any existing user jobs.
set -eu
umask 077

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BIN=${1:?Pass the absolute Node.js 24 executable path}
case "$APP_DIR:$NODE_BIN" in
  *[!A-Za-z0-9_./:-]*) echo 'Service paths must not contain spaces or shell metacharacters.' >&2; exit 1 ;;
esac
test -x "$NODE_BIN"
"$NODE_BIN" -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)'
command -v flock >/dev/null
command -v crontab >/dev/null
cd "$APP_DIR"
test -f .env
test -f dist/index.html
mkdir -p .data
chmod 700 .data

OLD=$(mktemp)
NEW=$(mktemp)
trap 'rm -f "$OLD" "$NEW"' EXIT HUP INT TERM
if ! crontab -l >"$OLD" 2>.data/crontab-install.error; then
  if ! grep -q 'no crontab' .data/crontab-install.error; then
    cat .data/crontab-install.error >&2
    exit 1
  fi
fi
cp "$OLD" .data/crontab.before-publishing
awk '/^# BEGIN publishing-user-service$/{skip=1;next} /^# END publishing-user-service$/{skip=0;next} !skip' "$OLD" >"$NEW"
{
  printf '\n# BEGIN publishing-user-service\n'
  printf '@reboot /bin/sh %s/deploy/run-user-service.sh %s\n' "$APP_DIR" "$NODE_BIN"
  printf '* * * * * /bin/sh %s/deploy/run-user-service.sh %s\n' "$APP_DIR" "$NODE_BIN"
  printf '# END publishing-user-service\n'
} >>"$NEW"
touch .data/service.enabled
crontab "$NEW"
printf 'Installed for %s. Cron will start the service within one minute.\n' "$(id -un)"
