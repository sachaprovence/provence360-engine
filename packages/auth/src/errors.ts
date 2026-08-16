// Central error vocabulary for the auth/authorization layer. Route
// handlers and server actions catch these and decide the HTTP-facing
// shape — never a raw DB error, never a stack trace, never a message that
// reveals whether a specific tenant/resource exists to someone who isn't
// authorized to know that (see docs/SECURITY.md and section 21 of the
// v0.2 brief: prefer a Not-Found-shaped response over a
// Forbidden-shaped one where that would leak less).

export class AuthenticationError extends Error {
  constructor(message = "Not authenticated.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super("A tenant must always have at least one active OWNER.");
    this.name = "LastOwnerError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor(membershipId: string) {
    super(`Membership "${membershipId}" was not found in the current tenant.`);
    this.name = "MembershipNotFoundError";
  }
}
