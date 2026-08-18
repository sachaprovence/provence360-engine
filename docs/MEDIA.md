# Media

How images actually get from an admin's file picker to a visitor's screen.
See [ADR 0022](adr/0022-media-ingestion-asset-delivery.md) for the full
design rationale — this document is the shorter, operational reference.

## The pipeline, end to end

```
Admin picks a file
  -> Server Action: createMediaUploadIntent (opaque storage key, tenant-scoped, expires in 15 min)
  -> Server Action: storage.putObject(intent.storageKey, bytes)
  -> Server Action: finalizeMediaUploadSafely
       -> claim the intent (row lock, one-shot)
       -> read the bytes back from storage
       -> real decode + validate (sharp, closed format allowlist, size/pixel limits)
       -> generate variants (thumbnail/small/medium/large, only if the source is wide enough)
       -> createMediaAsset (packages/content) — the row now exists
       -> mark the intent finalized
  -> MediaAsset appears in the Media Library grid
  -> Picked via MediaPicker in Hero/Gallery/SiteBranding — content stores the MediaAsset id, never a URL
  -> Publish freezes a MediaDescriptor snapshot of it (checksum, dimensions, variants) into the Revision
  -> Public/Preview render <img>/background via /media/{assetId}/{fingerprint}/{variant}
```

## What each package owns

- **`packages/content`** — the `MediaAsset` entity itself: schema,
  `createMediaAsset`/`getMediaAsset`/`listMediaAssets`/
  `updateMediaAssetAltText`/`deleteMediaAsset`. Unchanged in shape since
  v0.3 (ADR 0012), extended in v0.9 with the ingestion-specific columns.
- **`packages/media`** — everything new in v0.9: upload intents, object
  storage abstraction, real file validation, variant generation, delivery
  resolution, cleanup. Depends on `packages/content` to create the final
  row; nothing else depends on `packages/media` (see ADR 0022, Decision 0).
- **`packages/publishing`** — freezes a `MediaDescriptor` (including the
  v0.9 fingerprint/variant fields) into every Revision snapshot at publish
  time. Never imports `packages/media`.
- **`packages/renderer`** — `resolveResponsiveImage` turns a frozen
  descriptor into `{src, width, height, srcSet}`. Never imports
  `packages/media`.

## Local development

Default configuration needs **no setup at all** — `MEDIA_STORAGE_PROVIDER`
defaults to `memory`, an in-process fake that's good enough for trying the
feature and for every automated test. Just run the apps normally.

Trade-off to know about: `MemoryObjectStorage` only persists for the
lifetime of one running Node.js process. Restarting `next dev`/`next start`
loses every uploaded object's bytes (the `MediaAsset` database rows
survive — only the storage `Map` is lost), and `apps/web` and `apps/admin`
each run as their **own separate process**, so an object uploaded through
Admin is not fetchable through Web's own delivery route in this mode
(there is no real shared storage backend behind `memory`). This is fine for
day-to-day development and is exactly why the automated E2E suite for
public delivery (`apps/web/e2e/media.spec.ts`) tests the delivery route's
_contract_ (validation, RLS, 404 behavior) rather than real cross-app byte
delivery, while `apps/admin/e2e/media.spec.ts` proves genuine end-to-end
byte delivery once, within Admin's own single process (upload and Preview
share the same process, so real bytes really do round-trip).

## Using a real S3-compatible backend

Set:

```
MEDIA_STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket
S3_REGION=your-region
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# Only needed for a non-AWS endpoint (Cloudflare R2, MinIO, s3rver, ...):
S3_ENDPOINT=https://...
# S3_FORCE_PATH_STYLE=true  # v1.0.1: this is now the automatic default
#                           # whenever S3_ENDPOINT is set — see below.
```

