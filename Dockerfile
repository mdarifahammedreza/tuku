# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY services/bot/package.json services/bot/
COPY services/mcp/package.json services/mcp/
COPY packages/core/package.json packages/core/
# --ignore-scripts skips the test-only MongoDB binary download
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS source
COPY tsconfig.base.json ./
COPY packages packages
COPY services services
COPY apps apps

FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @finance/web build

# ---- web: Next.js standalone server ----
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]

# ---- bot & mcp: TypeScript run directly with tsx ----
FROM source AS service
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node

FROM service AS bot
WORKDIR /app/services/bot
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM service AS mcp
WORKDIR /app/services/mcp
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8082/healthz || exit 1
CMD ["node", "--import", "tsx", "src/http.ts"]
