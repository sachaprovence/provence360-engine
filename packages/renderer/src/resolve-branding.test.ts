import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_BRANDING, resolveSiteBranding } from "@provence360/themes";
import {
  createBrandingCssVariables,
  resolveButtonStyle,
  resolveSectionStyle,
} from "./resolve-branding";

describe("createBrandingCssVariables", () => {
  it("emits the closed, fixed set of --site-* custom properties from the default branding", () => {
    const vars = createBrandingCssVariables(DEFAULT_SITE_BRANDING);
    expect(vars["--site-color-background"]).toBe(DEFAULT_SITE_BRANDING.colors.background);
    expect(vars["--site-color-primary"]).toBe(DEFAULT_SITE_BRANDING.colors.primary);
    expect(vars["--site-color-border"]).toBe(DEFAULT_SITE_BRANDING.colors.border);
    expect(vars["--site-font-heading"]).toContain("system-ui");
    expect(vars["--site-radius-sm"]).toBe("4px");
    expect(vars["--site-section-spacing"]).toBe("40px");
  });

  it("omits optional success/warning/danger variables when unset", () => {
    const vars = createBrandingCssVariables(DEFAULT_SITE_BRANDING);
    expect(vars).not.toHaveProperty("--site-color-success");
    expect(vars).not.toHaveProperty("--site-color-warning");
    expect(vars).not.toHaveProperty("--site-color-danger");
  });

  it("includes success/warning/danger when the tenant set them", () => {
    const branding = resolveSiteBranding({
      version: 1,
      colors: { success: "#00ff00", warning: "#ffff00", danger: "#ff0000" },
    });
    const vars = createBrandingCssVariables(branding);
    expect(vars["--site-color-success"]).toBe("#00ff00");
    expect(vars["--site-color-warning"]).toBe("#ffff00");
    expect(vars["--site-color-danger"]).toBe("#ff0000");
  });

  it("reflects an overridden font token in the resolved stack", () => {
    const branding = resolveSiteBranding({ version: 1, typography: { heading: "monospace" } });
    const vars = createBrandingCssVariables(branding);
    expect(vars["--site-font-heading"]).toContain("SFMono-Regular");
  });

  it("never contains a value shaped like CSS injection — only hex colors, closed font stacks, and closed length values", () => {
    const vars = createBrandingCssVariables(DEFAULT_SITE_BRANDING);
    for (const value of Object.values(vars)) {
      expect(value).not.toMatch(/javascript:|expression\(|<script|url\(/i);
    }
  });
});

describe("resolveButtonStyle", () => {
  const colors = { base: "#111111", foreground: "#eeeeee" };

  it("solid: background is the base color itself, text is the matching foreground", () => {
    const style = resolveButtonStyle(colors, "solid");
    expect(style.background).toBe(colors.base);
    expect(style.color).toBe(colors.foreground);
  });

  it("outline: transparent background, colored border and text", () => {
    const style = resolveButtonStyle(colors, "outline");
    expect(style.background).toBe("transparent");
    expect(style.color).toBe(colors.base);
    expect(style.border).toContain(colors.base);
  });

  it("ghost: transparent background, transparent border", () => {
    const style = resolveButtonStyle(colors, "ghost");
    expect(style.background).toBe("transparent");
    expect(style.border).toBe("1px solid transparent");
  });

  it("resolves independently per call — a primary and a secondary button can differ", () => {
    const primary = resolveButtonStyle(colors, "solid");
    const secondary = resolveButtonStyle({ base: "#222222", foreground: "#ffffff" }, "ghost");
    expect(primary.background).toBe(colors.base);
    expect(secondary.background).toBe("transparent");
  });
});

describe("resolveSectionStyle", () => {
  it("flat: no border, no shadow", () => {
    const style = resolveSectionStyle(DEFAULT_SITE_BRANDING);
    expect(style.boxShadow).toBe("none");
  });

  it("bordered: a visible border, no shadow", () => {
    const branding = resolveSiteBranding({ version: 1, sections: { style: "bordered" } });
    const style = resolveSectionStyle(branding);
    expect(style.border).toContain(branding.colors.border);
    expect(style.boxShadow).toBe("none");
  });

  it("elevated: a shadow, transparent border", () => {
    const branding = resolveSiteBranding({ version: 1, sections: { style: "elevated" } });
    const style = resolveSectionStyle(branding);
    expect(style.boxShadow).not.toBe("none");
  });
});
