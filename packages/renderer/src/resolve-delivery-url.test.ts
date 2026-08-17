import { describe, expect, it } from "vitest";
import type { FrozenMediaDescriptor } from "./render-context";
import { buildMediaDeliveryUrl, resolveResponsiveImage } from "./resolve-delivery-url";

describe("buildMediaDeliveryUrl", () => {
  it("embeds asset id, fingerprint, and variant in a same-origin path", () => {
    expect(buildMediaDeliveryUrl("asset-1", "abc", "large")).toBe("/media/asset-1/abc/large");
  });
});

const base: FrozenMediaDescriptor = {
  id: "asset-1",
  storageKey: "tenants/t/media/asset-1/original",
  mimeType: "image/jpeg",
  width: 2000,
  height: 1500,
  altText: null,
};

describe("resolveResponsiveImage", () => {
  it("falls back to the raw storageKey for a legacy asset with no checksum (pre-v0.9 behavior preserved)", () => {
    const image = resolveResponsiveImage(base);
    expect(image.src).toBe(base.storageKey);
    expect(image.srcSet).toBeUndefined();
    expect(image.width).toBe(2000);
    expect(image.height).toBe(1500);
  });

  it("uses the delivery route and the largest available variant when a checksum + variants exist", () => {
    const descriptor: FrozenMediaDescriptor = {
      ...base,
      checksumSha256: "f".repeat(64),
      variants: {
        thumbnail: { storageKey: "k1", width: 320, height: 240, byteSize: 1 },
        small: { storageKey: "k2", width: 640, height: 480, byteSize: 1 },
      },
    };
    const image = resolveResponsiveImage(descriptor);
    expect(image.src).toBe(`/media/asset-1/${"f".repeat(64)}/small`);
    expect(image.width).toBe(640);
    expect(image.height).toBe(480);
  });

  it("builds a srcSet covering every generated variant plus the original", () => {
    const descriptor: FrozenMediaDescriptor = {
      ...base,
      checksumSha256: "a".repeat(64),
      variants: {
        thumbnail: { storageKey: "k1", width: 320, height: 240, byteSize: 1 },
        small: { storageKey: "k2", width: 640, height: 480, byteSize: 1 },
        medium: { storageKey: "k3", width: 1280, height: 960, byteSize: 1 },
      },
    };
    const image = resolveResponsiveImage(descriptor);
    expect(image.srcSet).toContain("320w");
    expect(image.srcSet).toContain("640w");
    expect(image.srcSet).toContain("1280w");
    expect(image.srcSet).toContain("2000w"); // the original
  });

  it("falls back to the original delivery URL when the asset has a checksum but zero generated variants", () => {
    const descriptor: FrozenMediaDescriptor = {
      ...base,
      checksumSha256: "b".repeat(64),
      variants: {},
    };
    const image = resolveResponsiveImage(descriptor);
    expect(image.src).toBe(`/media/asset-1/${"b".repeat(64)}/original`);
  });

  it("never upscales — width/height always reflect the resolved variant, never larger than the source", () => {
    const descriptor: FrozenMediaDescriptor = {
      ...base,
      checksumSha256: "c".repeat(64),
      variants: { thumbnail: { storageKey: "k1", width: 320, height: 240, byteSize: 1 } },
    };
    const image = resolveResponsiveImage(descriptor);
    expect(image.width).toBeLessThanOrEqual(base.width as number);
  });
});
