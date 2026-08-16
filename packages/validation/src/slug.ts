import { z } from "zod";

export class InvalidSlugError extends Error {
  constructor(
    public readonly rawValue: string,
    reason: string,
  ) {
    super(`Invalid slug "${rawValue}": ${reason}`);
    this.name = "InvalidSlugError";
  }
}

const MAX_SLUG_LENGTH = 80;

// Infrastructure/routing words that would collide with a real route or
// convention if a tenant were allowed to claim them as a Site/Property/Unit
// slug (e.g. a Site slug of "api" colliding with a future `/api/*` route).
// Centralized here rather than duplicated per call site — see section 30
// of the brief.
export const DEFAULT_RESERVED_SLUGS = [
  "admin",
  "api",
  "app",
  "www",
  "static",
  "assets",
  "public",
  "_next",
  "health",
  "login",
  "logout",
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Normalizes a raw, human-typed string into a URL-safe slug: Unicode
 * diacritics stripped ("Café" -> "cafe"), lowercased, apostrophes and
 * whitespace collapsed to single hyphens, anything else that isn't
 * `[a-z0-9-]` dropped, runs of hyphens collapsed, leading/trailing hyphens
 * trimmed. Pure normalization — does not check length, emptiness, or the
 * reserved list; see `toSlug()` for the validated version most callers
 * should actually use.
 */
const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

export function normalizeSlug(raw: string): string {
  // NFD decomposes "é" into "e" + a combining acute accent (U+0301); this
  // strips every combining diacritical mark (U+0300-U+036F) left behind,
  // so "Café", "Ménage", "Provençal" all normalize to their plain-ASCII
  // base letters instead of being dropped by the character filter below.
  const withoutDiacritics = raw.normalize("NFD").replace(COMBINING_DIACRITICAL_MARKS, "");

  return withoutDiacritics
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalizes and validates a slug in one step: empty (nothing survived
 * normalization — e.g. the input was all punctuation/emoji), too long, or
 * reserved all throw `InvalidSlugError`. Collision (two rows racing for
 * the same slug) is deliberately NOT this function's job — that's a
 * database unique-index concern (see e.g. `sites_tenant_slug_uidx`,
 * `properties_site_slug_uidx`), reported as a distinct, catchable
 * "duplicate key" error at the repository layer, never silently resolved
 * here (auto-appending "-2" would make slugs non-deterministic and let a
 * caller's retry logic paper over a real naming conflict).
 */
export function toSlug(raw: string, options: { reserved?: readonly string[] } = {}): string {
  const normalized = normalizeSlug(raw);
  const reserved = options.reserved ?? DEFAULT_RESERVED_SLUGS;

  if (normalized.length === 0) {
    throw new InvalidSlugError(raw, "normalizes to an empty string");
  }
  if (normalized.length > MAX_SLUG_LENGTH) {
    throw new InvalidSlugError(
      raw,
      `longer than ${MAX_SLUG_LENGTH} characters after normalization`,
    );
  }
  if (reserved.includes(normalized)) {
    throw new InvalidSlugError(raw, `"${normalized}" is a reserved slug`);
  }

  return normalized;
}

/**
 * A Zod schema for a slug that's already in canonical form (e.g. read back
 * from the database, or a form field the UI already normalized client-side
 * for preview purposes) — rejects anything that doesn't match `toSlug()`'s
 * own output shape. Does NOT itself normalize; use `toSlug()` first when
 * accepting free-text input.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(SLUG_PATTERN, "must be lowercase letters, digits, and single hyphens only");