**v1.0.1** — `S3_FORCE_PATH_STYLE` now defaults to `true` automatically the
moment `S3_ENDPOINT` is set, and to `false` when it isn't (real AWS S3);
setting it explicitly still always wins. Through v1.0 it defaulted to
`false` unconditionally, which meant the AWS SDK computed
virtual-hosted-style addressing (`https://<bucket>.<host>/<key>`) against
any non-AWS endpoint an operator hadn't also remembered to add this
variable for — a hostname no self-hosted S3-compatible server has real DNS
for. Combined with `S3ObjectStorage` never configuring a request/connection
timeout (fixed in the same change — see `s3-object-storage.ts`), that
failure had no ceiling: this is the exact mechanism behind v1.0's storage
smoke test appearing to hang on `put` against `s3rver`. See this release's
final report, STORAGE SMOKE ROOT CAUSE, for the full reproduction.

`loadMediaEnv()` (`packages/validation/src/env.ts`) validates this at
startup — missing any required `S3_*` field with `MEDIA_STORAGE_PROVIDER=s3`
throws immediately rather than silently falling back to `memory`.

**`MEDIA_STORAGE_PROVIDER=memory` + `NODE_ENV=production` is refused at
first use** (v0.9.1, `packages/media/src/storage/config.ts`) — a loud,
immediate `Error` rather than a silent, data-losing deployment. `memory` is
correct for local dev and every automated test, never for a real
deployment: bytes vanish on restart and are never shared across the
multiple processes/instances any real deployment eventually runs
(serverless, containers, a rolling deploy).

`S3ObjectStorage` (`packages/media/src/storage/s3-object-storage.ts`) is
exercised by a real integration suite
(`packages/media/src/storage/s3-object-storage.integration.test.ts`, v0.9.1)
— see "Real S3-compatible integration testing" below. It should still be
smoke-tested manually against your actual production bucket/provider before
first relying on it, since the suite runs against `s3rver`, not that exact
bucket/provider.

## Limits (centralized, tested, all in `packages/media/src/domain/constants.ts`)

