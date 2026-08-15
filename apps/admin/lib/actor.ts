import { notFound, redirect } from "next/navigation";
import type { AppTx } from "@provence360/database";
import {
  AuthenticationError,
  AuthorizationError,
  requireSessionUser,
  validateSessionToken,
  withAuthorizedTenantContext,
  type AuthorizedTenantActor,
  type Permission,
  type SessionUser,
} from "@provence360/auth";
import { getSessionToken } from "./session-cookie";

/**
 * Authentication only — the tenant switcher, the account menu. Redirects
 * to /login rather than returning null: a Server Component that forgot to
 * handle "not logged in" fails closed (redirect) instead of silently
 * rendering with an undefined user.
 */
export async function requireCurrentUser(): Promise<SessionUser> {
  const token = await getSessionToken();
  try {
    return await requireSessionUser(token);
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    throw error;
  }
}

/** Like {@link requireCurrentUser}, but for /login itself: "not logged in" is the expected case, not an error to redirect away from. */
export async function getCurrentUserOrNull(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const validated = await validateSessionToken(token);
  return validated?.user ?? null;
}

/**
 * The server-side gate every `/admin/tenants/[tenantId]/**` page and
 * server action must go through — never trust the `[tenantId]` URL
 * segment on its own. Not authenticated -> /login. Authenticated but no
 * Membership in this tenant (or missing `permission`) -> 404, not 403:
 * "this tenant doesn't exist" and "this tenant exists but isn't yours"
 * render identically, so probing tenant ids reveals nothing (see
 * docs/SECURITY.md).
 */
export async function withTenantPage<T>(
  tenantId: string,
  permission: Permission | undefined,
  fn: (tx: AppTx, actor: AuthorizedTenantActor) => Promise<T>,
): Promise<T> {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  try {
    return await withAuthorizedTenantContext(
      { sessionToken: token, tenantId, ...(permission ? { permission } : {}) },
      fn,
    );
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
}
