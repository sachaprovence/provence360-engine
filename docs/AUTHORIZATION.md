# Authorization

How "this is a specific, verified human" (see
[docs/AUTHENTICATION.md](AUTHENTICATION.md)) becomes "this human may do
this specific thing, in this specific tenant." See
[ADR 0009](adr/0009-platform-admin-vs-tenant-owner.md) for the boundary
between this (tenant-scoped authorization) and a platform-wide
super-admin concept, which does not exist in this codebase.

## The chain, end to end

```
User -> Authenticated Session -> Membership -> Authorization -> Tenant Context -> PostgreSQL RLS -> Data
```

Never `User -> browser-supplied tenantId -> Data`. A URL's `[tenantId]`
segment, a hidden form field, a request body — none of it is proof of
anything. Every step above is re-derived from the session on every single
request; nothing is cached across requests, and nothing is inferred from
what the previous page happened to render.

## `withAuthorizedTenantContext` — the one door in

```ts
import { withAuthorizedTenantContext } from "@provence360/auth";

const result = await withAuthorizedTenantContext(
  { sessionToken, tenantId, permission: "site.create" },
  async (tx, actor) => {
    // tx: an RLS-scoped transaction, exactly like withTenantContext's
    // actor: { userId, tenantId, membershipId, role, permissions }
    return createSite(tx, { ...input, actorUserId: actor.userId });
  },
);
```

Five steps, each a hard stop (`packages/auth/src/with-authorized-tenant-context.ts`):

