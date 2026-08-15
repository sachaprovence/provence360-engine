import { cookies } from "next/headers";

// A single httpOnly, SameSite=Lax cookie carrying the opaque session token
// (see @provence360/auth's session.ts). httpOnly: never readable by
// browser JavaScript, so an XSS bug can't exfiltrate it via
// `document.cookie`. Secure in production only (not in local dev over
// plain HTTP, where `Secure` would silently make the cookie never get
// sent — see docs/AUTHENTICATION.md). SameSite=Lax: the cookie is not
// attached to cross-site POSTs, which is most of what session-fixation /
// CSRF-via-cookie attacks need — combined with Next.js Server Actions'
// built-in same-origin check on the request, this is the CSRF posture for
// v0.2 (see docs/AUTHENTICATION.md#csrf).
const COOKIE_NAME = "p360_session";

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
