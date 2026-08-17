import { describe, expect, it } from "vitest";
import { hexColorSchema, isHexColor, normalizeHexColor } from "./color";

describe("isHexColor", () => {
  it.each(["#fff", "#FFF", "#ffffff", "#FFFFFF", "#a1b2c3", "#000", "#000000"])(
    "accepts %s",
    (value) => {
      expect(isHexColor(value)).toBe(true);
    },
  );

  it.each([
    "red",
    "rgb(255, 0, 0)",
    "rgba(255, 0, 0, 0.5)",
    "hsl(0, 100%, 50%)",
    "var(--evil)",
    "url(javascript:alert(1))",
    "expression(alert(1))",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://evil.example/uuid",
    "</style><script>alert(1)</script>",
    "#gg0000",
    "#ff00",
    "#ff000",
    "#fffffff",
    "",
    " #fff",
    "#fff ",
    "#fff;background:url(x)",
    "#fff/**/",
  ])("rejects %s", (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe("normalizeHexColor", () => {
  it("lowercases a valid hex value", () => {
    expect(normalizeHexColor("#FFAA00")).toBe("#ffaa00");
  });
});

describe("hexColorSchema", () => {
  it("parses and normalizes a valid hex color", () => {
    expect(hexColorSchema.parse("#FFAA00")).toBe("#ffaa00");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(hexColorSchema.parse("  #fff  ")).toBe("#fff");
  });

  it("rejects a non-hex value", () => {
    expect(hexColorSchema.safeParse("red").success).toBe(false);
  });

  it("rejects an injection attempt", () => {
    expect(hexColorSchema.safeParse("url(javascript:alert(1))").success).toBe(false);
  });
});
