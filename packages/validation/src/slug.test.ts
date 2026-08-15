import { describe, expect, it } from "vitest";
import { InvalidSlugError, normalizeSlug, slugSchema, toSlug } from "./slug";

describe("normalizeSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(normalizeSlug("Villa des Oliviers")).toBe("villa-des-oliviers");
  });

  it("strips accents (NFD-decomposable diacritics)", () => {
    expect(normalizeSlug("Café des Étoiles")).toBe("cafe-des-etoiles");
    expect(normalizeSlug("Provençal Ménage")).toBe("provencal-menage");
  });

  it("drops apostrophes without leaving a hyphen behind", () => {
    expect(normalizeSlug("L'Étoile du Berger")).toBe("letoile-du-berger");
  });

  it("collapses runs of whitespace and punctuation into a single hyphen", () => {
    expect(normalizeSlug("  Villa   du   Ventoux!!  ")).toBe("villa-du-ventoux");
  });

  it("collapses repeated hyphens and trims leading/trailing ones", () => {
    expect(normalizeSlug("café---été")).toBe("cafe-ete");
    expect(normalizeSlug("--already-slug--")).toBe("already-slug");
  });

  it("passes through an already-valid slug unchanged", () => {
    expect(normalizeSlug("villa-des-oliviers")).toBe("villa-des-oliviers");
  });

  it("normalizes non-Latin/unrepresentable input to an empty string, never throwing", () => {
    expect(normalizeSlug("日本語")).toBe("");
    expect(normalizeSlug("🏡🌴")).toBe("");
  });

  it("normalizes an empty string to an empty string", () => {
    expect(normalizeSlug("")).toBe("");
  });

  it("neutralizes path-traversal sequences — a slug can never contain '/' or '.', by construction", () => {
    // "/" and "." both fail the `[a-z0-9]` allowlist, so every run of them
    // (plus surrounding characters) collapses to a single hyphen, and any
    // leading/trailing hyphen is trimmed — there is no way to reconstruct
    // "../" from a normalized slug. This is what makes a slug safe to use
    // directly as a URL path segment (docs/RENDERING.md#security).
    expect(normalizeSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(normalizeSlug("..%2F..%2Fetc")).toBe("2f-2fetc");
    expect(normalizeSlug("....//....//")).toBe("");
    expect(normalizeSlug("a/../b")).toBe("a-b");
  });
});

describe("toSlug", () => {
  it("normalizes and returns a valid slug", () => {
    expect(toSlug("Villa des Oliviers")).toBe("villa-des-oliviers");
  });

  it("rejects input that normalizes to an empty string", () => {
    expect(() => toSlug("日本語")).toThrow(InvalidSlugError);
    expect(() => toSlug("!!!")).toThrow(InvalidSlugError);
    expect(() => toSlug("")).toThrow(InvalidSlugError);
  });

  it("rejects a slug over the maximum length", () => {
    expect(() => toSlug("a".repeat(81))).toThrow(InvalidSlugError);
  });

  it("accepts a slug at exactly the maximum length", () => {
    expect(toSlug("a".repeat(80))).toHaveLength(80);
  });

  it("rejects a default-reserved slug", () => {
    expect(() => toSlug("admin")).toThrow(InvalidSlugError);
    expect(() => toSlug("API")).toThrow(InvalidSlugError);
  });

  it("accepts a custom reserved list, overriding the default", () => {
    expect(() => toSlug("admin", { reserved: [] })).not.toThrow();
    expect(() => toSlug("villa", { reserved: ["villa"] })).toThrow(InvalidSlugError);
  });

  it("does not silently resolve a collision — that's the caller's/DB's job", () => {
    // toSlug has no notion of "already taken"; calling it twice with the
    // same input deterministically returns the same slug both times.
    expect(toSlug("Villa des Oliviers")).toBe(toSlug("Villa des Oliviers"));
  });
});

describe("slugSchema", () => {
  it("accepts a canonical slug", () => {
    expect(slugSchema.safeParse("villa-des-oliviers").success).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(slugSchema.safeParse("Villa").success).toBe(false);
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(slugSchema.safeParse("-villa").success).toBe(false);
    expect(slugSchema.safeParse("villa-").success).toBe(false);
  });

  it("rejects a double hyphen", () => {
    expect(slugSchema.safeParse("villa--des-oliviers").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(slugSchema.safeParse("").success).toBe(false);
  });

  it("rejects spaces and accented characters", () => {
    expect(slugSchema.safeParse("villa des oliviers").success).toBe(false);
    expect(slugSchema.safeParse("café").success).toBe(false);
  });
});
