# syntax=docker/dockerfile:1
#
# See apps/web/Dockerfile for the `turbo prune` rationale. The runtime stage
# differs: the worker has no bundler (no Next.js), so `CMD` execs `tsx`
# directly against the raw `src/` — see docs/ARCHITECTURE.md, "Why packages
# have no build step", and ADR 0023, Decision 2, for why `node dist/index.js`
# cannot resolve `packages/*`'s raw-TypeScript imports and `tsx` is the
# correct fix, not a shortcut. Direct-exec `CMD` (not `pnpm start`) so
# SIGTERM reaches this process as PID 1 instead of a `pnpm` wrapper —
# verified manually (see the v1.0 final report).
#
# v1.0.1 — brief SUJET A: `CMD` invokes `tsx` via `node --import tsx`, not
# the pnpm-generated `node_modules/.bin/tsx` shim. `tsx` is a direct
# dependency of `@provence360/worker` only, so pnpm's isolated linker puts
# its bin shim at `apps/worker/node_modules/.bin/tsx` — never hoisted to
# the workspace root `node_modules/.bin/` this image actually copies. A
# real `docker run` of this image (added this release — a `docker build`
# passing had never proven a container could actually start) failed with
# `Cannot find module '/app/node_modules/.bin/tsx'` — that path never
# existed. `--import tsx` uses Node's own module resolution starting from
# the process's CWD (`/app/apps/worker`, set below), the same proven
# pattern `apps/worker/src/index.test.ts` already spawns the real process
# with — no fragile shim path, and `node` still execs directly as CMD, so
# it's still PID 1 for signal delivery.
#
# Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t provence360-worker .

FROM node:22-alpine AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN npm install -g turbo@2.10.10 \
    && turbo prune @provence360/worker --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# A real type-check gate, not what actually runs at runtime — see the
# comment above.
RUN pnpm --filter @provence360/worker run typecheck

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 worker

COPY --from=builder --chown=worker:nodejs /repo/apps/worker ./apps/worker
COPY --from=builder --chown=worker:nodejs /repo/packages ./packages
COPY --from=builder --chown=worker:nodejs /repo/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /repo/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

USER worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker

CMD ["node", "--import", "tsx", "src/index.ts"]
