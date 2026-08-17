import { describe, expect, it } from "vitest";
import { InvalidVirtualTourProviderInputError } from "../errors";
import { matterportProvider } from "./matterport";

// Security/normalization matrix for the Matterport adapter — the mission's
// explicit requirement that this provider act as a CLOSED allowlist, never
// a "merely doesn't look obviously wrong" pass-through. Every accepted
// input must resolve to the exact same, first-party-constructed embed URL
// regardless of how it was spelled; every rejected input must throw
// `InvalidVirtualTourProviderInputError` before ever reaching the database.
describe("matterportProvider.normalize", () => {
  it("accepts a bare 11-character Model SID", () => {
    expect(matterportProvider.normalize("abc12345678")).toEqual({
      providerAssetId: "abc12345678",
    });
  });

  it("accepts the official share URL format (https://my.matterport.com/show/?m=<sid>)", () => {
    expect(matterportProvider.normalize("https://my.matterport.com/show/?m=abc12345678")).toEqual({
      providerAssetId: "abc12345678",
    });
  });

  it("accepts the older bare root URL format (https://my.matterport.com/?m=<sid>)", () => {
    expect(matterportProvider.normalize("https://my.matterport.com/?m=abc12345678")).toEqual({
      providerAssetId: "abc12345678",
    });
  });

  it("ignores extra query parameters on the input URL — only `m` is ever read", () => {
    expect(
      matterportProvider.normalize(
        "https://my.matterport.com/show/?m=abc12345678&play=1&qs=1&brand=0",
      ),
    ).toEqual({ providerAssetId: "abc12345678" });
  });

  it("trims surrounding whitespace on a bare SID", () => {
    expect(matterportProvider.normalize("  abc12345678  ")).toEqual({
      providerAssetId: "abc12345678",
    });
  });

  it("rejects a different host entirely", () => {
    expect(() => matterportProvider.normalize("https://example.com/show/?m=abc12345678")).toThrow(
      InvalidVirtualTourProviderInputError,
    );
  });

  it("rejects a lookalike subdomain designed to pass a naive substring check", () => {
    expect(() =>
      matterportProvider.normalize("https://my.matterport.com.evil.example/show/?m=abc12345678"),
    ).toThrow(InvalidVirtualTourProviderInputError);
  });

  it("rejects a lookalike prefix host", () => {
    expect(() =>
      matterportProvider.normalize("https://evil-my.matterport.com/show/?m=abc12345678"),
    ).toThrow(InvalidVirtualTourProviderInputError);
  });

  it("rejects a non-https scheme, including javascript:/data:/blob: injection attempts", () => {
    for (const attempt of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://my.matterport.com/abc12345678",
      "http://my.matterport.com/show/?m=abc12345678",
    ]) {
      expect(() => matterportProvider.normalize(attempt)).toThrow(
        InvalidVirtualTourProviderInputError,
      );
    }
  });

  it("rejects a URL with no `m` query parameter", () => {
    expect(() => matterportProvider.normalize("https://my.matterport.com/show/")).toThrow(
      InvalidVirtualTourProviderInputError,
    );
  });

  it("rejects a URL whose `m` parameter isn't a valid-shaped SID", () => {
    expect(() =>
      matterportProvider.normalize("https://my.matterport.com/show/?m=not-a-real-sid"),
    ).toThrow(InvalidVirtualTourProviderInputError);
  });

  it("rejects a bare string that is too short, too long, or contains non-alphanumeric characters", () => {
    for (const attempt of ["short", "toolong123456789", "abc-1234567", "", "   "]) {
      expect(() => matterportProvider.normalize(attempt)).toThrow(
        InvalidVirtualTourProviderInputError,
      );
    }
  });

  it("rejects an unrelated path on the correct host", () => {
    expect(() =>
      matterportProvider.normalize("https://my.matterport.com/some/other/path?m=abc12345678"),
    ).toThrow(InvalidVirtualTourProviderInputError);
  });
});

describe("matterportProvider.buildEmbedUrl / buildPublicUrl", () => {
  it("deterministically builds the same canonical embed URL for a given SID, regardless of how it was originally spelled", () => {
    const fromBareSid = matterportProvider.normalize("abc12345678");
    const fromShareUrl = matterportProvider.normalize(
      "https://my.matterport.com/show/?m=abc12345678",
    );
    expect(matterportProvider.buildEmbedUrl(fromBareSid.providerAssetId)).toBe(
      matterportProvider.buildEmbedUrl(fromShareUrl.providerAssetId),
    );
    expect(matterportProvider.buildEmbedUrl("abc12345678")).toBe(
      "https://my.matterport.com/show/?m=abc12345678",
    );
  });

  it("buildPublicUrl matches buildEmbedUrl for Matterport (same canonical share URL)", () => {
    expect(matterportProvider.buildPublicUrl?.("abc12345678")).toBe(
      matterportProvider.buildEmbedUrl("abc12345678"),
    );
  });
});

describe("matterportProvider.validateExternalId", () => {
  it("accepts an 11-character alphanumeric SID", () => {
    expect(matterportProvider.validateExternalId("abc12345678")).toBe(true);
  });

  it("rejects a malformed stored id (defense in depth against a corrupted row)", () => {
    expect(matterportProvider.validateExternalId("not valid!")).toBe(false);
    expect(matterportProvider.validateExternalId("")).toBe(false);
    expect(matterportProvider.validateExternalId("toolong123456789")).toBe(false);
  });
});

describe("matterportProvider capabilities / frameOrigins", () => {
  it("declares exactly the one Matterport origin, no wildcards", () => {
    expect(matterportProvider.frameOrigins).toEqual(["https://my.matterport.com"]);
  });

  it("declares allowFullscreen and the exact iframeAllow value from the official embed snippet", () => {
    expect(matterportProvider.capabilities.allowFullscreen).toBe(true);
    expect(matterportProvider.capabilities.iframeAllow).toBe("xr-spatial-tracking");
  });
});
