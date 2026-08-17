import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import {
  ACCEPTED_IMAGE_FORMATS,
  type AcceptedImageFormat,
  FORMAT_TO_MIME_TYPE,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from "../domain/constants";
import { MediaDecodeError, MediaTooLargeError, MediaTypeRejectedError } from "../errors";

export interface ValidatedImage {
  format: AcceptedImageFormat;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  /** SHA-256 of the exact bytes validated — the asset's fingerprint. */
  checksumSha256: string;
}

/**
 * The real, server-side gate every uploaded file must pass before it can
 * ever become a MediaAsset (brief §8). Never trusts the client-declared
 * MIME type, the filename, or the extension — only the bytes themselves,
 * decoded by `sharp` (a real image codec, not a signature-sniffing
 * heuristic) and then checked against a *closed* format allowlist.
 *
 * Decodability alone is not sufficient: `sharp` can decode SVG (via
 * librsvg) into a raster image, which is exactly why SVG must be
 * explicitly rejected here even though it would otherwise "pass" a naive
 * "did it decode" check — see ADR 0022, "image-first scope."
 */
export async function validateImageBytes(
  bytes: Buffer,
  opts: { maxBytes?: number } = {},
): Promise<ValidatedImage> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  if (bytes.byteLength === 0) {
    throw new MediaTypeRejectedError("the file is empty.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new MediaTooLargeError(bytes.byteLength, maxBytes);
  }

  let metadata: Metadata;
  try {
    // `limitInputPixels` makes sharp itself refuse to decode a
    // decompression-bomb-shaped file (huge dimensions from a tiny byte
    // count) rather than allocating an enormous raster buffer first.
    metadata = await sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    }).metadata();
  } catch {
    throw new MediaDecodeError();
  }

  const format = metadata.format;
  if (!format || !isAcceptedFormat(format)) {
    throw new MediaTypeRejectedError(
      `unsupported image format. Accepted formats: ${ACCEPTED_IMAGE_FORMATS.join(", ")}.`,
    );
  }
  if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
    throw new MediaDecodeError();
  }

  return {
    format,
    mimeType: FORMAT_TO_MIME_TYPE[format],
    width: metadata.width,
    height: metadata.height,
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function isAcceptedFormat(format: string): format is AcceptedImageFormat {
  return (ACCEPTED_IMAGE_FORMATS as readonly string[]).includes(format);
}
