# ADR 0015: Localized strings embedded in block props, no translation table

## Status

Accepted. Foundation only — no translation UI, no per-locale routing (see
`docs/LOCALIZATION.md` and `docs/ROADMAP.md`).

## Context

Section 31 of the brief requires the schema to be _designed_ for multiple
languages now, without building a translation interface yet. `sites` already
carries `defaultLocale`/`enabledLocales` (a plain, closed list of locale
tags a site supports); what remained undecided is how _content itself_ —
a Hero's headline, a Text block's body — holds more than one language's
value.

Two shapes were on the table: a normalized translations table (`page_id`,
`block_instance_id`, `locale`, `field_key`, `value`), or a `LocalizedString`
value embedded directly in a block's `props`.

## Decision

**A `LocalizedString`, embedded in block props**: `Record<localeCode,
string>`, e.g. `{ fr: "Bienvenue", en: "Welcome" }`, validated by
`packages/content`'s `localizedStringSchema` — `z.record(z.string(),
z.string()).refine(hasAtLeastOneEntry)`. Any block prop that's meant to be
user-facing copy (a Hero's `headline`, a Text block's `body`) is typed as
`LocalizedString`, not `string`, in that block's own Zod schema.

- **Resolution/fallback** (`packages/content/src/localization.ts`): given a requested locale and a site's `defaultLocale`, `resolveLocalizedString()` tries the requested locale, then the site's default, then the first available key — always returns _something_ rather than an empty string, since a page missing one language's translation for one field must still render, not blank out that field.
- **Rejected: a normalized translations table.** It's the more "correct" long-term shape for a mature CMS, but for v0.3 it multiplies every block-content read into a join (or a second query) per locale, doesn't fit naturally inside `docs/adr/0013-page-content-storage.md`'s document-per-page model (content would need to live partly in the document, partly in a side table, undermining "one row = one page" for rendering), and solves editing/versioning problems (partial-translation workflows, translator assignment) this phase explicitly isn't building yet.
- **SEO fields follow the same shape where they're user-facing copy** (`pages.seo.title`, `pages.seo.description` are `LocalizedString`s too — see `docs/RENDERING.md`'s SEO section) — one representation for "text a human wrote," not two.
- **Routing stays single-URL-per-page in v0.3.** A Page's `slug` is not localized, and there is no `?locale=`/path-prefix routing built yet — the renderer picks a locale from an explicit request parameter (defaulting to the site's `defaultLocale`) and resolves every `LocalizedString` against it. Per-locale URLs/canonical SEO handling is named explicitly as future work (`docs/ROADMAP.md`), not silently assumed solved.

## Consequences

- Adding a language to a site (section 47.E) is: add the locale tag to `sites.enabledLocales`, and start adding that locale's key to each `LocalizedString` prop that should carry it — no schema migration, no new table, no join added to the render path.
- A field genuinely missing a translation degrades to the fallback chain rather than crashing or rendering blank — visible in `packages/content`'s tests.
- The known, accepted gap: no per-locale SEO URLs, no translator workflow/UI, no "which fields are missing which language" report. All explicitly deferred, not silently missing — see `docs/ROADMAP.md`.
- Every `LocalizedString` still passes through the same Block Registry validation as any other prop (`docs/adr/0014-block-registry-versioning.md`) — an empty object (`{}`, no locale keys at all) is rejected at write time, not discovered as a blank field at render time.
