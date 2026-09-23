#!/usr/bin/env bash
# One release of the Velnes API to the shared VPS (deploy/DEPLOY.md).
#
#   deploy/release.sh deploy@vps.example.com
#
# Builds here, uploads the build and the migrations, installs the exact
# runtime dependencies on the server, migrates the database as the
# owning role, restarts the PM2 app, and checks health. Nothing else on
# the VPS is touched. The server's .env must already exist (see
# deploy/env.production.example) — it is never uploaded or overwritten.
set -euo pipefail

TARGET="${1:?usage: deploy/release.sh user@host [remote dir, default /srv/velnes/api]}"
REMOTE_DIR="${2:-/srv/velnes/api}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ build"
(cd "$HERE" && pnpm --filter @velnes/contracts build >/dev/null && pnpm --filter @velnes/api build)

echo "▶ upload → $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p '$REMOTE_DIR/migrations'"
rsync -az --delete --exclude node_modules --exclude .env --exclude ecosystem.config.cjs \
  "$HERE/services/api/dist/" "$TARGET:$REMOTE_DIR/"
rsync -az --delete "$HERE/db/migrations/" "$TARGET:$REMOTE_DIR/migrations/"
rsync -az "$HERE/deploy/ecosystem.config.cjs" "$TARGET:$REMOTE_DIR/ecosystem.config.cjs"

echo "▶ install runtime dependencies, migrate, restart"
ssh "$TARGET" bash -s "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
DIR="$1"; cd "$DIR"
test -f .env || { echo "missing $DIR/.env — copy deploy/env.production.example first"; exit 1; }
npm ci --omit=dev --no-audit --no-fund
set -a; . ./.env; set +a
dbmate -u "${DATABASE_URL}" -d "$DIR/migrations" --no-dump-schema up
if pm2 describe velnes-api >/dev/null 2>&1; then pm2 restart velnes-api --update-env; else pm2 start "$DIR/ecosystem.config.cjs"; fi
pm2 save >/dev/null
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-6000}/api/v1/health" && echo && pm2 describe velnes-api | grep -E "status|restarts" | head -2
REMOTE
echo "✔ released"
