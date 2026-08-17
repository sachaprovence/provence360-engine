import { describe, expect, it } from "vitest";
import { resolveMediaVariants } from "./media-variants";

describe("resolveMediaVariants", () => {
  it("returns null for null", () => {
    expect(resolveMediaVariants(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(resolveMediaVariants(undefined)).toBeNull();
  });

  it("returns null for {} — the column's own default, and every pre-v0.9 row", () => {
    expect(resolveMediaVariants({})).toBeNull();
  });

  it("parses a valid v1 object", () => {
    const raw = {
      version: 1,
      thumbnail: { storageKey: "k", width: 10, height: 10, byteSize: 100 },
    };
    expect(resolveMediaVariants(raw)).toEqual(raw);
  });

  it("throws on an unrecognized version", () => {
    expect(() => resolveMediaVariants({ version: 2 })).toThrow();
  });

  it("throws on an unknown key (closed shape)", () => {
    expect(() => resolveMediaVariants({ version: 1, huge: {} })).toThrow();
  });

  it("throws on a malformed variant entry", () => {
    expect(() =>
      resolveMediaVariants({
        version: 1,
        thumbnail: { storageKey: "k", width: -1, height: 10, byteSize: 1 },
      }),
    ).toThrow();
  });
});
