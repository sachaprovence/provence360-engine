# ADR 0001: Monorepo (pnpm workspaces + Turborepo)

## Status

Accepted.

## Context

A platform meant to serve hundreds of sites from one technical base needs
several deployable processes (public site renderer, internal admin, a
background worker) that all share the same tenancy model, the same
database schema, and the same security boundary. That sharing has to be
enforced by imports, not by copy-pasting code between repositories and
hoping they stay in sync.

## Decision

A single repository, pnpm workspaces for package linking, Turborepo for
task orchestration (`build`/`lint`/`typecheck`/`test` across all
workspaces, with caching and dependency-aware ordering). `packages/*` are
plain TypeScript source with no build step of their own — see
`docs/ARCHITECTURE.md#why-packages-have-no-build-step` — consumed directly
by `tsx`, Vitest, and Next.js's `transpilePackages`.

## Consequences

- Adding a tenant-isolation guarantee (e.g. a new RLS policy) in `packages/database` is immediately available, at the same version, to every app — there is no publish/bump/upgrade cycle to keep multiple repos in lockstep.
- `pnpm verify` at the root is one command that proves the whole system is coherent, not just one package in isolation.
- The tradeoff: a monorepo makes it easy to accidentally couple things that shouldn't be coupled. This is why the dependency graph in `docs/ARCHITECTURE.md` is kept intentionally acyclic and narrow (e.g. `packages/database`'s admin connection is reachable but not re-exported from its main entry point — a convention, documented in `docs/SECURITY.md`, not a hard barrier).
