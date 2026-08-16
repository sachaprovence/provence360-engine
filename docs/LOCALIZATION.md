# Localization

Foundation only, per the brief — the schema is designed now for multiple
languages; no translation UI or per-locale routing is built yet. See
[ADR 0015](adr/0015-localization-storage.md) for the full decision
reasoning.

## Site-level configuration

`sites.defaultLocale` (a locale tag, default `fr`) and
`sites.enabledLocales` (a JSONB array of locale tags, default `["fr"]`)
are the closed list of languages a Site supports and its fallback
language. The seed data exercises both cases: Villas Cassis has
`enabledLocales: ["fr", "en"]`; Mas du Luberon has only `["fr"]`.

## LocalizedString

Any block prop meant to be user-facing copy — a Hero's `headline`, a Text
block's `body`, a Page's `seo.title`/`seo.description` — is typed as
`LocalizedString`, **not** `string`, in that block's own Zod schema:

```ts
type LocalizedString = Record<string, string>; // e.g. { fr: "Bienvenue", en: "Welcome" }
```

`packages/content/src/localized-string.ts`'s `localizedStringSchema`
validates this: keys are 2–10 character locale tags, values are bounded
plain strings, and the object must hold **at least one** entry — an empty
`{}` (content authored in no language at all) is rejected at write time,
through the same Block Registry validation every other prop goes through
(see [docs/BLOCK_SYSTEM.md](BLOCK_SYSTEM.md)).

This is embedded directly in block `props`, not a separate translations
table. A normalized `(page_id, block_instance_id, locale, field_key,
value)` table is the more conventional shape for a mature CMS, but it
would multiply every content read into a join or a second query per
locale, and doesn't fit `pages.content`'s document-per-page model (content
would live partly in the document, partly in a side table). See the ADR
for the full tradeoff, including what this rules out for now (a dedicated
translator workflow/UI, a "which fields are missing which language"
report).

## Resolution and fallback

`packages/content/src/localized-string.ts`'s `resolveLocalizedString(value,
locale, fallbackLocale)`:

1. The requested `locale`, if present.
2. Else `fallbackLocale` (the Site's `defaultLocale`).
3. Else whichever locale happens to be present first.

A field missing one language's translation always renders _something_
rather than going blank — a Page missing one field's `en` value still
renders fully in English, just with that one field falling back to
French. `RenderContext.locale`/`.defaultLocale` (see
[docs/RENDERING.md](RENDERING.md)) are what every block renderer passes
into this function for every `LocalizedString` prop it displays.

## What's not built yet

- **No per-locale routing.** A Page's `slug` is not itself localized, and
  there's no `?locale=`/path-prefix scheme in v0.3 — the renderer resolves
  every `LocalizedString` against a single requested locale (defaulting to
  the Site's `defaultLocale`), the same URL either way.
- **No translator UI.** Adding a language to a site today means adding the
  locale tag to `enabledLocales` and then adding that locale's key to each
  relevant `LocalizedString` prop through the Site Editor's JSON props
  editor — there's no dedicated "translate this page" workflow, no
  side-by-side editor, no missing-translation report.
- **No per-locale SEO** (hreflang, per-locale canonical URLs) beyond the
  single `pages.seo` object's own `LocalizedString` title/description.

All explicitly deferred — see [docs/ROADMAP.md](ROADMAP.md) — not
silently missing.
