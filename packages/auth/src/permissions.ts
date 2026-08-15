import type { MembershipRole } from "@provence360/database";

// The permission catalog (section 7 of the v0.2 brief). Not every
// permission below has a feature behind it yet — `billing.*` for instance
// has no billing system — but the engine exists now, whole, so adding a
// feature later is "wire up this permission," never "invent the concept
// of a permission for the first time." See docs/AUTHORIZATION.md.
export const PERMISSIONS = [
  "tenant.read",
  "tenant.update",

  "member.read",
  "member.invite",
  "member.update",
  "member.remove",

  "site.read",
  "site.create",
  "site.update",
  "site.delete",

  "domain.read",
  "domain.create",
  "domain.update",
  "domain.delete",

  "release.read",
  "release.publish",

  "billing.read",
  "billing.manage",

  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Role -> permission set. This is the ONLY place role/permission mapping
// is decided — nothing else in this codebase (a React component, a route
// handler, a repository) should hardcode "if role === 'owner'". See
// docs/AUTHORIZATION.md for the reasoning behind each row.
const OWNER_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const ADMIN_PERMISSIONS: readonly Permission[] = [
  "tenant.read",
  "member.read",
  "member.invite",
  "member.update",
  "member.remove",
  "site.read",
  "site.create",
  "site.update",
  "site.delete",
  "domain.read",
  "domain.create",
  "domain.update",
  "domain.delete",
  "release.read",
  "release.publish",
  "audit.read",
  // Deliberately absent: tenant.update, billing.*. Deliberately absent in
  // *effect* rather than by permission (member.update/member.remove are
  // granted): the owner invariant in membership-repository.ts additionally
  // blocks demoting/removing the tenant's last OWNER for every role,
  // including admin — see docs/AUTHORIZATION.md#owner-invariant.
];

const MEMBER_PERMISSIONS: readonly Permission[] = [
  "tenant.read",
  "member.read",
  "site.read",
  "domain.read",
  "release.read",
  // Deliberately absent: audit.read — the audit trail is treated as an
  // administrative surface, not "basic reading," in this codebase.
];

const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

export function getPermissionsForRole(role: MembershipRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function can(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class PermissionDeniedError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function requirePermission(role: MembershipRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new PermissionDeniedError(permission);
  }
}
