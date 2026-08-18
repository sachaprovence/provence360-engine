# syntax=docker/dockerfile:1
#
# v1.0 — see docs/DEPLOYMENT.md, "Containerization" and ADR 0023, Decision
# 6. Built via `turbo prune`, Turborepo's own tool for isolating one app's
# real workspace dependency subset out of this pnpm monorepo, rather than a
# hand-maintained COPY list that would silently drift from the actual
# dependency graph as `packages/*` change.
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile -t provence360-web .

FROM node:22-alpine AS base
RUN corepack enable

# ---- prune: isolate @provence360/web's real dependency subset ----------
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npm install -g turbo@2.10.10 \
    && turbo prune @provence360/web --docker

# ---- install + build -----------------------------------------------------
FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# `NODE_ENV=production` here matches what a real deploy actually runs under
# — see docs/DEPLOYMENT.md and the CI workflow's own identical override for
# why this build step needs it explicit rather than inherited.
RUN NODE_ENV=production pnpm --filter @provence360/web run build

# ---- runtime: minimal, non-root, no dev deps, no source ------------------
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "apps/web/server.js"]