1. **Session** — `sessionToken` must resolve to a real, unexpired, unrevoked session. Else `AuthenticationError`.
2. **Format** — `tenantId` must be a well-formed UUID. Else `AuthorizationError` — deliberately not a distinct "bad request" shape; see [Not-Found over Forbidden](#not-found-over-forbidden) below.
3. **Membership** — the session's user must have a `Membership` row in that specific tenant, and the tenant must be `active`. Else `AuthorizationError`. This is the step that makes "I know Tenant B's real UUID" and "I can edit the URL to Tenant B" both useless on their own — knowing an id is not the same as having a Membership in it.
4. **Permission** — if a `permission` was given, the membership's role must grant it. Else `AuthorizationError`.
5. **Tenant context** — only now does `withTenantContext(tenantId, ...)` open the RLS-scoped transaction and run the callback.

Every mutation and every tenant-scoped read in `apps/admin` goes through
this function — never `withTenantContext` directly with a `tenantId`
sourced from a route param, and never a bare `getMembership()` call used as
if it were the whole check (see [layout vs. page](#layout-vs-page-two-different-jobs) below).

## The permission catalog

`packages/auth/src/permissions.ts` defines a flat, closed list —
`tenant.read`/`update`, `member.read`/`invite`/`update`/`remove`,
`site.read`/`create`/`update`/`delete`,
`domain.read`/`create`/`update`/`delete`, `release.read`/`publish`,
`billing.read`/`manage`, `audit.read` — mapped per `MembershipRole`:

| Permission                    | member | admin | owner |
| ----------------------------- | :----: | :---: | :---: |
| `tenant.read`                 |   ✓    |   ✓   |   ✓   |
| `tenant.update`               |        |       |   ✓   |
| `member.read`                 |   ✓    |   ✓   |   ✓   |
| `member.invite`               |        |   ✓   |   ✓   |
| `member.update`               |        |   ✓   |   ✓   |
| `member.remove`               |        |   ✓   |   ✓   |
| `site.read`                   |   ✓    |   ✓   |   ✓   |
| `site.create/update/delete`   |        |   ✓   |   ✓   |
| `domain.read`                 |   ✓    |   ✓   |   ✓   |
| `domain.create/update/delete` |        |   ✓   |   ✓   |
| `release.read`                |   ✓    |   ✓   |   ✓   |
| `release.publish`             |        |   ✓   |   ✓   |
| `billing.read/manage`         |        |       |   ✓   |
| `audit.read`                  |        |   ✓   |   ✓   |

This is the **only** place role → permission mapping is decided. Nothing
else — a React component, a Server Action, a repository function — should
ever write `if (role === "owner")`. Check `can(role, permission)` or call
`requirePermission(role, permission)` instead, so a future move to
per-resource scoping only touches this one file.

Not every permission has a feature behind it yet (`billing.*` — there is no
billing system). The catalog exists whole regardless: adding the feature
later is "wire up this permission," never "invent the concept of a
permission for the first time."

**v0.4 wires up `release.read`/`release.publish`** — declared since v0.1/v0.2
but unused until the Publishing & Versioning Kernel landed (see
[docs/PUBLISHING.md](PUBLISHING.md)). `release.read` gates viewing a Site's
draft-vs-published status, its revision/publication history, and preview;
`release.publish` gates `publishSite`/`rollbackSite` — both go through
`can(role, "release.publish")` the exact same way every other mutation goes
through its own permission, no new RBAC surface. Editing the draft itself
(a Page's content, a Site's settings/theme) is not a new permission at all
— it is exactly the existing `page.update`/`site.update`/`theme.update`,
since "the draft" is the same mutable `pages`/`sites` rows the v0.3 Site
Editor already writes to (see docs/PUBLISHING.md#what-a-draft-is).

## The owner invariant

**A tenant must always have at least one active OWNER.**
`packages/auth/src/membership-repository.ts` enforces this independently
of any permission check, on both `changeMemberRole` (demoting the last
OWNER) and `removeMember` (removing the last OWNER):

```sql
SELECT id FROM memberships
WHERE tenant_id = $1 AND role = 'owner'
FOR UPDATE
```

Locking every OWNER row for the tenant before checking the count is what
makes this safe under concurrency — two requests racing to demote a
tenant's last two OWNERs serialize on these rows under Postgres's READ
COMMITTED isolation; the second request's `FOR UPDATE` waits for the
first's transaction to commit, then re-reads the _post-commit_ count, not
a stale snapshot taken before either transaction started. A plain
`SELECT COUNT(*)` without the lock would let both requests read "2 owners
remain" simultaneously and both proceed, leaving zero. See the race-safety
test in `packages/auth/src/membership-repository.test.ts`.

This is enforced **in the repository layer**, for every role — an ADMIN
demoting an OWNER (something `member.update` alone permits) is still
blocked by this invariant. Permission and invariant are two independent
checks; passing one never substitutes for the other.

## Ownership transfer requires being an OWNER

Granting the `owner` role — via `addMember` or `changeMemberRole` — is
gated separately from `member.invite`/`member.update`, which both ADMIN
and OWNER hold:

```ts
function assertCanGrantRole(targetRole: MembershipRole, actingRole: MembershipRole): void {
  if (targetRole === "owner" && actingRole !== "owner") {
    throw new AuthorizationError("Only an OWNER can grant the OWNER role.");
  }
}
```

Without this, an ADMIN — who can already invite and update members — could
promote an accomplice to OWNER and then have that new OWNER remove every
other OWNER, a de facto hostile takeover through a permission never meant
to grant it.

## Not-Found over Forbidden

Every authorization failure inside `apps/admin` renders as **404**, never 403. `apps/admin/lib/actor.ts`'s `withTenantPage`:

```ts
catch (error) {
  if (error instanceof AuthenticationError) redirect("/login");
  if (error instanceof AuthorizationError) notFound();
  throw error;
}
```

"This tenant doesn't exist" and "this tenant exists but you have no
Membership in it" render identically. A 403 would confirm the tenant is
real to someone who has no business knowing that — probing sequential or
guessed tenant ids would let an attacker map which ones exist even while
being correctly denied access to all of them. 404 leaks nothing. This
applies uniformly: a malformed UUID, a well-formed but nonexistent tenant
id, and a real tenant id the user genuinely isn't a member of all produce
the exact same response.

## Layout vs. page: two different jobs

`apps/admin/app/admin/tenants/[tenantId]/layout.tsx` calls `getMembership()`
directly (not through `withAuthorizedTenantContext`) to decide what to put
in the sidebar nav — which links are even worth rendering for this role.
**This is not the security boundary.** It is explicitly documented as such
in the file itself: a layout that merely decides not to render a link does
nothing to stop a request that skips straight to the page's URL. Every
page under that layout independently calls `withTenantPage()` (which wraps
`withAuthorizedTenantContext`, re-deriving the same Membership check _plus_
the specific `permission` that page's actual data requires) before
touching any tenant data. Hiding a nav link is a UX nicety; the page's own
check is what actually refuses the request — proven directly by the
"refused server-side too, not just UI-hidden" tests in
`apps/admin/e2e/authorization.spec.ts`.

Because `getMembership()` is called directly here (and not only via the
format-checked path inside `withAuthorizedTenantContext`), it validates
its own `tenantId` argument's UUID format internally and returns `null`
for anything malformed — the same fail-closed behavior, enforced at the
lookup itself rather than trusted to every caller to have checked first.

## Tenant switching

The Control Plane's tenant switcher (`apps/admin/app/admin/tenants/[tenantId]/tenant-switcher.tsx`)
is a plain `<select>` that navigates to a different `/admin/tenants/[tenantId]`
URL on change — it grants nothing by itself. Landing on the new URL runs
the exact same five-step check as any other visit; the previous tenant's
role, permissions, and data are never carried over. `apps/admin/e2e/tenant-switch.spec.ts`
proves a contractor with memberships in two tenants (ADMIN in one, MEMBER
in the other) sees the correct, different role and correct, non-overlapping
data on each side of a switch.

## Auditing

Every membership mutation (`MEMBER_CREATED`, `MEMBER_ROLE_CHANGED`,
`MEMBER_REMOVED`) and every site/domain mutation records an audit-log row
via `recordAuditLog` (tenant-scoped, `packages/observability`) inside the
same transaction as the mutation itself. Authentication-plane events
(`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_LOGOUT`) record via the
separate `recordAuthAuditEvent` (`packages/auth`), always with
`tenant_id: null` — see [ADR 0008](adr/0008-domain-resolver-grant-hardening.md)
for why that's enforced at the database level, not just by convention.
`metadata` never contains a password, password hash, session token, or
cookie value — see [docs/SECURITY.md](SECURITY.md).
