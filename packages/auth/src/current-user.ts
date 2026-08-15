import { AuthenticationError } from "./errors";
import { type SessionUser, validateSessionToken } from "./session";

/**
 * Authentication only, no tenant involved — the tenant switcher, the
 * account menu, anything that needs "who is logged in" without yet
 * needing "and which tenant." Throws {@link AuthenticationError} instead
 * of returning `null` so callers can't accidentally treat "not logged in"
 * as a valid state to render tenant data for.
 */
export async function requireSessionUser(sessionToken: string | undefined): Promise<SessionUser> {
  if (!sessionToken) throw new AuthenticationError();
  const validated = await validateSessionToken(sessionToken);
  if (!validated) throw new AuthenticationError();
  return validated.user;
}
