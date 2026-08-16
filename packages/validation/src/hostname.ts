import { z } from "zod";

export class InvalidHostnameError extends Error {
  constructor(public readonly rawValue: string) {
    super(`Invalid hostname: "${rawValue}"`);
    this.name = "InvalidHostnameError";
  }
}

// One label: alphanumeric, hyphens allowed but not at the edges. Applied to
// every dot-separated segment of the hostname.
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalizes a raw `Host` header (or any user-supplied hostname) into the
 * canonical form stored in `domains.hostname` and used for lookups:
 *   - lowercased
 *   - port stripped ("example.com:3000" -> "example.com")
 *   - surrounding whitespace and trailing dot stripped
 *   - a leading "www." is treated as equivalent to the bare domain
 *
 * Throws `InvalidHostnameError` on anything that isn't a plausible DNS
 * hostname (empty, IP literal, invalid characters, empty labels). Resolution
 * must fail closed on malformed input rather than silently pass it through.
 */
export function normalizeHostname(raw: string): string {
  const withoutPort = raw.trim().toLowerCase().split(":")[0] ?? "";
  const withoutTrailingDot = withoutPort.endsWith(".") ? withoutPort.slice(0, -1) : withoutPort;
  const withoutWww = withoutTrailingDot.startsWith("www.")
    ? withoutTrailingDot.slice("www.".length)
    : withoutTrailingDot;

  if (withoutWww.length === 0 || withoutWww.length > 253) {
    throw new InvalidHostnameError(raw);
  }

  const labels = withoutWww.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL_RE.test(label))) {
    throw new InvalidHostnameError(raw);
  }

  return withoutWww;
}

export const hostnameSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizeHostname(value);
    } catch {
      ctx.addIssue({ code: "custom", message: `Invalid hostname: "${value}"` });
      return z.NEVER;
    }
  });
