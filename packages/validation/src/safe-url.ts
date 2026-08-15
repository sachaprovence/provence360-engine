import { z } from "zod";

// Content-submitted "link" fields (a CTA button href, a hero's own CTA
// href, ...) must never be able to smuggle a `javascript:`/`data:`/`vbscript:`
// URL past the renderer and into an <a href> a visitor might click (see
// section 33 of the v0.3 brief and docs/RENDERING.md#security). Only a
// path-relative link ("/contact"), a same-origin fragment ("#gallery"),
// or an absolute http(s) URL is accepted — everything else is rejected at
// write time, not merely stripped or escaped at render time, so
// `pages.content` never holds a dangerous href in the first place.
const SAFE_ABSOLUTE_PATTERN = /^https?:\/\//i;

// A closed allowlist (relative path, fragment, or http(s)) — not a
// blocklist of known-bad schemes — so a scheme nobody thought to
// blocklist yet (vbscript:, data:, a future one) is rejected by default.
export function isSafeHref(value: string): boolean {
  // "//host/path" is a protocol-relative URL — a browser resolves it
  // against whatever scheme the current page is on, redirecting to an
  // attacker-controlled host exactly like a full absolute URL would. Only
  // a single leading "/" (a real same-origin path) is accepted.
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (value.startsWith("#")) return true;
  return SAFE_ABSOLUTE_PATTERN.test(value);
}

export const safeHrefSchema = z.string().trim().min(1).max(2048).refine(isSafeHref, {
  message: "href must be a relative path, fragment, or absolute http(s) URL",
});
