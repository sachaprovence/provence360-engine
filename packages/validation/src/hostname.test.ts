import { describe, expect, it } from "vitest";
import { InvalidHostnameError, normalizeHostname } from "./hostname";

describe("normalizeHostname", () => {
  it("lowercases the hostname", () => {
    expect(normalizeHostname("Villa-Cassis.COM")).toBe("villa-cassis.com");
  });

  it("strips the port", () => {
    expect(normalizeHostname("cassis.provence360.app:3000")).toBe("cassis.provence360.app");
  });

  it("treats a leading www. as equivalent to the bare domain", () => {
    expect(normalizeHostname("www.villa-cassis.com")).toBe("villa-cassis.com");
  });

  it("strips a trailing dot and surrounding whitespace", () => {
    expect(normalizeHostname("  villa-cassis.com.  ")).toBe("villa-cassis.com");
  });

  it("rejects an empty hostname", () => {
    expect(() => normalizeHostname("")).toThrow(InvalidHostnameError);
  });

  it("rejects a single-label hostname", () => {
    expect(() => normalizeHostname("localhost")).toThrow(InvalidHostnameError);
  });

  it("rejects invalid characters", () => {
    expect(() => normalizeHostname("villa cassis/.com")).toThrow(InvalidHostnameError);
  });

  it("rejects labels with leading or trailing hyphens", () => {
    expect(() => normalizeHostname("-villa.com")).toThrow(InvalidHostnameError);
  });
});
