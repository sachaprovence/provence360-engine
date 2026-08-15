# Roadmap

## What Foundation v0.1 is

The tenancy model, the security boundary (Postgres RLS, three-role
defense-in-depth), and the hostname resolution pipeline
(`Host -> DomainResolver -> Site -> Tenant`), proven by tests that exercise
a real Postgres database and a real running Next.js server. Nothing more.

## What Foundation v0.1 explicitly is not

Deferred on purpose, per the original brief — building any of these now
would mean guessing at requirements the later phases haven't settled yet:

- **The CMS.** No pages, blocks, or content editing beyond the placeholder `sites.name`/`slug`.
- **The theme engine.** `apps/web`'s renderer is a static placeholder proving the resolution pipeline, not a themeable layout system.
- **The block engine.** No composable page-building primitives.
- **The booking engine.** No availability, pricing, or reservation flow — the entire reason this platform exists, and entirely out of scope for a foundation phase.
- **Airbnb/Booking.com integrations.** No channel management, no iCal sync.
- **AI features.** None.
- **The automatic site generator.** Provisioning a new site is a manual `INSERT` (or the dev seed script) today, not a guided or automated flow.

## Known gaps left for the next phase

- **Authentication.** No login flow, no session storage, no password/OAuth handling. `packages/auth` only defines the _shape_ (`RequestActor`, `MembershipRole`) that a real implementation will need to produce. `apps/admin` is unauthenticated and must not be deployed publicly reachable until this lands.
- **Fine-grained permissions.** `memberships.role` is a flat `member`/`admin`/`owner`; `hasAtLeastRole()` in `packages/auth` establishes the comparison convention but there's no per-resource scoping.
- **`Draft`/`Releases`.** Sites have no publish workflow — what's in the `sites` row is what's live. The request pipeline's `PublishedRelease` step (see `docs/ARCHITECTURE.md`) is a no-op today.
- **`Theme`/`Settings`/`Assets`/`Pages` models.** Named in the target architecture, not implemented — schema and repositories will follow the same tenant-scoped, RLS-policed pattern as `sites`/`domains` when they land.
- **Real observability.** `packages/observability`'s logger is structured JSON-lines to stdout; no OTel export, no tracing, no metrics backend.
- **Worker jobs.** `apps/worker` is a heartbeat-only process boundary — domain re-verification, release publishing, and any other scheduled work land here once there's something to schedule.
- **Column-level grants are hand-maintained.** `packages/database/src/admin/setup-roles.ts` grants specific columns to `provence360_resolver` by listing them explicitly; a schema change that adds a routing-relevant column needs that list updated by hand (deliberately — this is a security boundary, not something to infer automatically).
