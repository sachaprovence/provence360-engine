"use server";

import { redirect } from "next/navigation";
import {
  AUTH_LOGOUT,
  recordAuthAuditEvent,
  revokeSessionToken,
  validateSessionToken,
} from "@provence360/auth";
import { clearSessionCookie, getSessionToken } from "@/lib/session-cookie";

/**
 * Logout: revokes the session server-side (it stops validating on the very
 * next request, from any client that holds the token, not just this
 * browser) and clears the cookie. Both steps matter — clearing the cookie
 * alone would leave the token itself still valid if it leaked some other
 * way.
 */
export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    const validated = await validateSessionToken(token);
    await revokeSessionToken(token);
    if (validated) {
      await recordAuthAuditEvent({
        actorUserId: validated.user.id,
        action: AUTH_LOGOUT,
        targetType: "user",
        targetId: validated.user.id,
      });
    }
  }
  await clearSessionCookie();
  redirect("/login");
}
