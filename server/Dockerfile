# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN npm install -g pnpm@11.2.2

WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json  ./packages/config/package.json
COPY packages/crypto/package.json  ./packages/crypto/package.json
COPY packages/db/package.json      ./packages/db/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
COPY packages/api/package.json     ./packages/api/package.json
COPY packages/ui/package.json      ./packages/ui/package.json
COPY server/package.json           ./server/package.json
COPY apps/web/package.json         ./apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY server/   ./server/
COPY apps/web/ ./apps/web/

# Build web → apps/web/dist
RUN pnpm --filter @psst/web build

# Build server → server/dist/index.js (tsup bundles @psst/* packages inline)
RUN pnpm --filter @psst/server build

# ── Stage 2: Run ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

# Strip workspace:* deps and install only external npm packages
COPY server/package.json /tmp/server-package.json
RUN node -e "\
  const pkg = JSON.parse(require('fs').readFileSync('/tmp/server-package.json', 'utf8'));\
  pkg.dependencies = Object.fromEntries(\
    Object.entries(pkg.dependencies || {}).filter(([, v]) => !String(v).startsWith('workspace:'))\
  );\
  delete pkg.devDependencies;\
  require('fs').writeFileSync('package.json', JSON.stringify(pkg));\
" && npm install --omit=dev --ignore-scripts

# Server bundle
COPY --from=builder /app/server/dist ./dist

# Drizzle migration SQL files — applied on container start by docker-entrypoint.sh
COPY --from=builder /app/packages/db/drizzle ./drizzle

# Web static files — served by Hono from ./public at runtime
COPY --from=builder /app/apps/web/dist ./public

COPY server/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