| Constant                                     | Value                                                | Why                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MAX_UPLOAD_BYTES`                           | 15 MiB                                               | Hard ceiling on an original, enforced against real stored bytes.                                                   |
| `MAX_INPUT_PIXELS`                           | 40 MP                                                | Decompression-bomb guard, passed to sharp's own `limitInputPixels`.                                                |
| `UPLOAD_INTENT_TTL_MS`                       | 15 minutes                                           | How long a created-but-unfinalized intent stays claimable.                                                         |
| `ACCEPTED_IMAGE_FORMATS`                     | jpeg, png, webp                                      | Closed allowlist, checked after decode. SVG always rejected; AVIF excluded (this build's sharp has no AVIF codec). |
| `IMAGE_VARIANT_TOKENS` / `VARIANT_MAX_WIDTH` | thumbnail 320 / small 640 / medium 1280 / large 1920 | Closed registry, never upscaled.                                                                                   |

## Real S3-compatible integration testing (v0.9.1)

`S3ObjectStorage` is tested against a real S3-REST-API HTTP server, not a
mock of the AWS SDK — `packages/media/src/storage/s3-object-storage.integration.test.ts`
spins up [`s3rver`](https://github.com/jamhall/s3rver) in-process (a real,
maintained Node.js server implementing the S3 REST API) and runs as part of
this package's normal `vitest run`, no separate CI stage or opt-in flag
needed.

MinIO (Docker) was the originally preferred backend and was tried first;
pulling any Docker image is blocked by this environment's own egress
policy, so `s3rver` is the documented substitute. It proves the same thing
MinIO would for this purpose — `S3ObjectStorage`'s real HTTP wire behavior
against a real S3-compatible server (put/get/head/delete/list, MIME,
byte-for-byte round-trips, overwrite semantics, missing-object handling,
tenant-path isolation) — but is not a substitute for smoke-testing against
your actual AWS S3/R2/MinIO endpoint before a first production deploy; see
the v0.9.1 report's LIMITATIONS section for the exact boundary.

## Consistency model — no distributed transaction

Postgres and object storage are two separate systems with no distributed
transaction between them. `finalizeMediaUpload` writes storage objects
_and_ creates the `MediaAsset` row inside the same flow, but only the
database side is transactional; a failure between "storage write
succeeded" and "the DB transaction committed" cannot be rolled back on the
storage side. v0.9.1 makes the resulting compensation explicit rather than
pretending atomicity:

- **Storage keys are deterministic**, derived from the upload intent's own
  id (not a fresh random id per attempt). A finalize that fails after
  writing storage objects but before the DB commits leaves the intent
  `pending`; a retry recomputes and overwrites the _exact same_ keys —
  self-healing, never accumulating a fresh orphaned set per failed attempt.
- **Retry-after-success is idempotent.** If a client's connection drops
  after `finalizeMediaUpload` committed but before the response arrived,
  calling `finalizeMediaUploadSafely` again with the same upload id returns
  the _same_ `MediaAsset` instead of erroring.
- **Concurrent finalize is serialized** by a `SELECT ... FOR UPDATE` row
  lock on the upload intent — two simultaneous finalize calls on the same
  intent always produce exactly one `MediaAsset`; the second sees
  `MediaUploadAlreadyFinalizedError`.
- **Every successful finalize deletes its own temp upload object** once the
  `MediaAsset` exists (the staging copy is redundant at that point) —
  previously only an _expired, never-finalized_ intent's temp object was
  ever reclaimed; a synchronously-failed finalize now cleans up its own
  temp object too.

See `packages/media/src/upload/finalize.ts`'s own doc comments for the
exact reasoning, and `finalize.test.ts` for the concurrency/idempotence
proofs (real overlapping Postgres transactions, not simulated).

## Orphan reconciliation (v0.9.1)

Two distinct, non-destructive detection primitives —
`packages/media/src/reconciliation/orphan-scan.ts`, not wired to a
scheduler, purely callable:

- **`findStorageOrphans(tx, storage)`** — every object under a tenant's
  storage prefix that no `MediaAsset` row or `media_uploads` row (any
  status) explains.
- **`findDbOrphans(tx, storage)`** — every `MediaAsset` (or declared
  variant) whose storage object no longer exists (an out-of-band deletion,
  a provider-side incident).

Neither function deletes anything — detection only, per the brief's own
"prefer false negatives over false positives" rule. `findStorageOrphans`
never flags a live `MediaAsset`'s own bytes as orphaned regardless of
whether that asset is referenced by the current draft — every existing
row's storage keys count as accounted-for.

## Cleanup of abandoned uploads

`cleanupExpiredMediaUploads(tx, storage)` (`packages/media/src/cleanup.ts`)
is a plain, idempotent, callable function — not a built-in scheduler. To
actually run it in a deployment, invoke it periodically from whatever
mechanism your platform already uses for scheduled jobs (a cron entry, a
queue worker, a serverless scheduled function), scoped per tenant via
`withTenantContext`. No code path calls it automatically.

## Deletion

There is currently **no delete action anywhere in the Admin Media Library
UI**, deliberately. `deleteMediaAsset` (`packages/content`) still exists as
a hard row delete (pre-existing since v0.3) but is not wired into any
surface — see ADR 0022, Decision 14. v0.9.1 adds the safety check a future
delete action would need before ever calling it —
`isMediaAssetSafeToDelete(tx, mediaAssetId)`
(`packages/publishing/src/media-lifecycle.ts`) reports whether a
MediaAsset is referenced by any Site's current draft pages, its branding,
or _any_ historical `site_revisions` snapshot (published-and-current or
not — a rollback can make any past Revision live again) — but still
exposes no UI or Server Action to act on it. If you need to remove a
MediaAsset today, consult `isMediaAssetSafeToDelete` first, then call
`deleteMediaAsset` directly.

## Delivery hardening (v0.9.1)

Both delivery routes (`apps/web` and `apps/admin`, via the shared
`buildMediaDeliveryResponse` in `packages/media/src/delivery/media-response.ts`)
now set:

- **`ETag`** — a strong validator (`"{checksum}-{variant}"`), so a
  thumbnail and its original never collide despite sharing an asset id.
- **`Content-Length`** — the real, already-known body size.
- **`HEAD`** support — identical headers, no body.
- **`If-None-Match` → `304 Not Modified`** — skips re-sending bytes the
  client's cache already has current.

**`Range`/`206 Partial Content` is deliberately not implemented** — a
genuine evaluation, not a skipped checkbox: every asset served here is a
fully-processed, closed-format image capped at 15 MiB; there is no
video/audio in scope to seek within, no resumable-download use case, and a
browser's own `<img>` loading never issues a Range request for a
same-origin image on its own. If this product ever grows a genuinely
large-file or seekable-media use case, it belongs in that one shared
response builder, not implemented speculatively ahead of the need.

## Observability events

Structured, minimal `logger.info`/`logger.warn` events (existing logging
infra, no new platform) — grep-able by name in production logs:

| Event                                                                                  | When                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media.upload.intent_created`                                                          | A two-phase upload begins.                                                                                                                                                                     |
| `media.upload.finalized`                                                               | A MediaAsset was successfully created.                                                                                                                                                         |
| `media.upload.finalize_failed`                                                         | Any finalize attempt failed for real (see the error taxonomy below).                                                                                                                           |
| `media.upload.finalize_retry_after_success`                                            | A retry-after-success was recognized and the existing MediaAsset returned.                                                                                                                     |
| `media.storage.get_failed` / `media.storage.put_failed`                                | The storage backend itself failed (network, timeout, permissions) — distinct from "object missing."                                                                                            |
| `media.delivery.not_found`                                                             | The delivery route 404s, with a `reason` (`asset_not_found` / `fingerprint_mismatch` / `storage_object_missing`) — logged at `info`, since this is a public route where most 404s are routine. |
| `media.cleanup.completed`                                                              | `cleanupExpiredMediaUploads` reclaimed at least one abandoned intent.                                                                                                                          |
| `media.reconciliation.storage_orphans_found` / `media.reconciliation.db_orphans_found` | An orphan scan found something to report.                                                                                                                                                      |

