/**
 * Business-level media errors — never a raw storage-provider or codec
 * exception surfaced to a caller. See ADR 0022, "failure model." Every
 * message is deliberately generic about *why* a file was rejected (never
 * echoing raw decoder output, which could itself carry attacker-controlled
 * bytes) — the specific reason is only ever logged, structured, server-side.
 */

export class MediaUploadNotFoundError extends Error {
  constructor(uploadId: string) {
    super(`Media upload "${uploadId}" was not found (or does not belong to the current tenant).`);
    this.name = "MediaUploadNotFoundError";
  }
}

export class MediaUploadExpiredError extends Error {
  constructor(uploadId: string) {
    super(`Media upload "${uploadId}" has expired.`);
    this.name = "MediaUploadExpiredError";
  }
}

export class MediaUploadAlreadyFinalizedError extends Error {
  constructor(uploadId: string) {
    super(`Media upload "${uploadId}" was already finalized (or failed) — it cannot be reused.`);
    this.name = "MediaUploadAlreadyFinalizedError";
  }
}

/** The storage object the intent points at doesn't exist at finalize time. */
export class MediaObjectMissingError extends Error {
  constructor(uploadId: string) {
    super(`No object was found in storage for media upload "${uploadId}".`);
    this.name = "MediaObjectMissingError";
  }
}

/** The stored bytes decode, but not into a format v0.9 accepts (or don't decode at all). */
export class MediaTypeRejectedError extends Error {
  constructor(reason: string) {
    super(`This file was rejected: ${reason}`);
    this.name = "MediaTypeRejectedError";
  }
}

export class MediaTooLargeError extends Error {
  constructor(actualBytes: number, maxBytes: number) {
    super(`File is ${actualBytes} bytes, which exceeds the ${maxBytes}-byte limit.`);
    this.name = "MediaTooLargeError";
  }
}

/** A real decoder rejected the bytes outright — corrupt, truncated, or not an image at all. */
export class MediaDecodeError extends Error {
  constructor() {
    super("This file could not be decoded as a valid image.");
    this.name = "MediaDecodeError";
  }
}
