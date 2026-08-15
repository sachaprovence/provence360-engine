# ADR 0006: Email + password authentication, self-hosted, argon2id

## Status

Accepted.

## Context

Foundation v0.2 needs real authentication: something that identifies a
human behind a request, before any tenant or authorization question can
even be asked (`User → Authenticated Session → Membership → Authorization
→ Tenant Context → PostgreSQL RLS → Data`, never `User → browser-supplied
tenantId → Data` — see `docs/SECURITY.md`). The brief is explicit that this
must be self-hostable with no mandatory third-party SaaS dependency: a
deployer with nothing but Postgres and Node must be able to run the whole
system.

The candidates considered:

- **A hosted identity provider** (Auth0, Clerk, WorkOS, ...). Rejected outright — it makes "self-hostable" false, and introduces a dependency this project has no way to guarantee for every future deployer.
- **OAuth/social login only.** Rejected for v0.2: still requires _some_ first-party credential to exist for the self-hosted case, and adds an entire redirect/callback/provider-config surface the brief didn't ask for. Not precluded for a later phase (see `docs/ROADMAP.md`).
- **Email + password**, hashed and verified entirely within this codebase. Chosen: the minimum viable, fully self-hosted mechanism, and the one every other choice here would eventually need to fall back to anyway.

## Decision

- Passwords are hashed with **argon2id** via `@node-rs/argon2` (a native Rust binding with prebuilt binaries — no `node-gyp` compile step, no pure-JS fallback that would be measurably weaker). Parameters (`packages/auth/src/password.ts`): `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` — OWASP's password-storage cheat sheet baseline, tuned for a server process rather than constrained hardware. Never `bcrypt`/`scrypt`-by-hand, never a homegrown scheme.
- `verifyPassword()` uses argon2's own constant-time verify — never a manual `hash === stored` comparison, which would leak timing information about how many characters matched.
- `users.password_hash` is nullable (a user can exist — e.g. added as a member before ever logging in — without a usable password yet) and is never selected, logged, or included in any audit-log `metadata`. It is not reachable through `provence360_app` at all (see ADR 0008); only `provence360_auth` can read or write it, and only `password_hash`/`updated_at` are grantable columns for `UPDATE` — see `packages/database/migrations/0003_auth_role_grants.sql`.
- **Timing-safe login** (`packages/auth/src/login.ts`): looking up a nonexistent email skips the (deliberately expensive) argon2 verify unless the code also verifies against something — that asymmetry is itself a user-enumeration oracle via response latency. `login()` always calls `verifyPassword()`, against the real hash when the user exists, against a lazily-computed, memoized dummy hash otherwise, so both branches do comparable work. The error returned to the caller is identical either way: `InvalidCredentialsError`, rendered as "Invalid email or password." — never "no such user," never "wrong password."
- **Rate limiting** (`packages/auth/src/rate-limit.ts`) is DB-backed, not in-memory: it counts `AUTH_LOGIN_FAILURE` audit-log rows for the given email within a 15-minute window (threshold 10) rather than keeping a counter in process memory. An in-memory counter is quietly wrong the moment more than one app instance runs — each instance has its own counter, and the effective limit becomes `threshold × instance count`. Reusing the existing append-only `audit_logs` table means no new infrastructure and an exact count regardless of instance count.
  - This is deliberately coarse: per-email, not per-IP (no trusted client-IP plumbing exists yet — a reverse proxy's `X-Forwarded-For` cannot be trusted without knowing which proxies are in front of a given self-hosted deployment, and getting that wrong silently disables the limiter). Documented as a real gap in `docs/AUTHENTICATION.md#rate-limiting`, not hidden behind a rate limiter that quietly does less than its name implies.
- **No self-service signup in v0.2.** Users are provisioned by an existing tenant OWNER/ADMIN adding an _existing_ user by email (`packages/auth/src/user-lookup.ts`'s `findUserByEmail`) to their tenant, or by the seed script. A signup flow (email verification, password-reset flow) is out of scope for this phase — see `docs/ROADMAP.md`.

## Consequences

- The whole system runs with nothing but Postgres — no external identity service to configure, no API key to provision, consistent with the "hundreds of self-hosted seasonal-rental sites" goal.
- Password-reset and email verification don't exist yet; an operator without direct database access has no self-service recovery path today. Tracked as a known gap, not a silent omission — see `docs/ROADMAP.md`.
- Rate limiting is real but intentionally modest — a determined distributed attacker spreading attempts across many emails, or an attacker who can also flood _successful_ logins, is not what this stops. It stops naive credential-stuffing against one account, which is what a first pass at this needed to do honestly.
- Every future authentication surface (a CLI, a mobile client, a future OAuth provider) funnels through the same `login()` → `createSession()` path, so the rate limiter, the audit trail, and the timing-safe comparison all apply uniformly rather than needing to be reimplemented per client.
