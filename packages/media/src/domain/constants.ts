/**
 * v0.9's closed, centralized limits — see ADR 0022, "scope" and "real file
 * validation." Every number here is deliberately named, exported, and
 * tested (never a magic literal re-typed at each call site).
 */

// --- Format ------------------------------------------------------------
//
// Image-first, closed allowlist (brief §7). AVIF is deliberately excluded:
// this build's `sharp`/libvips has no AVIF codec compiled in (verified —
// `sharp.format.avif.input`/`.output` are both `undefined` here), and the
// brief is explicit that AVIF only belongs in scope "si la stack de
// traitement le permet proprement" — shipping it against an environment
// that can silently fail to encode/decode it would violate that condition.
// SVG is never accepted, full stop (brief §7's own default) — `sharp` can
// in fact decode SVG via librsvg, which is exactly why format allowlisting
// happens *after* decode against `metadata.format`, not by trusting a
// decode attempt's mere success.
export const ACCEPTED_IMAGE_FORMATS = ["jpeg", "png", "webp"] as const;
export type AcceptedImageFormat = (typeof ACCEPTED_IMAGE_FORMATS)[number];

export const FORMAT_TO_MIME_TYPE: Record<AcceptedImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// --- Size ----------------------------------------------------------------

/** Hard ceiling on an uploaded original — enforced against real stored bytes, never a client header. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB

/**
 * Decompression-bomb guard (brief §8): a small file can still decode into
 * an enormous pixel buffer. Passed directly to sharp's own
 * `limitInputPixels`, which refuses to decode past this — a built-in,
 * well-tested defense rather than a hand-rolled one.
 */
export const MAX_INPUT_PIXELS = 40_000_000; // 40 MP — comfortably above any real photo this product needs

// --- Upload intent lifecycle ---------------------------------------------

/** How long a created-but-not-yet-finalized upload intent stays claimable. */
export const UPLOAD_INTENT_TTL_MS = 15 * 60 * 1000; // 15 minutes

// --- Variants --------------------------------------------------------------
//
// A closed registry, not arbitrary transforms (brief §10). Exact target
// dimensions chosen from the actual layouts this engine renders today:
// `thumbnail` for the Admin Media Library grid, `small`/`medium` for
// mobile/tablet-width Hero and Gallery renders, `large` for a desktop-width
// Hero. `original` is never re-encoded — it's the untouched upload,
// referenced by width/height/byteSize but with no separate stored copy.
export const IMAGE_VARIANT_TOKENS = ["thumbnail", "small", "medium", "large"] as const;
export type ImageVariantToken = (typeof IMAGE_VARIANT_TOKENS)[number];

/** Target max width per variant — see `packages/media/src/processing/variants.ts` for the "never upscale" resize rule. */
export const VARIANT_MAX_WIDTH: Record<ImageVariantToken, number> = {
  thumbnail: 320,
  small: 640,
  medium: 1280,
  large: 1920,
};