None of these ever include file bytes or credentials.

## Error taxonomy

Client-facing errors are a closed set (`packages/media/src/errors.ts`) —
`MediaTypeRejectedError`, `MediaTooLargeError`, `MediaDecodeError`,
`MediaObjectMissingError`, `MediaUploadExpiredError`,
`MediaUploadAlreadyFinalizedError`, `MediaUploadNotFoundError`, and (v0.9.1)
`MediaStorageUnavailableError`. A raw storage-backend exception (an AWS SDK
error, a network timeout) is **never** returned to a caller — it's logged
in full server-side (`media.storage.*_failed`) and replaced with the
generic `MediaStorageUnavailableError`. `apps/admin`'s upload Server Action
maps exactly this closed set to a friendly form error; anything else
propagates as an unhandled error (a genuine bug, not a taxonomy gap).

## EXIF orientation (v0.9.1 correctness fix)

`sharp`'s own `metadata()` always reports raw pixel dimensions — a phone
photo shot in portrait very commonly has landscape raw pixels plus an EXIF
`Orientation` tag telling a viewer to rotate 90°. Two related bugs this
version fixes:

1. **`validateImageBytes`** now reports EXIF-orientation-corrected
   `width`/`height` (swapped for `Orientation` 5-8) — matching what every
   browser actually displays, so the renderer's aspect-ratio box is never
   backwards for a rotated photo.
2. **`generateImageVariants`** now calls `.rotate()` (sharp's auto-orient)
   before resizing — without it, a variant's _pixels_ stayed in the raw,
   un-rotated layout while the re-encoded output also lost the orientation
   tag that would have let a viewer correct it, producing thumbnails that
   render sideways.

See `validation/image-validation.test.ts` and `processing/variants.test.ts`
for the regression tests (constructing a real EXIF-tagged JPEG via sharp,
not a canned fixture).

## Troubleshooting

- **An uploaded image 404s when fetched through `/media/...`.** Check
  which process served the upload vs. which process is serving the
  delivery request — under `MEDIA_STORAGE_PROVIDER=memory`, they must be
  the _same_ running server process (see "Local development" above).
- **"S3_BUCKET is required when MEDIA_STORAGE_PROVIDER=s3"** at startup —
  one of the four required `S3_*` variables is missing; see the table
  above.
- **A file is rejected with "This file could not be decoded as a valid
  image."** — the bytes genuinely aren't a JPEG/PNG/WebP `sharp` can
  decode (a real corrupt file, a renamed non-image file, or SVG, which is
  always rejected regardless of whether it decodes).
