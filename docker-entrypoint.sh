#!/bin/sh
set -e
if [ "$1" = "node" ] && [ "$2" = "server.js" ]; then
  if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "Applying database migrations…"
    (cd /app/tools && node node_modules/prisma/build/index.js migrate deploy)
  fi
  # Idempotent: company profile, chart of accounts, pipeline stages and the first owner (SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD).
  if [ "${RUN_SEED:-true}" = "true" ]; then
    echo "Seeding base data…"
    node /app/tools/seed.mjs
  fi
fi
exec "$@"
