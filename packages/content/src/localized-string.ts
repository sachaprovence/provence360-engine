import { z } from "zod";

// A LocalizedString is a closed set of locale-tag -> plain-text-value
// pairs — never a bare `string`, so a user-facing copy field can never
// accidentally be authored in exactly one language with no representation
// for any other. See docs/adr/0015-localization-storage.md.
export const localizedStringSchema = z
  .record(z.string().min(2).max(10), z.string().max(20_000))
  .refine((value) => Object.keys(value).length > 0, {
    message: "must contain at least one locale",
  });

export type LocalizedString = z.infer<typeof localizedStringSchema>;

/**
 * Resolves a `LocalizedString` to a single display value for `locale`:
 * the requested locale if present, else `fallbackLocale` (typically the
 * site's `defaultLocale`), else whichever locale happens to be first —
 * always returns *something* rather than an empty string, since a page
 * missing one field's translation for one language must still render.
 * Returns `undefined` only if `value` itself is genuinely empty (which
 * `localizedStringSchema` should already have rejected at write time).
 */
export function resolveLocalizedString(
  value: LocalizedString,
  locale: string,
  fallbackLocale: string,
): string | undefined {
  if (value[locale] !== undefined) return value[locale];
  if (value[fallbackLocale] !== undefined) return value[fallbackLocale];
  return Object.values(value)[0];
}
