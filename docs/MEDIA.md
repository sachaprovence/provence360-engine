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
# Only needed for a non-AWS endpoint (Cloudflare R2, MinIO, ...):
S3_ENDPOINT=https://...
S3_FORCE_PATH_STYLE=true   # MinIO and most non-AWS endpoints need this
```

`loadMediaEnv()` (`packages/validation/src/env.ts`) validates this at
startup — missing any required `S3_*` field with `MEDIA_STORAGE_PROVIDER=s3`
throws immediately rather than silently falling back to `memory`.
`S3ObjectStorage` (`packages/media/src/storage/s3-object-storage.ts`) is
not integration-tested against a live bucket in this repository's own test
suite (this sandboxed development environment has no Docker/MinIO
available) — it is exercised by TypeScript's structural typing against the
shared `ObjectStorage` interface and should be smoke-tested manually
against your real bucket before relying on it in production.

## Limits (centralized, tested, all in `packages/media/src/domain/constants.ts`)

| Constant                                     | Value                                                | Why                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MAX_UPLOAD_BYTES`                           | 15 MiB                                               | Hard ceiling on an original, enforced against real stored bytes.                                                   |
| `MAX_INPUT_PIXELS`                           | 40 MP                                                | Decompression-bomb guard, passed to sharp's own `limitInputPixels`.                                                |
| `UPLOAD_INTENT_TTL_MS`                       | 15 minutes                                           | How long a created-but-unfinalized intent stays claimable.                                                         |
| `ACCEPTED_IMAGE_FORMATS`                     | jpeg, png, webp                                      | Closed allowlist, checked after decode. SVG always rejected; AVIF excluded (this build's sharp has no AVIF codec). |
| `IMAGE_VARIANT_TOKENS` / `VARIANT_MAX_WIDTH` | thumbnail 320 / small 640 / medium 1280 / large 1920 | Closed registry, never upscaled.                                                                                   |

## Cleanup of abandoned uploads

`cleanupExpiredMediaUploads(tx, storage)` (`packages/media/src/cleanup.ts`)
is a plain, idempotent, callable function — not a built-in scheduler. To
actually run it in a deployment, invoke it periodically from whatever
mechanism your platform already uses for scheduled jobs (a cron entry, a
queue worker, a serverless scheduled function), scoped per tenant via
`withTenantContext`. No v0.9 code path calls it automatically.

## Deletion

There is currently **no delete action anywhere in the Admin Media Library
UI**, deliberately. `deleteMediaAsset` (`packages/content`) still exists as
a hard row delete (pre-existing since v0.3) but is not wired into any v0.9
surface — see ADR 0022, Decision 14, for why the new delivery route's live
lookup makes exposing it unsafe without reference-counting across every
Draft and historical Revision first. That's a real gap, tracked here
rather than hidden: if you need to remove a MediaAsset today, you would
have to call `deleteMediaAsset` directly and manually confirm nothing
still references it.

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
