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

  // v0.3 — Site Domain, Content Graph & Rendering Contracts (see
  // docs/SITE_DOMAIN.md, docs/CONTENT_MODEL.md, docs/THEMES.md). Themes
  // are a curated, platform-level catalog (docs/adr/0011-theme-token-model.md)
  // — tenants can read and apply/override one, never create or delete one,
  // hence "theme.read"/"theme.update" only, no "theme.create"/"theme.delete".
  "property.read",
  "property.create",
  "property.update",
  "property.delete",

  "unit.read",
  "unit.create",
  "unit.update",
  "unit.delete",

  "page.read",
  "page.create",
  "page.update",
  "page.delete",

  "theme.read",
  "theme.update",

  "media.read",
  "media.create",
  "media.delete",

  // v0.7 — Virtual Tour & Immersive Experience Kernel (see
  // docs/adr/0019-virtual-tour-immersive-kernel.md). Deliberately its own
  // namespace, not folded into `media.*`: a VirtualTour is a domain entity
  // with its own ownership/publish-reference semantics (like Property/
  // Unit), not a MediaAsset — reusing `media.*` here would conflate two
  // unrelated permission surfaces.
  "tour.read",
  "tour.create",
  "tour.update",
  "tour.delete",
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
  "property.read",
  "property.create",
  "property.update",
  "property.delete",
  "unit.read",
  "unit.create",
  "unit.update",
  "unit.delete",
  "page.read",
  "page.create",
  "page.update",
  "page.delete",
  "theme.read",
  "theme.update",
  "media.read",
  "media.create",
  "media.delete",
  "tour.read",
  "tour.create",
  "tour.update",
  "tour.delete",
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
  "property.read",
  "unit.read",
  "page.read",
  "theme.read",
  "media.read",
  "tour.read",
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
