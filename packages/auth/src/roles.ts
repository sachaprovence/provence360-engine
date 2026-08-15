import { membershipRoleValues, type MembershipRole } from "@provence360/database";

export { membershipRoleValues, type MembershipRole };

// Coarse, total order over the three Foundation v0.1 roles. Fine-grained,
// per-resource permissions are explicitly out of scope for this phase (see
// docs/ROADMAP.md) — but call sites should compare roles through
// `hasAtLeastRole()` rather than string equality, so that a future move to
// scoped permissions doesn't require touching every caller.
const ROLE_RANK: Record<MembershipRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export function hasAtLeastRole(actual: MembershipRole, required: MembershipRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
