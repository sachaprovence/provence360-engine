import { describe, expect, it } from "vitest";
import { FALLBACK_THEME_TOKENS, resolveTheme } from "./resolve";
import { themeTokensSchema } from "./tokens";

const baseTokens = {
  ...FALLBACK_THEME_TOKENS,
  "color.primary": "olive",
};

describe("resolveTheme", () => {
  it("returns the base theme's tokens unchanged when there are no overrides", () => {
    const resolved = resolveTheme(baseTokens);
    expect(resolved["color.primary"]).toBe("olive");
    expect(resolved["font.heading"]).toBe(FALLBACK_THEME_TOKENS["font.heading"]);
  });

  it("layers a site's override on top of the base theme, key by key", () => {
    const resolved = resolveTheme(baseTokens, { "color.primary": "blue" });
    expect(resolved["color.primary"]).toBe("blue");
    // Everything else still comes from the base theme, untouched.
    expect(resolved["color.background"]).toBe(baseTokens["color.background"]);
  });

  it("two sites can override the same base theme differently, without forking it", () => {
    const villaOliviers = resolveTheme(baseTokens, { "color.primary": "olive-green" });
    const villaAzur = resolveTheme(baseTokens, { "color.primary": "blue" });

    expect(villaOliviers["color.primary"]).toBe("olive-green");
    expect(villaAzur["color.primary"]).toBe("blue");
    // Both still share every other token from the same base theme.
    expect(villaOliviers["font.body"]).toBe(villaAzur["font.body"]);
  });

  it("falls back to the hard-coded fallback theme when there is no base theme", () => {
    const resolved = resolveTheme(null);
    expect(resolved).toEqual(FALLBACK_THEME_TOKENS);
  });

  it("rejects an override holding a key outside the closed token catalog", () => {
    expect(() => resolveTheme(baseTokens, { "color.wildcard": "red" })).toThrow();
  });

  it("throws on a malformed base theme (missing a required token)", () => {
    const { "font.heading": _omit, ...incomplete } = baseTokens;
    expect(() => resolveTheme(incomplete)).toThrow();
  });
});

describe("themeTokensSchema", () => {
  it("accepts a complete, valid token set", () => {
    expect(themeTokensSchema.safeParse(FALLBACK_THEME_TOKENS).success).toBe(true);
  });

  it("rejects an incomplete token set", () => {
    const { "color.primary": _omit, ...incomplete } = FALLBACK_THEME_TOKENS;
    expect(themeTokensSchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects a non-string token value", () => {
    expect(
      themeTokensSchema.safeParse({ ...FALLBACK_THEME_TOKENS, "color.primary": 12345 }).success,
    ).toBe(false);
  });
});
