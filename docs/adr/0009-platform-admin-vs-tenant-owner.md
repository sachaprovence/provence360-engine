# ADR 0009: Tenant OWNER is not a platform super-admin

## Status

Accepted. No platform super-admin UI or role exists yet — this ADR
documents the conceptual boundary so the two are never implicitly conflated
as one gets built later.

## Context

`MembershipRole` (`owner` / `admin` / `member` — `packages/auth/src/roles.ts`,
`packages/auth/src/permissions.ts`) is scoped **per Membership, per
Tenant**. A user who is `owner` of Tenant A has full permissions inside
Tenant A and precisely zero standing anywhere else — `withAuthorizedTenantContext`
re-derives a Membership lookup for every request, for the specific
`tenantId` in play, every time (see ADR 0006/0007 and `docs/AUTHORIZATION.md`).

Nothing about being the OWNER of one, ten, or every tenant on a given
deployment grants any authority over the _platform_ itself: suspending an
unrelated tenant, reading another tenant's audit log, impersonating another
tenant's user, changing platform-wide configuration. There is no code path
today that would let an OWNER do any of that, and that absence is
intentional, not an oversight to eventually close by quietly widening
`owner`.

The risk this ADR heads off: a future feature ("let platform staff manage
customer tenants") gets bolted on by special-casing `role === "owner"`
somewhere, or by granting one tenant's OWNER membership in _every_ tenant
as a workaround — both of which would silently resurrect exactly the
"implicit super-admin" pattern the v0.1 and v0.2 briefs explicitly
prohibit ("pas de super-admin implicite").

## Decision

- **Tenant OWNER and platform super-admin are two different concepts and must never share a code path.** `MembershipRole` answers "what can this user do inside this one tenant they have a Membership in." It is not, and must never become, an answer to "what can this user do across the whole platform."
- A platform-level administrative capability (suspending a tenant, impersonating a user for support, reading cross-tenant metrics) — if and when it's built — needs its **own** identity concept, deliberately: e.g. a `platform_admins` table/flag outside the tenant-scoped Membership model entirely, checked by its own dedicated function (not `can()`, not `getPermissionsForRole()`), and its own audit trail distinguishing platform actions from tenant actions.
- Until that's built, **there is no way to perform a platform-level administrative action through this codebase**, by any role, including OWNER. The closest thing that exists today — the admin/owner Postgres role (`provence360` in `.env`) used by migrations, seed scripts, and fixtures — is an _operator_ capability (someone with direct database/deploy access), not a role reachable through the web application at all. It is out of scope of the HTTP-facing authorization model entirely.
- `apps/admin` (the Control Plane) has no "all tenants" view, no cross-tenant search, and no route that doesn't require a real Membership in the specific tenant being viewed. This is a direct consequence of the above, not an independent decision.

## Consequences

- A future platform-admin feature has a clean, pre-decided place to live (a new, separate identity/authorization mechanism) instead of a temptation to extend `MembershipRole` with a fourth value like `"superadmin"` that would then need special-casing in every permission check that currently just calls `can(role, permission)`.
- Today, the only way to act across every tenant is direct database/infrastructure access — appropriate for a young, single-operator-hosted system, and explicitly flagged in `docs/ROADMAP.md` as the thing to revisit once multi-operator platform administration is actually needed.
- Every review of a new admin feature can ask one sharpening question: "is this a tenant-scoped capability (→ `MembershipRole` + `can()`) or a platform-scoped one (→ does not exist yet, needs its own design)?" — and reject a PR that answers "platform" by quietly reusing `owner`.
