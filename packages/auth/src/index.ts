export { membershipRoleValues, hasAtLeastRole } from "./roles";
export type { MembershipRole } from "./roles";

export {
  PERMISSIONS,
  can,
  requirePermission,
  getPermissionsForRole,
  PermissionDeniedError,
} from "./permissions";
export type { Permission } from "./permissions";

export {
  AuthenticationError,
  AuthorizationError,
  LastOwnerError,
  MembershipNotFoundError,
} from "./errors";

export { hashPassword, verifyPassword } from "./password";

export {
  generateSessionToken,
  createSession,
  validateSessionToken,
  revokeSessionToken,
  revokeAllUserSessions,
  SESSION_DURATION_MS,
} from "./session";
export type { SessionUser, ValidatedSession } from "./session";

export { requireSessionUser } from "./current-user";

export { login, InvalidCredentialsError } from "./login";
export type { LoginResult } from "./login";

export { assertLoginNotRateLimited, LoginRateLimitedError } from "./rate-limit";

export { getMembership, listMembershipsForUser } from "./membership-lookup";
export type { MembershipLookup } from "./membership-lookup";

export { findUserByEmail } from "./user-lookup";
export type { UserLookup } from "./user-lookup";

export { listMembers, addMember, changeMemberRole, removeMember } from "./membership-repository";
export type { MemberRow } from "./membership-repository";

export { withAuthorizedTenantContext } from "./with-authorized-tenant-context";
export type { AuthorizedTenantActor } from "./with-authorized-tenant-context";

export { recordAuthAuditEvent } from "./audit";
export * from "./audit-events";
