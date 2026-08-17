# ADR 0022: Media Ingestion, Asset Lifecycle & Delivery Kernel

## Status

Accepted.

## Context

`MediaAsset` (ADR 0012, v0.3) has always been a _reference-only_ abstraction:
a row with a `storageKey`, a `mimeType`, optional `width`/`height`, and an
`altText` — never a real upload path, never a real decoder, never a real
byte-serving route. Every consumer (Hero/Gallery/SEO/SiteBranding logo/
favicon/VirtualTour poster) already resolved a `MediaAsset.id` correctly
through the whole content/publishing/rendering pipeline; what never existed
was a way for an authorized admin to _create_ one from a real file without
an engineer hand-inserting a row, and no way for a browser to actually
_see_ the bytes. v0.9 closes that gap without touching the parts that
already worked: `packages/content` keeps owning the `MediaAsset` entity
(schema, CRUD, the block/branding/SEO reference contracts); this ADR adds
the ingestion, storage, and delivery machinery _around_ it.

Per the mission's own priority order — **Correctness → Tenant isolation →
Security → Published Revision integrity → Architecture → Performance →
Testability → Admin usability → Features** — every decision below is
justified against that ordering, not against "does the upload button
work."

## Decision 0 — a new package, `packages/media`, that does not own `MediaAsset`

The architectural audit confirmed no existing package is the natural owner
of upload intents, object storage, real file validation, variant
generation, or delivery — and that forcing all of it into `packages/content`
would conflate "the entity" with "the pipeline that produces validated
instances of it." **`packages/media` owns only the new, v0.9-specific
concerns** (`upload/`, `storage/`, `validation/`, `processing/`,
`delivery/`, `cleanup.ts`) and calls `createMediaAsset` from
`@provence360/content` at the very end of `finalizeMediaUpload`, once —
never before. This mirrors the same "extend the package, not the table or
the concept" discipline ADR 0021 established for `SiteBranding` vs.
`Theme`.

**Deliberately not a dependency of `packages/renderer`/`packages/publishing`.**
Both already declare their own locally-typed, structurally-compatible
shapes for a frozen media descriptor (`FrozenMediaDescriptor` in the
renderer, `MediaDescriptor` in publishing — a pre-existing v0.5 pattern this
ADR extends rather than breaks): each independently re-implements the small
"strip the `version` wrapper off `variants`" helper and the
`/media/{assetId}/{fingerprint}/{variant}` URL builder, rather than
importing `packages/media`. The alternative — a `renderer -> media` or
`publishing -> media` dependency edge — would pull `sharp`,
`@aws-sdk/client-s3`, and `@provence360/database` into packages whose whole
value is staying free of exactly that module graph (the same reasoning
behind the v0.8 client-bundle regression documented in ADR 0021's Decision
13). A few lines of duplicated, independently-tested logic in two files is
a better trade than a dependency edge that reintroduces a class of bug this
codebase already paid to fix once.

## Decision 1 — two-phase upload: an intent is not a MediaAsset

```
Create Upload Intent -> Upload bytes -> Finalize (inspect/validate/process) -> Create MediaAsset -> Available
```

`media_uploads` (migration 0016) is a **separate table**, not a status
column on `media_assets`: an abandoned, expired, or malicious upload
attempt must never become, or even resemble, a real MediaAsset — `media_assets`
stays exactly what ADR 0012 designed it to be (a reference to a
_validated, finalized_ file).

- `createMediaUploadIntent` generates an **opaque, server-side storage key**
  (`buildUploadStorageKey(tenantId)` → `tenants/{tenantId}/media/uploads/{uuid}`)
  — the client never chooses or influences any part of it (brief §5). The
  intent is tenant-scoped, RLS-protected, expires after
  `UPLOAD_INTENT_TTL_MS` (15 minutes), and starts `status: "pending"`.
