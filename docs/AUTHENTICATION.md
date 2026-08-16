# Authentication

How a request becomes "this is a specific, verified human." See
[docs/AUTHORIZATION.md](AUTHORIZATION.md) for what happens next (turning
that identity into permission to act inside a specific tenant), and
[ADR 0006](adr/0006-authentication-strategy.md)/[ADR 0007](adr/0007-session-strategy.md)
for the reasoning behind the choices below.

## The chain

```
email + password -> login() -> session (token + row) -> cookie -> validateSessionToken() -> SessionUser
```

Nothing here involves a tenant. Authentication answers "who is this,"
full stop — it happens entirely through `provence360_auth`, the narrow
Postgres role that can look up `users`/`sessions` before any tenant
context exists. See [ADR 0008](adr/0008-domain-resolver-grant-hardening.md).

## Passwords

- Hashed with argon2id (`@node-rs/argon2`), never anything homegrown. `packages/auth/src/password.ts`.
- `users.password_hash` is nullable — a user can exist (added to a tenant by email, see [AUTHORIZATION.md](AUTHORIZATION.md#adding-a-member)) without ever having logged in yet.
- Never logged, never returned from any function, never included in any audit-log `metadata` object. `provence360_app` (every ordinary tenant-scoped request) has no grant on this column at all — see `packages/database/migrations/0003_auth_role_grants.sql`.
- No password-reset flow exists yet. An operator with direct database access can clear `password_hash` to `NULL` and re-provision, but there is no self-service "forgot password" today — a known gap, not a silent one (see [ROADMAP.md](ROADMAP.md)).

## Login (`packages/auth/src/login.ts`)

```ts
const { token, expiresAt, userId } = await login(email, plainTextPassword);
```

1. Rate-limit check (below) — throws `LoginRateLimitedError` before touching the password at all if this email has failed too many times recently.
2. Look up the user by email via `provence360_auth`.
3. Verify the password against the real hash if the user exists, or against a fixed dummy hash if not — see [ADR 0006](adr/0006-authentication-strategy.md#decision) for why this matters (an unknown-email login must not be measurably faster than a wrong-password one).
4. On failure: record an `AUTH_LOGIN_FAILURE` audit event (`tenant_id: null`, `metadata: { email }` — never the attempted password) and throw `InvalidCredentialsError`.
5. On success: record `AUTH_LOGIN_SUCCESS`, create a session, return its token.

The caller (`apps/admin/app/login/actions.ts`) renders both `InvalidCredentialsError` and any password-format issue as the exact same string: **"Invalid email or password."** Never "no such user," never "wrong password" — see [docs/SECURITY.md](SECURITY.md) on not letting a response shape reveal account existence.

## Rate limiting

DB-backed, not in-memory (`packages/auth/src/rate-limit.ts`): counts
`AUTH_LOGIN_FAILURE` audit rows for the given email in the last 15 minutes;
10 or more blocks further attempts with `LoginRateLimitedError` until the
window rolls forward. Reuses the existing append-only `audit_logs` table —
no new infrastructure, and correct regardless of how many app instances are
running (an in-memory counter would not be — see
[ADR 0006](adr/0006-authentication-strategy.md)).

**Known gap, stated plainly:** this is per-email, not per-IP. There is no
trusted client-IP plumbing in this codebase — a self-hosted deployment sits
behind whatever reverse proxy its operator chooses, and trusting an
`X-Forwarded-For` header without knowing the proxy topology in front of it
is worse than not trusting one at all (a forged header would let an
attacker bypass the limit entirely). Per-IP limiting, if added later, needs
that topology to be a deliberate deployment-time configuration, not a
default assumption.

## Where account-enumeration protection does and doesn't apply

The "invalid email or password, never more specific" rule above is about
the **anonymous** login endpoint — anyone, unauthenticated, can hit it. It
is deliberately not extended to `findUserByEmail()`
(`packages/auth/src/user-lookup.ts`), which powers "add an existing user as
a member of this tenant." That lookup tells an **already-authenticated**
caller who **already holds `member.invite`** in a specific tenant whether
a given email has an account — a normal, expected "invite by email" UX,
gated behind real authorization, not a probe an anonymous visitor can run.

That gate matters mechanically, not just conceptually: `addMemberAction`
(`apps/admin/app/admin/tenants/[tenantId]/members/actions.ts`) is a Next.js
Server Action, directly POST-able with any `tenantId`/email regardless of
what a given page happened to render. The email lookup runs **inside**
`withTenantPage`'s callback — after the session, membership, and
`member.invite` permission checks all pass — specifically so that calling
this action against a tenant the caller has no `member.invite` in (or no
membership in at all) fails closed before `findUserByEmail` ever runs.
Doing the lookup first and the permission check second would turn an
authenticated-and-gated capability into an unauthenticated-shaped
enumeration oracle against arbitrary tenant ids — this ordering is
deliberate, not incidental, and any future action following this same
"look something up, then act on it" shape should check permissions first
for the same reason.

## Sessions

- `createSession(userId)` generates 24 random bytes (192 bits), base64url-encoded, as the raw token. Only its SHA-256 hash is ever stored (`sessions.id`).
- The token lives in a single cookie, `p360_session` (`apps/admin/lib/session-cookie.ts`): `httpOnly`, `Secure` in production, `SameSite=Lax`, `path=/`.
- `validateSessionToken(token)` returns `null` for anything short of a present, unexpired, unrevoked session tied to a still-existing user. A session past half its 30-day lifetime is transparently renewed (sliding expiration) on validation.
- `revokeSessionToken(token)` (logout) and `revokeAllUserSessions(userId)` ("log out everywhere") take effect immediately — the very next `validateSessionToken()` call sees the revocation, with nothing to wait out.

## CSRF

Next.js Server Actions carry a built-in same-origin check on the request
(the framework rejects a cross-origin POST to an action endpoint before
application code ever runs). Combined with `SameSite=Lax` on the session
cookie — which is not attached to a cross-site POST in the first place —
this is the CSRF posture for v0.2. No separate CSRF token is issued or
checked; there is currently no non-Server-Action mutating endpoint that
would need one. If a plain REST-style mutation endpoint is ever added
outside Server Actions, it needs its own explicit CSRF protection before
shipping — this paragraph does not cover it.

## Seed data — never production credentials

`packages/database/src/scripts/seed.ts` sets every seeded user's password
to a single, published, well-known string
(`provence360-seed-only-not-a-real-password`). It exists purely so
`pnpm dev` and `pnpm test:e2e` have something to log in with locally. Never
reuse it, never run `pnpm db:seed` against a database that also holds real
user data, and never let a deploy pipeline run it against production.

## What logging in does NOT do

Authentication alone grants no access to any tenant's data. A valid
session proves "this is user X" — it says nothing about which tenants X
can act in, or with what role. That's `withAuthorizedTenantContext`'s job;
see [docs/AUTHORIZATION.md](AUTHORIZATION.md).
