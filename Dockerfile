# syntax=docker/dockerfile:1.7
# Production image for Azure Container Apps (same pattern as Dukaan Express).
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm ci
COPY . .
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    JWT_SECRET="build-time-placeholder-not-used-at-runtime-000" \
    npm run build \
 && npx esbuild prisma/seed.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/seed.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# Prisma CLI only, for `migrate deploy` on start-up
FROM node:${NODE_VERSION} AS tools
WORKDIR /tools
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund prisma@7.10.1 dotenv >/dev/null
COPY prisma ./prisma
COPY prisma.config.ts ./

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /src/.next/standalone ./
COPY --from=build --chown=app:app /src/.next/static ./.next/static
COPY --from=build --chown=app:app /src/public ./public
COPY --from=tools --chown=app:app /tools ./tools
COPY --from=build --chown=app:app /src/dist/seed.mjs ./tools/seed.mjs
COPY --chown=app:app docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER app
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
