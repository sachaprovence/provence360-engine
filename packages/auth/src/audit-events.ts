// Audit action names (see docs/SECURITY.md and section 15 of the v0.2
// brief). Centralized so a typo can't silently create a new, unqueryable
// action string — every writer and every reader (e.g. the rate limiter)
// imports from here.

export const AUTH_LOGIN_SUCCESS = "AUTH_LOGIN_SUCCESS";
export const AUTH_LOGIN_FAILURE = "AUTH_LOGIN_FAILURE";
export const AUTH_LOGOUT = "AUTH_LOGOUT";

export const MEMBER_CREATED = "MEMBER_CREATED";
export const MEMBER_ROLE_CHANGED = "MEMBER_ROLE_CHANGED";
export const MEMBER_REMOVED = "MEMBER_REMOVED";

export const SITE_CREATED = "SITE_CREATED";
export const SITE_UPDATED = "SITE_UPDATED";
export const SITE_DELETED = "SITE_DELETED";

export const DOMAIN_CREATED = "DOMAIN_CREATED";
export const DOMAIN_UPDATED = "DOMAIN_UPDATED";
export const DOMAIN_DELETED = "DOMAIN_DELETED";