- `claimMediaUploadForFinalize` uses `SELECT ... FOR UPDATE` — the same
  row-lock pattern `publishSite` already established for serializing
  concurrent writers on one row — to atomically claim a pending intent.
  A second concurrent finalize on the same id blocks until the first
  commits, then observes `status !== "pending"` and throws
  `MediaUploadAlreadyFinalizedError`: **one upload intent can never produce
  two MediaAssets.**
- A `CHECK` constraint (`media_uploads_finalized_has_asset_ck`) enforces
  `(status = 'finalized') = (media_asset_id IS NOT NULL)` at the database
  level — a half-finished state is not just discouraged by application
  code, it is structurally impossible to store.

**A real, discovered bug fixed during this phase:** the first
implementation of `finalizeMediaUpload` tried to mark a failed intent
`status: "failed"` from _inside_ the same Postgres transaction it failed
in. Since `db.transaction()` rolls back the _entire_ transaction on a
thrown error — including any write issued from a `catch` block before
re-throwing — that mark-failed write was silently undone every time,
leaving the intent looking `pending` forever. Fixed by splitting into
`finalizeMediaUpload` (the low-level primitive: throws directly, no
internal fail-marking) and `finalizeMediaUploadSafely` (the real entry
point: runs the attempt in one transaction, and on failure issues a
_second_, independent transaction to durably persist `status: "failed"`,
itself wrapped so a failure to even write "failed" never masks the real
error). Covered by a dedicated integration test
(`upload/finalize.test.ts`).

## Decision 2 — storage: a narrow interface, never AWS types outside the adapter

```ts
interface ObjectStorage {
  putObject(key, body: Buffer, opts: { contentType }): Promise<void>;
  getObject(key): Promise<Buffer | null>;
  headObject(key): Promise<ObjectMetadata | null>;
  deleteObject(key): Promise<void>;
}
```

Two implementations: `MemoryObjectStorage` (an in-process `Map`, used by
every test and by default in dev via `MEDIA_STORAGE_PROVIDER=memory`) and
`S3ObjectStorage` (wraps `@aws-sdk/client-s3`, works against real AWS S3,
Cloudflare R2, MinIO, or any S3-compatible endpoint via `S3_ENDPOINT`/
`S3_FORCE_PATH_STYLE`). No S3 SDK type or call appears anywhere outside
`storage/s3-object-storage.ts`.

**A real, discovered bug fixed during this phase, found by the Admin E2E
suite (not by unit tests, which don't exercise Next.js's own bundling):**
`getObjectStorage()`'s memoized singleton was originally a plain
module-level `let cached` variable. This works correctly in every unit/
integration test (one Node process, one module graph) but broke in a real
`next build && next start` deployment: Next.js's App Router bundles each
Server Action and each Route Handler as its own chunk, and can give each
chunk its own copy of a shared module's top-level state even though both
run in the same OS process. The Admin upload Server Action and the Admin
Preview delivery Route Handler ended up with _two separate_
`MemoryObjectStorage` instances — an upload would finalize successfully
(bytes written to instance A) and the delivery route would immediately
404 (instance B's `Map` was empty). **Fixed by memoizing on `globalThis`**
(`Symbol.for("provence360.media.objectStorage")`) instead of a closure
variable — the standard escape hatch for this exact class of problem (the
same pattern most Prisma-with-Next.js guides use for a client singleton).
This affects `MemoryObjectStorage` far more visibly than a real `S3Client`
or `getAppDb`'s own `postgres()` pool (a second instance of either still
talks to the same real external service — wasteful, not incorrect), which
is why the bug was invisible until an E2E test drove a real upload through
a real production-mode server and then fetched it back.

## Decision 3 — object keys: opaque, server-generated, never derived from a filename

