import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_BRANDING,
  UnknownSiteBrandingVersionError,
  parseSiteBrandingOverrides,
  resolveSiteBranding,
  siteBrandingV1Schema,
} from "./branding";

describe("DEFAULT_SITE_BRANDING", () => {
  it("is itself a valid, fully-resolved SiteBrandingV1", () => {
    expect(() => siteBrandingV1Schema.parse(DEFAULT_SITE_BRANDING)).not.toThrow();
  });
});

describe("resolveSiteBranding", () => {
  it("resolves to the default when given null (unconfigured site)", () => {
    expect(resolveSiteBranding(null)).toEqual(DEFAULT_SITE_BRANDING);
  });

  it("resolves to the default when given undefined", () => {
    expect(resolveSiteBranding(undefined)).toEqual(DEFAULT_SITE_BRANDING);
  });

  it("resolves to the default when given {} — the column's own default, meaning no version key (backward compatibility, section 11)", () => {
    expect(resolveSiteBranding({})).toEqual(DEFAULT_SITE_BRANDING);
  });

  it("layers a color override onto the default, leaving every other color untouched", () => {
    const resolved = resolveSiteBranding({
      version: 1,
      colors: { primary: "#ff0000" },
    });
    expect(resolved.colors.primary).toBe("#ff0000");
    expect(resolved.colors.background).toBe(DEFAULT_SITE_BRANDING.colors.background);
    expect(resolved.colors.secondary).toBe(DEFAULT_SITE_BRANDING.colors.secondary);
  });

  it("layers a typography override without touching radius/spacing/buttons/sections", () => {
    const resolved = resolveSiteBranding({
      version: 1,
      typography: { heading: "elegant-serif" },
    });
    expect(resolved.typography.heading).toBe("elegant-serif");
    expect(resolved.typography.body).toBe(DEFAULT_SITE_BRANDING.typography.body);
    expect(resolved.radius).toEqual(DEFAULT_SITE_BRANDING.radius);
  });

  it("layers a single button variant's style without resetting the other variant", () => {
    const resolved = resolveSiteBranding({
      version: 1,
      buttons: { primary: { style: "ghost" } },
    });
    expect(resolved.buttons.primary.style).toBe("ghost");
    expect(resolved.buttons.secondary).toEqual(DEFAULT_SITE_BRANDING.buttons.secondary);
  });

  it("resolves brand.name/logo when set", () => {
    const mediaId = "01a00000-0000-7000-8000-000000000001";
    const resolved = resolveSiteBranding({
      version: 1,
      brand: { name: "Villa Panoramique", logo: { mediaId } },
    });
    expect(resolved.brand.name).toBe("Villa Panoramique");
    expect(resolved.brand.logo).toEqual({ mediaId });
  });

  it("throws UnknownSiteBrandingVersionError on a future/unrecognized version", () => {
    expect(() => resolveSiteBranding({ version: 2 })).toThrow(UnknownSiteBrandingVersionError);
  });

  it("throws on a structurally invalid override (unknown key)", () => {
    expect(() => resolveSiteBranding({ version: 1, colors: { notAToken: "#fff" } })).toThrow();
  });

  it("throws on a non-hex color value (injection attempt)", () => {
    expect(() =>
      resolveSiteBranding({ version: 1, colors: { primary: "javascript:alert(1)" } }),
    ).toThrow();
    expect(() =>
      resolveSiteBranding({ version: 1, colors: { primary: "url(javascript:alert(1))" } }),
    ).toThrow();
    expect(() => resolveSiteBranding({ version: 1, colors: { primary: "var(--evil)" } })).toThrow();
    expect(() => resolveSiteBranding({ version: 1, colors: { primary: "red" } })).toThrow();
    expect(() =>
      resolveSiteBranding({ version: 1, colors: { primary: "expression(alert(1))" } }),
    ).toThrow();
    expect(() =>
      resolveSiteBranding({
        version: 1,
        colors: { primary: "</style><script>alert(1)</script>" },
      }),
    ).toThrow();
    expect(() =>
      resolveSiteBranding({ version: 1, colors: { primary: "blob:https://evil.example/uuid" } }),
    ).toThrow();
    expect(() =>
      resolveSiteBranding({
        version: 1,
        colors: { primary: "data:text/html,<script>alert(1)</script>" },
      }),
    ).toThrow();
  });

  it("throws on an unrecognized font token (closed registry)", () => {
    expect(() =>
      resolveSiteBranding({ version: 1, typography: { heading: "comic-sans" } }),
    ).toThrow();
  });

  it("throws on a non-uuid media reference", () => {
    expect(() =>
      resolveSiteBranding({ version: 1, brand: { logo: { mediaId: "not-a-uuid" } } }),
    ).toThrow();
  });
});

describe("parseSiteBrandingOverrides", () => {
  it("stores only what was actually overridden, not the resolved object — so a later DEFAULT_SITE_BRANDING change still applies", () => {
    const stored = parseSiteBrandingOverrides({ version: 1, colors: { primary: "#ff0000" } });
    expect(stored).toEqual({ version: 1, colors: { primary: "#ff0000" } });
    expect(Object.keys(stored)).not.toContain("radius");
  });

  it("defaults to an empty object when given null/undefined", () => {
    expect(parseSiteBrandingOverrides(null)).toEqual({});
    expect(parseSiteBrandingOverrides(undefined)).toEqual({});
  });
});
