#!/bin/sh
set -e
if [ "$1" = "node" ] && [ "$2" = "server.js" ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations…"
  (cd /app/tools && node node_modules/prisma/build/index.js migrate deploy)
fi
exec "$@"