`buildUploadStorageKey`/`buildOriginalStorageKey`/`buildVariantStorageKey`
all take `tenantId` (always the server's own `requireCurrentTenantId()`,
never client-supplied) and a fresh `randomUUID()` — the uploaded file's
_own_ filename never appears in any storage path at all. It is kept purely
as informative display metadata (`originalFilename`, both on the intent and
the finalized asset) — verified explicitly with hostile payloads
(`../../../../etc/passwd`, `<script>alert(1)</script>`, a literal NUL byte)
in `packages/media/src/security-payloads.test.ts`: none of them can reach
the storage key, and a NUL byte is in fact rejected outright by Postgres's
own `text` column encoding before the row is ever written — a genuine
defense-in-depth property, not something this codebase implements itself.

## Decision 4 — real file validation: decode, then allowlist — never trust extension, header, or client MIME

`validateImageBytes` (brief §8):

1. Byte-length check against `maxBytes` _before_ attempting to decode
   (`MediaTooLargeError`) — cheaper and safer than decoding an oversized
   file first.
2. A genuine decode via `sharp(bytes, { limitInputPixels: 40_000_000,
failOn: "error" }).metadata()` — `limitInputPixels` is sharp's own
   built-in decompression-bomb guard (a small file that would decode into
   an enormous pixel buffer is refused), not a hand-rolled check.
3. **Format allowlisting happens _after_ a successful decode**, against a
   closed `ACCEPTED_IMAGE_FORMATS = ["jpeg", "png", "webp"]`, not by
   trusting that decoding merely succeeded: this build's `sharp` can in
   fact decode SVG via librsvg, which is exactly why SVG is explicitly
   rejected here (`MediaTypeRejectedError`) despite decoding cleanly — "did
   it decode" is not "is it an accepted format."
4. AVIF is deliberately excluded from the accepted set even though the
   brief conditionally allows it "if the stack permits it cleanly" —
   verified directly that this environment's `sharp`/libvips build has no
   AVIF codec compiled in (`sharp.format.avif.{input,output}` both
   `undefined`). Shipping it here would silently fail.
5. A cryptographic digest (`SHA-256`) is computed from the _actually
   validated_ bytes — never a client-declared hash — and doubles as the
   delivery URL's fingerprint (Decision 7).

