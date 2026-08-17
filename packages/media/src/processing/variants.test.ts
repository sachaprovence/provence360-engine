import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { VARIANT_MAX_WIDTH } from "../domain/constants";
import { MemoryObjectStorage } from "../storage/memory-object-storage";
import { validateImageBytes } from "../validation/image-validation";
import { generateImageVariants, storeImageVariants } from "./variants";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

describe("generateImageVariants", () => {
  it("generates every variant narrower than the source, none wider", async () => {
    const bytes = await makeJpeg(2000, 1500);
    const source = await validateImageBytes(bytes);
    const variants = await generateImageVariants(bytes, source);

    const tokens = variants.map((v) => v.token).sort();
    expect(tokens).toEqual(["large", "medium", "small", "thumbnail"]);
    for (const variant of variants) {
      expect(variant.width).toBeLessThanOrEqual(VARIANT_MAX_WIDTH[variant.token]);
      expect(variant.width).toBeLessThan(2000);
    }
  });

  it("never upscales — a source narrower than every variant target produces zero variants", async () => {
    const bytes = await makeJpeg(100, 80);
    const source = await validateImageBytes(bytes);
    const variants = await generateImageVariants(bytes, source);
    expect(variants).toEqual([]);
  });

  it("only produces variants strictly narrower than the source (partial coverage)", async () => {
    // Wider than thumbnail/small but narrower than medium/large.
    const bytes = await makeJpeg(700, 500);
    const source = await validateImageBytes(bytes);
    const variants = await generateImageVariants(bytes, source);
    const tokens = variants.map((v) => v.token).sort();
    expect(tokens).toEqual(["small", "thumbnail"]);
  });

  it("preserves aspect ratio when resizing", async () => {
    const bytes = await makeJpeg(2000, 1000); // 2:1
    const source = await validateImageBytes(bytes);
    const [thumbnail] = await generateImageVariants(bytes, source);
    expect(thumbnail).toBeDefined();
    if (thumbnail) {
      const ratio = thumbnail.width / thumbnail.height;
      expect(ratio).toBeCloseTo(2, 1);
    }
  });
});

describe("storeImageVariants", () => {
  it("uploads each variant and returns a validated, versioned metadata object", async () => {
    const bytes = await makeJpeg(2000, 1500);
    const source = await validateImageBytes(bytes);
    const resized = await generateImageVariants(bytes, source);
    const storage = new MemoryObjectStorage();

    const result = await storeImageVariants(storage, "tenant-1", "asset-1", resized, "image/jpeg");

    expect(result.version).toBe(1);
    expect(result.thumbnail).toBeDefined();
    if (result.thumbnail) {
      const stored = await storage.getObject(result.thumbnail.storageKey);
      expect(stored?.byteLength).toBe(result.thumbnail.byteSize);
    }
  });

  it("returns just {version: 1} when there are no variants to store", async () => {
    const storage = new MemoryObjectStorage();
    const result = await storeImageVariants(storage, "tenant-1", "asset-1", [], "image/jpeg");
    expect(result).toEqual({ version: 1 });
  });
});
