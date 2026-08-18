import type { MediaDeliveryResult } from "./media-delivery-handler";

/**
 * Builds the actual HTTP `Response` for a resolved delivery — the one
 * place both `apps/web` and `apps/admin`'s delivery routes assemble
 * headers, so `GET`/`HEAD`/conditional-request handling exists in exactly
 * one implementation (brief §9), the same reasoning `resolveMediaDelivery`
 * itself already follows for the byte-resolution half.
 *
 * Adds what v0.9 shipped without (brief §9's own audit list): `ETag`
 * (`result.etag`, quoted per RFC 9110 — a *strong* validator, since it's
 * derived from the asset's own content checksum plus variant, never from
 * anything that changes without the bytes also changing), `Content-Length`
 * (the real, already-known body size — never chunked for something this
 * small), `HEAD` support (identical headers, no body), and
 * `If-None-Match` -> `304 Not Modified` (skips re-sending bytes the
 * client's cache already has the current version of).
 *
 * Deliberately does NOT implement `Range`/`206 Partial Content` (brief
 * §10 asks this to be a genuine evaluation, not a reflexive box-tick):
 * every asset this route ever serves is a fully-processed, closed-format
 * (`jpeg`/`png`/`webp`) image capped at `MAX_UPLOAD_BYTES` (15 MiB) —
 * there is no video/audio in scope to seek within, no resumable-download
 * use case, and a browser's own `<img>` loading never issues a Range
 * request for a same-origin image on its own. If this product ever grows
 * a genuinely large-file or seekable-media use case, Range support
 * belongs here (this one shared place) — not implemented speculatively
 * ahead of that need.
 */
export function buildMediaDeliveryResponse(
  result: MediaDeliveryResult,
  opts: {
    method: "GET" | "HEAD";
    ifNoneMatch: string | null;
    cacheControl: string;
  },
): Response {
  const etag = `"${result.etag}"`;
  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Length": String(result.body.byteLength),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": opts.cacheControl,
  };

  if (opts.ifNoneMatch && ifNoneMatchMatches(opts.ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }

  const body = opts.method === "HEAD" ? null : new Uint8Array(result.body);
  return new Response(body, { status: 200, headers });
}

/**
 * `If-None-Match` can carry a comma-separated list of validators, or the
 * literal `*` (matches any current representation — RFC 9110 §13.1.2).
 * Our own ETags are always strong (never `W/`-prefixed), so an exact
 * string match after splitting is a correct, sufficient comparison here —
 * no weak-comparison algorithm is needed for a header this project only
 * ever emits itself.
 */
function ifNoneMatchMatches(headerValue: string, etag: string): boolean {
  if (headerValue.trim() === "*") return true;
  return headerValue
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
}
