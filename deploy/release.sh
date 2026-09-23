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
(cd "$HERE" && pnpm --filter @velnes/api build)

echo "▶ upload → $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p '$REMOTE_DIR/migrations'"
rsync -az --delete --exclude node_modules --exclude .env --exclude ecosystem.config.cjs \
  --exclude release-remote.sh --exclude migrations \
  "$HERE/services/api/dist/" "$TARGET:$REMOTE_DIR/"
rsync -az --delete "$HERE/db/migrations/" "$TARGET:$REMOTE_DIR/migrations/"
rsync -az "$HERE/deploy/ecosystem.config.cjs" "$HERE/deploy/release-remote.sh" "$TARGET:$REMOTE_DIR/"

echo "▶ install runtime dependencies, migrate, restart"
ssh "$TARGET" bash "$REMOTE_DIR/release-remote.sh" "$REMOTE_DIR"
echo "✔ released"