`declaredMimeType` (the client's `Content-Type`) is stored purely as
informative metadata on the intent and is **never read** by
`finalizeMediaUpload` when deciding the asset's real `mimeType` — proven
directly by a security-payload test that declares `text/plain` for real
JPEG bytes (finalizes as `image/jpeg`) and declares `image/jpeg` for
genuinely non-image bytes (still rejected with `MediaDecodeError`).

## Decision 5 — binary immutability: a replaced file is always a new MediaAsset

There is no "replace this file in place" operation anywhere in this
feature. Uploading new bytes always runs the full two-phase pipeline and
produces a brand-new `MediaAsset` with its own id and its own checksum —
the existing row is left untouched. The one exception, and it is
deliberate: `updateMediaAssetAltText` (new, `packages/content`) may still
change the _editorial_ `altText` fallback on an existing row, since that
field carries no bytes a published Revision's frozen descriptor could
silently drift from (the snapshot freezes `altText` into the Revision's own
`MediaDescriptor` at publish time, identically to every other descriptor
field). This is the brief's own §19 distinction between intrinsic
MediaAsset metadata and contextual alt text, resolved explicitly: v0.9
keeps a single, global `altText` per MediaAsset — no separate
per-placement contextual-alt-text editorial system was built, since
nothing in this mission's scope needed one.

## Decision 6 — image processing: a closed, versioned variant registry, never upscaled

`IMAGE_VARIANT_TOKENS = ["thumbnail", "small", "medium", "large"]`, with
fixed target max widths (320/640/1280/1920px) chosen from the real layouts
this engine renders today (Admin grid thumbnail, mobile/tablet Hero and
Gallery, desktop Hero). `original` is never re-encoded — it is the
untouched upload, referenced by its own width/height/byteSize. A variant is
generated **only if the source is wider than that variant's target** — a
narrow source (e.g. 300px) can legitimately produce zero variants, and
every consumer (`resolveResponsiveImage` in `packages/renderer`) falls back
cleanly to a wider variant or `original` when a given token is absent.

The stored shape (`media_assets.variants` jsonb) is a **closed, versioned**
contract — `MEDIA_VARIANTS_VERSION = 1`, `mediaVariantsV1Schema` (`.strict()`).
`{}` (the column's own default) is the valid "no variants" state for every
pre-v0.9 row and every non-image asset, distinguished from a real, populated
object by `resolveMediaVariants`, never by shape alone. A dedicated table
was considered and rejected, the same reasoning ADR 0021 used for
`SiteBranding`: a MediaAsset's variants have no independent lifecycle worth
a separate table, join, or migration — a small, versioned JSONB sidecar on
the row that already owns them is the coherent choice.

## Decision 7 — delivery: a same-origin, fingerprint-gated URL, resolved from a shared core

`buildMediaDeliveryUrl(assetId, fingerprint, variant)` →
`` `/media/${assetId}/${fingerprint}/${variant}` ``. The brief's own
illustrative example used `/_media/...`; this was changed after discovering,
before ever wiring a broken route, that Next.js's App Router treats any
folder beginning with `_` as a "private folder" excluded from routing
entirely — the literal example could never have resolved as a real route.
`/media/...` is a real, working App Router route in both apps
(`app/media/[assetId]/[fingerprint]/[variant]/route.ts`), at the cost of
reserving that top-level path segment from ever being used as a Site page
slug — the same accepted trade-off `/api/*` already establishes.

`resolveMediaDelivery` (`packages/media/src/delivery/media-delivery-handler.ts`)
is the **one shared core** both apps' routes call:

1. `getMediaAsset(tx, assetId)` — a tenant-scoped, RLS-governed lookup.
2. **The fingerprint must equal the asset's own `checksumSha256` exactly,
   for every variant including `"original"`** — the fingerprint identifies
   _this version of the asset as a whole_, not "these particular variant
   bytes." A stale or forged fingerprint resolves to nothing, for any
   variant, always. Combined with Decision 5 (a replaced file is always a
   new MediaAsset, so an asset's own checksum never changes in place),
   this is what makes `Cache-Control: immutable` an honest promise rather
   than a hope.
3. `resolveDeliveryStorageKey` maps the requested variant to its actual
   object key, falling back to the asset's own `storageKey` for
   `"original"` or any never-generated variant.
4. Returns `{ body, contentType, immutable }` or `null` — the caller turns
   `null` into a bare 404, never a distinguishing error message.

**Tenant is resolved _before_ calling `resolveMediaDelivery`, by the
caller, never carried in the URL itself** (the URL is deliberately
content-addressed, not tenant-addressed):

- `apps/web`'s public route resolves tenant via the exact same
  `resolveSiteByHostname` chain the rest of the public page pipeline
  already uses — zero new resolution mechanism.
- `apps/admin`'s Preview route resolves tenant via the _authenticated_
  user's own `listMembershipsForUser(user.id)`, trying each membership
  (bounded — a handful at most) until one's RLS-scoped lookup succeeds.
  This was chosen over three rejected alternatives: Host-based resolution
  (Admin isn't reached via the tenant's own domain), a tenant segment in
  the URL itself (would break Preview/Public parity — the exact same
  `resolveResponsiveImage` call in `packages/renderer` must emit an
  identical URL regardless of which app renders it), and a narrow
  RLS-bypassing "resolver" role (rejected as an ungoverned new bypass
  pattern with no precedent in this codebase).

Both routes validate `assetId` (UUID), `fingerprint` (`/^[0-9a-f]{64}$/`),
and `variant` (a closed `Set`) **before any database query** — a malformed
segment 404s immediately, never reaching RLS or the storage layer.

## Decision 8 — cache: immutable only when the URL is genuinely content-addressed

`apps/web`'s route: `Cache-Control: public, max-age=31536000, immutable`
**only** when `asset.checksumSha256` is present (a real v0.9-ingested
asset); a legacy/uncertain asset gets `private, no-store` instead — never
marked immutable on a guess. `apps/admin`'s Preview route **always**
returns `private, no-store` regardless of the asset's own fingerprint
status: Preview is inherently a private, per-tenant, potentially-stale-
relative-to-Published view and must never enter a shared cache.
`X-Content-Type-Options: nosniff` is set on every response;
`Content-Type` always comes from the database's own server-validated
`mimeType` column, never reflected from any client-supplied header.

## Decision 9 — publishing snapshot: version 3 → 4, purely additive

`SNAPSHOT_SCHEMA_VERSION` bumps `3 → 4`. `mediaDescriptorSchema` gains
three new _optional_ fields (`checksumSha256`, `byteSize`, `variants`) — no
existing field changed shape, so a stored v3 Revision's `media` array
already validates against the extended schema unchanged; its entries
simply lack the new keys. `parseSiteSnapshot` still branches explicitly on
`schemaVersion` (`undefined` → legacy; `2`; `3` — newly readable via
`normalizeV3Snapshot`, a pure relabel with no data to backfill; `4`) and
still fails closed (`UnknownSnapshotVersionError`) on anything else — the
same discipline every prior version bump in this codebase follows, applied
here even though this bump happens to require no actual data
transformation. Covered by `site-snapshot.test.ts` (a v3 payload upgrades
cleanly; a v4 payload with real variant data round-trips; a malformed
`checksumSha256` in a v4 payload is rejected).

`resolveMediaManifest`/`resolveBrandMedia` (`packages/publishing/src/media-manifest.ts`)
now populate the three new descriptor fields from the live row at publish
time, using the same version-stripping helper `packages/renderer`
independently re-implements (Decision 0). The mandated §12 invariant —
**upload image A, reference it, publish, Public shows A; Draft moves to
image B; Public still shows A; republish; Public shows B** — is proven
directly, for media (not just v0.8's pre-existing branding equivalent), by
`packages/publishing/src/media-publication-invariant.test.ts` and, at the
rendered-HTML/HTTP level, by `apps/web/e2e/media.spec.ts`.

## Decision 10 — renderer: one function, no `isPreview` branch, real responsive images

`resolveResponsiveImage` (`packages/renderer/src/resolve-delivery-url.ts`)
is a pure function: given a `FrozenMediaDescriptor`, it returns
`{ src, width, height, srcSet? }`. When `checksumSha256` is present it
picks the largest generated variant (or `"original"` if none were
generated) as `src` and builds a `srcSet` listing every generated variant
plus the original with real pixel widths; when absent (a legacy/seed
asset) it falls back byte-for-byte to the pre-v0.9 behavior of using the
raw `storageKey` directly — verified by a dedicated non-regression test.
Hero (a CSS `background: url(...)`) and Gallery (`<img loading="lazy"
srcSet sizes>`) both call the identical function; there is no branch
anywhere keyed on whether the caller is Preview or Public — the only
difference is _which descriptor_ (`RenderContext.media`, frozen, vs. a live
lookup) the caller passed in, exactly the pre-existing v0.5 contract this
ADR extends rather than reinvents.

## Decision 11 — upload transport: server-mediated, not presigned — a deliberate divergence

The brief itself only conditionally suggests presigned uploads ("si tu
utilises des URLs presigned"). This mission chose **server-mediated
upload** instead: the Admin's upload Server Action receives the multipart
file directly and calls `storage.putObject()` server-side. Reasons,
verified before committing to the architecture (a throwaway install of
`@aws-sdk/client-s3` and `sharp` confirmed both are installable and load
correctly in this sandbox, then reverted):

- This sandboxed environment has no Docker/MinIO available to realistically
  exercise a live presigned-PUT flow end to end.
- Server-mediated upload needs no CSP `connect-src` relaxation to any
  external storage origin (brief §25) — the public site's CSP is
  completely untouched by this feature, and Admin's CSP needs no widening
  either.
- It is simpler to reason about and test: one code path, one transaction
  boundary, no signed-URL expiry window to manage or accidentally log.

This is a real limitation for very large files or very high upload
concurrency (every byte flows through the Next.js server process rather
than direct-to-storage), explicitly accepted and documented rather than
silently chosen — a future milestone with real infrastructure available
could add a presigned-POST-policy flow behind the same `ObjectStorage`
interface without changing any downstream consumer.

## Decision 12 — no remote-URL import (SSRF)

v0.9 introduces no "import image from URL" feature and no server-side
fetch of an arbitrary, tenant-or-attacker-supplied URL anywhere in this
codebase (grep-verified: no new `fetch()`/`http.get()` call reads a URL
that ever came from request input in `packages/media` or either app's new
routes). Explicitly deferred to a separate future mission with its own
threat model, per brief §23.

## Decision 13 — Admin UI: a sober Media Library, a reusable picker, no manual UUIDs

`apps/admin/app/admin/tenants/[tenantId]/media/` — upload (file + optional
alt text), a thumbnail grid (dimensions, type, byte size, alt text, date),
gated on `media.read`/`media.create` (no new permission namespace — see
Decision 15). No virtual folders, no AI tagging, no crop editor (brief
§17's own explicit non-goals).

`apps/admin/lib/media-picker.tsx` — `MediaPicker` (single-select, used as
a `<form>` field via a hidden input, or as a controlled widget via
`onChange`) and `GalleryMediaPicker` (ordered multi-select) — both
deliberately **server-data-in, no `@provence360/media` import**: a Server
Component (`apps/admin/lib/media-thumbnail.ts`) resolves plain
`{id, previewUrl, altText, originalFilename}` data and passes it down,
keeping the picker's own client bundle free of `sharp`/`@aws-sdk/client-s3`/
`@provence360/database`, the same boundary Decision 0 draws for
`packages/renderer`/`packages/publishing`.

Wired in, replacing a manually-typed UUID field, for: **SiteBranding**
logo/logoDark/favicon (three `<select>` elements replaced outright), and
**Hero**'s `backgroundMediaId` / **Gallery**'s `mediaAssetIds` (added as a
picker _above_ the pre-existing generic block-props JSON textarea, which
patches the same JSON text on selection rather than replacing the textarea
— the textarea remains the ground truth and stays fully editable for every
other field, including every block type's localized-string fields, with
zero regression risk to the pre-existing, already-tested generic block
editor). **Deliberately left on the generic JSON textarea, undecorated:**
SEO's `ogImageMediaId` and VirtualTour's `posterMediaId` — neither had any
dedicated structured admin form at all before v0.9 (SEO has no admin UI
today; VirtualTour's own domain fields are edited via a separate CRUD form
that doesn't touch block props), and building one for each was judged out
of proportion to this mission's "kernel" scope. Documented here as an
accepted, scoped limitation rather than silently left undone.

## Decision 14 — deletion: conservative, explicit, no data loss risk accepted

`deleteMediaAsset` (pre-existing since v0.3, unchanged) remains a hard,
irreversible row delete with no reference-counting and no storage-object
cleanup. It is **deliberately not exposed anywhere in the v0.9 Admin Media
Library** — no delete button, no delete action. Before v0.9 this was
low-risk (no real delivery path existed at all); v0.9's `resolveMediaDelivery`
does a _live_ row lookup on every request, including for an already-
published Revision, so deleting a row through this pre-existing function
could now silently 404 an image a live Revision still expects to render —
a real violation of brief §27's "never break a historical/published
Revision" if it were wired into the new UI. Safe garbage collection
(reference-counting across every Draft and every historical Revision, then
deleting the row and the storage object together) is explicitly **deferred
to a future mission** — documented, not faked. Better to keep some unused
storage objects than risk breaking an immutable Revision.

## Decision 15 — permissions: reuse, no new namespace

`media.read`/`media.create`/`media.delete` already existed (ADR 0012) and
already cover every new v0.9 surface — upload, list, and the (still unused)
delete. No `media.upload`/`media.update` permission was added: creating a
MediaAsset via the real ingestion pipeline is authorized identically to
the pre-existing direct-insert path was, and there is no meaningful
authorization distinction between them. Every new Server Action and route
goes through the existing `withTenantPage`/`withAuthorizedTenantContext`
chain — no new authorization primitive was introduced.

## Decision 16 — cleanup: a callable primitive, not a scheduler

`cleanupExpiredMediaUploads(tx, storage)` — idempotent, concurrency-safe
(built on the same row-lock/bulk-`UPDATE` primitives as the rest of this
feature): lists every expired-but-still-`pending` intent, deletes each's
storage object, then bulk-marks them `expired` in one statement. No
scheduler was built (brief §26 explicitly allows this) — invoking it in
production is a deployment-level decision (a cron job, a worker task) left
for whoever operates the platform; the primitive itself is complete,
tested, and safe to call as often as desired.

## Decision 17 — environment: a separate schema, `memory` by default

`packages/validation/src/env.ts` gained `mediaEnvSchema`/`loadMediaEnv()`
as their **own** function, not merged into the combined `envSchema`/
`loadEnv` — mirroring the existing `loadDbEnv` precedent. `MEDIA_STORAGE_PROVIDER`
defaults to `"memory"` (safe for local dev and every test); switching to
`"s3"` requires all four `S3_*` fields (enforced via `.superRefine`) or
`loadMediaEnv()` throws at startup, never silently falling back to memory
in what was meant to be a real deployment. See `.env.example` and
`docs/MEDIA.md` for the full variable list and local-dev instructions.

## Out of scope (brief §38, unchanged)

Custom webfonts/Google Fonts, a booking system, payment, calendar/iCal, a
channel manager, adaptive/transcoded video, PDF processing, a full
proprietary CDN, AI image tagging or object recognition, photo retouching,
a crop editor, remote-URL import, an enterprise DAM, analytics, and a
quota/billing system — none of this changes and none of it was attempted.

## Consequences

- Migrations 0016 (`media_uploads` table; `media_assets` gains
  `checksumSha256`/`byteSize`/`variants`/`originalFilename`, all nullable/
  defaulted) and 0017 (role grants), both additive, no historical migration
  touched.
- New package: `packages/media` (domain/validation/storage/upload/
  processing/delivery/repository, cleanly separated, 81 tests).
- `SNAPSHOT_SCHEMA_VERSION` is now `4`; `siteSnapshotV3Schema` kept
  internally (non-exported) purely to parse historical Revisions.
- New routes: `apps/web/app/media/[assetId]/[fingerprint]/[variant]/route.ts`,
  `apps/admin/app/media/[assetId]/[fingerprint]/[variant]/route.ts`.
- New Admin surface: `/admin/tenants/[tenantId]/media` (Media Library), a
  reusable `MediaPicker`/`GalleryMediaPicker`, wired into SiteBranding and
  Hero/Gallery block editing.
- `packages/content`'s `media-repository.ts` gains real Zod validation on
  `createMediaAsset` (previously unvalidated at runtime), `checksumSha256`/
  `byteSize`/`variants`/`originalFilename` columns, `updateMediaAssetAltText`,
  and orders `listMediaAssets` newest-first.
- No regression to RLS, authorization, Publishing/Rollback, Theme/Branding,
  VirtualTour, or any prior milestone's feature set — verified by the full
  pre-existing unit/integration/RLS/E2E suites staying green, plus every
  new v0.9-specific test described above.
- Two real, previously-invisible bugs were found and fixed during this
  phase specifically because of end-to-end (not just unit) testing against
  a real `next build`/`next start` process: the transaction-rollback
  fail-marking bug (Decision 1) and the cross-bundle storage singleton bug
  (Decision 2) — both are now durably prevented by the split-transaction
  and `globalThis` patterns respectively, and both patterns are reusable
  precedent for any future two-phase-operation or process-singleton in this
  codebase.
