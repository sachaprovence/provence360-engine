import { describe, expect, it } from "vitest";
import { buildMediaDeliveryUrl, resolveDeliveryStorageKey } from "./media-url";

describe("buildMediaDeliveryUrl", () => {
  it("embeds the asset id, fingerprint, and variant in a same-origin path", () => {
    expect(buildMediaDeliveryUrl("asset-1", "abc123", "thumbnail")).toBe(
      "/media/asset-1/abc123/thumbnail",
    );
  });

  it("different fingerprints produce different URLs for the same asset id/variant", () => {
    const a = buildMediaDeliveryUrl("asset-1", "aaa", "original");
    const b = buildMediaDeliveryUrl("asset-1", "bbb", "original");
    expect(a).not.toBe(b);
  });
});

describe("resolveDeliveryStorageKey", () => {
  const asset = {
    id: "asset-1",
    storageKey: "tenants/t/media/asset-1/original",
    variants: {
      version: 1 as const,
      thumbnail: {
        storageKey: "tenants/t/media/asset-1/thumbnail",
        width: 1,
        height: 1,
        byteSize: 1,
      },
    },
  };

  it("resolves 'original' to the asset's own storageKey", () => {
    expect(resolveDeliveryStorageKey(asset, "original")).toBe(asset.storageKey);
  });

  it("resolves a generated variant to its own storageKey", () => {
    expect(resolveDeliveryStorageKey(asset, "thumbnail")).toBe(asset.variants.thumbnail.storageKey);
  });

  it("falls back to the original for a variant that was never generated", () => {
    expect(resolveDeliveryStorageKey(asset, "large")).toBe(asset.storageKey);
  });

  it("falls back to the original when the asset has no variants at all", () => {
    const bare = { id: "asset-2", storageKey: "k" };
    expect(resolveDeliveryStorageKey(bare, "thumbnail")).toBe("k");
  });
});
