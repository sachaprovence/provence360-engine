import type { MembershipRole } from "@provence360/database";

/** A person, independent of any tenant — see docs/MULTI_TENANCY.md on why Users are global. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
}

/**
 * What a request handler needs before calling `withTenantContext()`: a
 * concrete user, the tenant they're acting as, and the role their
 * membership in that tenant grants. Nothing in Foundation v0.1 produces a
 * `RequestActor` yet — there is no login flow, no session storage, no
 * password/OAuth handling (see docs/ROADMAP.md). This type exists so the
 * shape request-handling code will need is settled now, instead of being
 * improvised ad hoc when auth actually gets built.
 */
export interface RequestActor {
  user: AuthenticatedUser;
  tenantId: string;
  role: MembershipRole;
}
