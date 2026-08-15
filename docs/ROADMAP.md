# Roadmap

## What Foundation v0.1 is

The tenancy model, the security boundary (Postgres RLS, three-role
defense-in-depth), and the hostname resolution pipeline
(`Host -> DomainResolver -> Site -> Tenant`), proven by tests that exercise
a real Postgres database and a real running Next.js server. Nothing more.

## What Foundation v0.2 adds

Real, self-hosted authentication and tenant-scoped authorization on top of
v0.1's foundation, without touching any of its guarantees — no RLS policy
weakened, no tenant isolation test removed, no default tenant introduced:

- **Authentication** — email + password, argon2id, opaque database-backed sessions, DB-backed login rate limiting. See [docs/AUTHENTICATION.md](AUTHENTICATION.md), [ADR 0006](adr/0006-authentication-strategy.md), [ADR 0007](adr/0007-session-strategy.md).
- **Authorization** — a permission catalog per `MembershipRole`, `withAuthorizedTenantContext` as the single chain from session to RLS-scoped transaction, the owner invariant, Not-Found-over-Forbidden. See [docs/AUTHORIZATION.md](AUTHORIZATION.md).
- **A fourth Postgres role**, `provence360_auth`, narrow and column-restricted like the resolver role — and the resolver's own grants moved from a hand-maintained script into a versioned migration. See [ADR 0008](adr/0008-domain-resolver-grant-hardening.md).
- **A real (if minimal) Control Plane** in `apps/admin` — login, a tenant switcher, and per-tenant sites/domains/members/audit views, every route re-checking Membership server-side rather than trusting the URL.
- **The platform-admin/tenant-owner boundary documented**, with no UI built yet — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).

## What's still explicitly out of scope

Deferred on purpose, per the original brief — building any of these now
would mean guessing at requirements the later phases haven't settled yet:

- **The CMS.** No pages, blocks, or content editing beyond the placeholder `sites.name`/`slug`.
- **The theme engine.** `apps/web`'s renderer is a static placeholder proving the resolution pipeline, not a themeable layout system.
- **The block engine.** No composable page-building primitives.
- **The booking engine.** No availability, pricing, or reservation flow — the entire reason this platform exists, and entirely out of scope for a foundation phase.
- **Airbnb/Booking.com integrations.** No channel management, no iCal sync.
- **AI features.** None.
- **The automatic site generator.** Provisioning a new site is a manual admin action (or the dev seed script) today, not a guided or automated flow.
- **A platform super-admin.** No way to act across every tenant through the web application — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md).

## Known gaps left for the next phase

- **No self-service signup, password reset, or email verification.** A user is provisioned by an existing OWNER/ADMIN or the seed script. See [docs/AUTHENTICATION.md](AUTHENTICATION.md).
- **Login rate limiting is per-email, not per-IP.** No trusted client-IP plumbing exists yet — documented explicitly as a gap in [docs/AUTHENTICATION.md#rate-limiting](AUTHENTICATION.md#rate-limiting) rather than papered over with an untrustworthy header.
- **Fine-grained, per-resource permissions.** The permission catalog (`packages/auth/src/permissions.ts`) is role-based, not per-object (e.g. no "can edit this one site but not that one" within a tenant).
- **`Draft`/`Releases`.** Sites have no publish workflow — what's in the `sites` row is what's live. The request pipeline's `PublishedRelease` step (see `docs/ARCHITECTURE.md`) is a no-op today.
- **`Theme`/`Settings`/`Assets`/`Pages` models.** Named in the target architecture, not implemented — schema and repositories will follow the same tenant-scoped, RLS-policed pattern as `sites`/`domains` when they land.
- **Real observability.** `packages/observability`'s logger is structured JSON-lines to stdout; no OTel export, no tracing, no metrics backend, no request-id correlation across service boundaries yet.
- **Worker jobs.** `apps/worker` is a heartbeat-only process boundary — domain re-verification, release publishing, session cleanup, and any other scheduled work land here once there's something to schedule.
- **A platform super-admin.** Deliberately undesigned so far — see [ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md) for why it needs its own identity concept rather than an extension of `MembershipRole`.
