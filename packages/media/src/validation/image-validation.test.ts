import sharp from "sharp";
import { describe, expect, it } from "vitest";
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
});
