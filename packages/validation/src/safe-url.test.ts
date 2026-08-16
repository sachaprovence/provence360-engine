import { describe, expect, it } from "vitest";
import { isSafeHref, safeHrefSchema } from "./safe-url";

describe("isSafeHref", () => {
  it.each([
    ["/contact", true],
    ["/properties/villa-des-oliviers", true],
    ["#gallery", true],
    ["https://example.com", true],
    ["http://example.com/page", true],
  ])("accepts %s", (value, expected) => {
    expect(isSafeHref(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:a@b.com",
    "tel:+123456",
    "example.com",
    "//evil.com",
  ])("rejects %s", (value) => {
    expect(isSafeHref(value)).toBe(false);
  });
});

describe("safeHrefSchema", () => {
  it("parses a safe relative href", () => {
    expect(safeHrefSchema.parse("/contact")).toBe("/contact");
  });

  it("rejects a javascript: URL", () => {
    expect(safeHrefSchema.safeParse("javascript:alert(document.cookie)").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(safeHrefSchema.safeParse("").success).toBe(false);
  });
});
