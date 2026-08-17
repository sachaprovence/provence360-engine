import { describe, expect, it } from "vitest";
import { UnknownVirtualTourProviderError } from "./errors";
import { buildSafeVirtualTourEmbed, listAllProviderFrameOrigins } from "./embed";
import "./providers";

describe("buildSafeVirtualTourEmbed", () => {
  it("builds a deterministic, first-party-constructed embed descriptor from a stored Matterport row", () => {
    const embed = buildSafeVirtualTourEmbed({
      provider: "matterport",
      providerAssetId: "abc12345678",
    });
    expect(embed).toEqual({
      provider: "matterport",
      src: "https://my.matterport.com/show/?m=abc12345678",
      publicUrl: "https://my.matterport.com/show/?m=abc12345678",
      allowFullscreen: true,
      iframeAllow: "xr-spatial-tracking",
    });
  });

  it("throws UnknownVirtualTourProviderError for a stored provider value that isn't registered", () => {
    expect(() =>
      buildSafeVirtualTourEmbed({ provider: "not-a-real-provider", providerAssetId: "x" }),
    ).toThrow(UnknownVirtualTourProviderError);
  });
});

describe("listAllProviderFrameOrigins", () => {
  it("includes the Matterport origin, deduplicated, no wildcards", () => {
    const origins = listAllProviderFrameOrigins();
    expect(origins).toContain("https://my.matterport.com");
    expect(new Set(origins).size).toBe(origins.length);
    for (const origin of origins) {
      expect(origin).not.toContain("*");
    }
  });
});
