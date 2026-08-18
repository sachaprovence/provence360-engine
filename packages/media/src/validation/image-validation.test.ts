import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_PIXELS } from "../domain/constants";
import { MediaDecodeError, MediaTooLargeError, MediaTypeRejectedError } from "../errors";
import { validateImageBytes } from "./image-validation";

async function makeJpeg(width = 100, height = 80): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();
}

async function makePng(width = 60, height = 60): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function makeWebp(width = 50, height = 40): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .webp()
    .toBuffer();
}

const SVG_PAYLOAD = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
);

/**
 * A real phone-camera-shaped file: raw pixel layout is landscape
 * (`rawWidth`x`rawHeight`), but an EXIF `Orientation` tag of 6 (the
 * single most common real-world value — a phone held upright shooting a
 * portrait photo, sensor mounted landscape) says "rotate 90° clockwise to
 * display correctly," meaning the photo is *actually* portrait
 * (`rawHeight` wide, `rawWidth` tall) once any correctly-behaving viewer
 * (every browser's own `<img>` included) renders it.
 */
async function makeJpegWithOrientation(
  rawWidth: number,
  rawHeight: number,
  orientation: number,
): Promise<Buffer> {
  return sharp({
    create: { width: rawWidth, height: rawHeight, channels: 3, background: { r: 9, g: 8, b: 7 } },
  })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}

describe("validateImageBytes", () => {
  it("accepts a real JPEG and reports real dimensions/mimeType/format", async () => {
    const bytes = await makeJpeg(120, 90);
    const result = await validateImageBytes(bytes);
    expect(result.format).toBe("jpeg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(120);
    expect(result.height).toBe(90);
    expect(result.byteSize).toBe(bytes.byteLength);
  });

  it("accepts a real PNG", async () => {
    const bytes = await makePng();
    const result = await validateImageBytes(bytes);
    expect(result.format).toBe("png");
    expect(result.mimeType).toBe("image/png");
  });

  it("accepts a real WebP", async () => {
    const bytes = await makeWebp();
    const result = await validateImageBytes(bytes);
    expect(result.format).toBe("webp");
    expect(result.mimeType).toBe("image/webp");
  });

  it("computes a deterministic SHA-256 checksum of the exact bytes", async () => {
    const bytes = await makeJpeg();
    const a = await validateImageBytes(bytes);
    const b = await validateImageBytes(Buffer.from(bytes));
    expect(a.checksumSha256).toBe(b.checksumSha256);
    expect(a.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two different images produce two different checksums", async () => {
    const a = await validateImageBytes(await makeJpeg(10, 10));
    const b = await validateImageBytes(await makeJpeg(200, 200));
    expect(a.checksumSha256).not.toBe(b.checksumSha256);
  });

  it("rejects an empty file", async () => {
    await expect(validateImageBytes(Buffer.alloc(0))).rejects.toThrow(MediaTypeRejectedError);
  });

  it("rejects a file over the byte limit", async () => {
    const bytes = await makeJpeg(500, 500);
    await expect(validateImageBytes(bytes, { maxBytes: 10 })).rejects.toThrow(MediaTooLargeError);
  });

  it("rejects a non-image file renamed to look like one (a text file, no real decoder match)", async () => {
    const fakeImage = Buffer.from("this is not actually an image, just plain text bytes");
    await expect(validateImageBytes(fakeImage)).rejects.toThrow(MediaDecodeError);
  });

  it("rejects a corrupted/truncated JPEG (too little data for a real header)", async () => {
    const bytes = await makeJpeg(300, 300);
    // libjpeg's header parser is lenient about missing *scan data* (it only
    // needs the SOF marker, which appears early), so truncating partway
    // through the file still decodes successfully — this instead removes
    // even the header itself, which cannot possibly decode.
    const truncated = bytes.subarray(0, 8);
    await expect(validateImageBytes(truncated)).rejects.toThrow(MediaDecodeError);
  });

  it("rejects SVG even though sharp can technically decode it via librsvg", async () => {
    await expect(validateImageBytes(SVG_PAYLOAD)).rejects.toThrow(MediaTypeRejectedError);
  });

  it("rejects a GIF (outside the closed accepted-format allowlist)", async () => {
    const gifBytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .gif()
      .toBuffer();
    await expect(validateImageBytes(gifBytes)).rejects.toThrow(MediaTypeRejectedError);
  });

  it("reports EXIF-orientation-corrected width/height — a 90°-rotated (Orientation 6) landscape-pixel photo is reported as portrait, matching what every browser actually displays", async () => {
    const bytes = await makeJpegWithOrientation(100, 60, 6);
    const result = await validateImageBytes(bytes);
    // Raw pixels are 100x60 (landscape); Orientation 6 means "rotate 90°
    // CW to display" — the *displayed*, correct shape is 60 wide x 100
    // tall (portrait). A width/height report that still says 100x60
    // would be describing the wrong axis for every aspect-ratio box the
    // renderer builds from it.
    expect(result.width).toBe(60);
    expect(result.height).toBe(100);
  });

  it("does NOT swap width/height for a non-90°-rotation orientation (e.g. Orientation 3, a 180° flip — same axes)", async () => {
    const bytes = await makeJpegWithOrientation(100, 60, 3);
    const result = await validateImageBytes(bytes);
    expect(result.width).toBe(100);
    expect(result.height).toBe(60);
  });

  it("rejects a real decompression-bomb-shaped file — a tiny byte count decoding to a pixel count over MAX_INPUT_PIXELS (brief §15/§8)", async () => {
    // A genuine decompression bomb: a single flat color compresses to a
    // tiny PNG regardless of pixel dimensions, which is exactly the shape
    // this guard exists for (a small download, an enormous decoded
    // buffer). 7000x6000 = 42,000,000 px, comfortably over the
    // 40,000,000px limit, while still encoding to only a few hundred
    // bytes — proving `limitInputPixels` (sharp's own, well-tested guard,
    // wired through `validateImageBytes`) actually refuses to decode this
    // rather than allocating the full raster buffer first.
    const width = 7000;
    const height = 6000;
    expect(width * height).toBeGreaterThan(MAX_INPUT_PIXELS);
    const bombBytes = await sharp({
      create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    // Confirms the test payload itself is genuinely bomb-shaped: decoded
    // pixel data would be >100x the actual file size on disk — not just
    // an oversized, honestly-large file that MediaTooLargeError would
    // already catch for a different reason.
    const decodedRasterBytes = width * height * 3;
    expect(decodedRasterBytes / bombBytes.byteLength).toBeGreaterThan(100);

    await expect(
      validateImageBytes(bombBytes, { maxBytes: bombBytes.byteLength + 1 }),
    ).rejects.toThrow(MediaDecodeError);
  });
});
