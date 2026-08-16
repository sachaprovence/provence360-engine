import type { AppTx, MembershipRole } from "@provence360/database";
import { createRequestLogger, generateRequestId } from "@provence360/observability";
import { withTenantContext } from "@provence360/tenant";
import { uuidSchema } from "@provence360/validation";
import { AuthenticationError, AuthorizationError } from "./errors";
import { getMembership } from "./membership-lookup";
import { can, getPermissionsForRole, type Permission } from "./permissions";
import { validateSessionToken } from "./session";

export interface AuthorizedTenantActor {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  permissions: ReadonlySet<Permission>;
}

/**
 * The one path from "an HTTP request with a cookie" to "a tenant-scoped,
 * RLS-enforced database transaction" — every mutation and every tenant
 * data read in apps/admin goes through this, never `withTenantContext`
 * directly with a tenantId sourced from a route param.
 *
 * The chain, in order, each step a hard stop if it fails:
 *
 *   1. session token -> a real, unexpired, unrevoked session (else
 *      {@link AuthenticationError})
 *   2. tenantId is a well-formed UUID (else {@link AuthorizationError} —
 *      not a 400; a malformed tenant id gets exactly the same response as
 *      a well-formed one the user has no access to, so probing the shape
 *      of tenant ids reveals nothing)
 *   3. the session's user has a Membership in that tenant (else
 *      {@link AuthorizationError} — this is the step that makes "I know
 *      Tenant B's UUID" and "I can edit the URL to Tenant B" both useless
 *      on their own)
 *   4. if `permission` was given, the membership's role grants it (else
 *      {@link AuthorizationError})
 *   5. only now: `withTenantContext(tenantId, ...)` opens the RLS-scoped
 *      transaction and `callback` runs
 *
 * The browser's tenantId (a URL segment, a hidden form field) is never
 * trusted on its own — it only ever gets as far as step 2's format check
 * until step 3 independently confirms the session's *own* user actually
 * has access to it.
 */
export async function withAuthorizedTenantContext<T>(
  input: { sessionToken: string; tenantId: string; permission?: Permission },
  callback: (tx: AppTx, actor: AuthorizedTenantActor) => Promise<T>,
): Promise<T> {
  // A fresh correlation id per call, not per HTTP request — this codebase
  // has no request-scoped middleware yet to thread one id through every
  // internal call for a single incoming request (see docs/ROADMAP.md).
  // Still useful: every log line below this point is grep-able as one
  // authorization attempt, and userId/tenantId join it in as soon as
  // they're known — never the session token itself, see the logger's own
  // redaction in packages/observability/src/logger.ts.
  const log = createRequestLogger({ requestId: generateRequestId() });

  const validated = await validateSessionToken(input.sessionToken);
  if (!validated) {
    log.warn("authorization denied: no valid session");
    throw new AuthenticationError();
  }

  const tenantId = uuidSchema.safeParse(input.tenantId);
  if (!tenantId.success) {
    log.warn("authorization denied: malformed tenantId", { userId: validated.user.id });
    throw new AuthorizationError();
  }

  const membership = await getMembership(validated.user.id, tenantId.data);
  if (!membership) {
    log.warn("authorization denied: no membership in tenant", {
      userId: validated.user.id,
      tenantId: tenantId.data,
    });
    throw new AuthorizationError();
  }

  if (input.permission && !can(membership.role, input.permission)) {
    log.warn("authorization denied: missing permission", {
      userId: validated.user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      permission: input.permission,
    });
    throw new AuthorizationError();
  }

  const actor: AuthorizedTenantActor = {
    userId: validated.user.id,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    role: membership.role,
    permissions: getPermissionsForRole(membership.role),
  };

  log.debug("authorization granted", {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
  });

  return withTenantContext(membership.tenantId, (tx) => callback(tx, actor));
}
