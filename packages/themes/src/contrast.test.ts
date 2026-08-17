import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_BRANDING } from "./branding";
import { contrastRatio, resolveContrastWarnings, WCAG_AA_NORMAL_TEXT_RATIO } from "./contrast";

describe("contrastRatio", () => {
  it("is exactly 1 for identical colors", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is 21 for pure black on pure white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(
      contrastRatio("#abcdef", "#123456"),
      10,
    );
  });

  it("handles 3-digit hex the same as its 6-digit expansion", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(contrastRatio("#ffffff", "#000000"), 5);
  });
});

describe("resolveContrastWarnings", () => {
  it("returns no warnings for the official default branding", () => {
    expect(resolveContrastWarnings(DEFAULT_SITE_BRANDING)).toEqual([]);
  });

  it("warns on a low-contrast background/text pair, without throwing or modifying anything", () => {
    const branding = {
      colors: {
        ...DEFAULT_SITE_BRANDING.colors,
        background: "#ffffff",
        text: "#eeeeee",
      },
    };
    const warnings = resolveContrastWarnings(branding);
    expect(warnings.length).toBeGreaterThan(0);
    const bgText = warnings.find((w) => w.pair === "background / text");
    expect(bgText).toBeDefined();
    expect(bgText?.ratio).toBeLessThan(WCAG_AA_NORMAL_TEXT_RATIO);
    // The input object itself is never mutated.
    expect(branding.colors.text).toBe("#eeeeee");
  });

  it("only warns for the pair that's actually low-contrast, not every pair", () => {
    const branding = {
      colors: {
        ...DEFAULT_SITE_BRANDING.colors,
        secondary: "#f0f0f0",
        secondaryForeground: "#f5f5f5",
      },
    };
    const warnings = resolveContrastWarnings(branding);
    expect(warnings.map((w) => w.pair)).toEqual(["secondary / secondaryForeground"]);
  });
});
