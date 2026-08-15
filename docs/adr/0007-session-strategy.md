# ADR 0007: Opaque, database-backed sessions — not JWTs

## Status

Accepted.

## Context

Once a user has authenticated (ADR 0006), something has to let subsequent
requests recognize them without re-verifying a password every time. The
two standard shapes: a signed, stateless token (JWT) the server can verify
without a database round trip, or an opaque reference to server-side state
(a session id) that requires a lookup.

The brief is explicit that sessions must be **revocable, expiring, and
server-identifiable** — a logged-out session must stop working
_immediately_, not "once its token's `exp` claim is reached."

## Decision

**Opaque bearer tokens, database-backed**, not JWTs.

- `generateSessionToken()` (`packages/auth/src/session.ts`) produces 24 random bytes (192 bits) via Node's `crypto.randomBytes`, base64url-encoded — this is the value stored in the browser's cookie.
- The database never stores the raw token — only its SHA-256 hex digest, as the `sessions` table's primary key. Same defense-in-depth reasoning as password hashing (ADR 0006): a leaked database backup, a replication lag window, a misconfigured read replica — none of them hand out a usable session token, only a hash an attacker still can't present as a cookie.
- `sessions` is owned entirely by `provence360_auth` (see ADR 0008); `provence360_app`, the tenant-scoped role every ordinary request runs under, has **no grant on this table at all** — a session is an identity-plane concept, not tenant data, and the two are kept structurally separate the same way `provence360_resolver` is kept separate from both.
- Validation (`validateSessionToken()`) rejects anything short of a session that is simultaneously: present, unexpired, and not `revoked_at`-marked — tied to a user that still exists (enforced by the `sessions.user_id` foreign key with `onDelete: cascade`). It never throws for "this token doesn't work" — only `null`, so callers can't accidentally treat a database error as "not logged in."
- **Sliding expiration**: sessions last 30 days from issuance; a validation past the halfway point transparently renews `expires_at` another 30 days out and stamps `last_seen_at`. An active user is never logged out mid-session; an abandoned token still expires on schedule.
- **Revocation** (`revokeSessionToken`, logout; `revokeAllUserSessions`, "log out everywhere") sets `revoked_at` and is checked on every validation — the effect is immediate, visible on the very next request, with nothing to wait out. This is the property a JWT cannot give you without adding a server-side revocation list back in, at which point it has all of a database session's operational cost with none of its simplicity.
- The cookie (`apps/admin/lib/session-cookie.ts`) is `httpOnly` (unreachable from `document.cookie`, closing off exfiltration via an XSS bug), `Secure` in production only (not in local HTTP dev, where `Secure` would silently make the cookie never get sent), `SameSite=Lax`, `path=/`.

## Consequences

- Every authenticated request costs one indexed lookup (`sessions_user_id_idx` / the primary-key hash lookup) against `provence360_auth`'s connection — a deliberate, accepted cost. It is a single indexed point lookup, not a join across tenant data, so it stays cheap even as tenant content grows.
- Logout, and any future "revoke this session" admin action, are trivially correct: flip one column, and the very next validation sees it. A JWT-based design would need a denylist (itself a database, erasing the "stateless" selling point) to get the same guarantee.
- No horizontal-scaling cost that matters here: the session store is the same Postgres database everything else already depends on, not a new piece of infrastructure to run.
- This does mean sessions do not survive a total database outage the way a signed JWT technically could (a JWT can still be _verified_ with no database, even if nothing else in this system would work either) — an acceptable tradeoff, since a database outage already takes down every tenant-scoped read in this system regardless.
