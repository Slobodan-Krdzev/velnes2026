#!/usr/bin/env bash
# The server-side half of a release, run by deploy/release.sh over SSH
# after the build was uploaded:  bash release-remote.sh /srv/velnes/api
# Runs from a file on disk (not over stdin — npm would eat the script).
set -euo pipefail
DIR="${1:?remote dir}"
cd "$DIR"
test -f .env || { echo "missing $DIR/.env — copy deploy/env.production.example first"; exit 1; }

echo "· npm ci"
npm ci --omit=dev --no-audit --no-fund </dev/null

set -a; . ./.env; set +a
: "${DATABASE_URL:?DATABASE_URL missing from .env (the owner role, for migrations)}"

echo "· migrate"
dbmate -u "$DATABASE_URL" -d "$DIR/migrations" --no-dump-schema up </dev/null

echo "· pm2"
if pm2 describe velnes-api >/dev/null 2>&1; then
  pm2 restart velnes-api --update-env </dev/null
else
  pm2 start "$DIR/ecosystem.config.cjs" </dev/null
fi
pm2 save >/dev/null </dev/null

sleep 3
echo "· health"
curl -fsS "http://127.0.0.1:${PORT:-6000}/api/v1/health" && echo
pm2 describe velnes-api | grep -E "status|restarts|uptime" | head -3
