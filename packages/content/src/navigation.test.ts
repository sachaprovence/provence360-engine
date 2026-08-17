import { describe, expect, it } from "vitest";
import { EMPTY_NAVIGATION, navigationSchema, parseDraftNavigation } from "./navigation";

const uuid1 = "01a00000-0000-7000-8000-000000000001";
const uuid2 = "01a00000-0000-7000-8000-000000000002";
const uuid3 = "01a00000-0000-7000-8000-000000000003";

describe("navigationSchema", () => {
  it("accepts an empty navigation", () => {
    const result = navigationSchema.safeParse({ version: 1, items: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a normal navigation with internal and external targets", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        {
          id: "home",
          label: { fr: "Accueil", en: "Home" },
          target: { kind: "page", pageId: uuid1 },
        },
        {
          id: "blog",
          label: { fr: "Blog" },
          target: { kind: "external", href: "https://blog.example.com", newTab: true },
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // `children` is always present (default []), never absent — see the schema's own doc comment.
      expect(result.data.items[0]?.children).toEqual([]);
    }
  });

  it("accepts one level of nested children", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        {
          id: "parent",
          label: { fr: "Parent" },
          target: { kind: "external", href: "/parent" },
          children: [
            { id: "child", label: { fr: "Enfant" }, target: { kind: "external", href: "/child" } },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed navigation (not an object)", () => {
    expect(navigationSchema.safeParse([]).success).toBe(false);
    expect(navigationSchema.safeParse("nav").success).toBe(false);
    expect(navigationSchema.safeParse(null).success).toBe(false);
  });

  it("rejects a target with neither a recognized kind nor the fields it requires", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [{ id: "x", label: { fr: "X" }, target: { kind: "page" } }], // missing pageId
    });
    expect(result.success).toBe(false);
  });

  it("rejects nesting beyond the maximum depth (grandchildren)", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        {
          id: "a",
          label: { fr: "A" },
          target: { kind: "external", href: "/a" },
          children: [
            {
              id: "b",
              label: { fr: "B" },
              target: { kind: "external", href: "/b" },
              children: [{ id: "c", label: { fr: "C" }, target: { kind: "external", href: "/c" } }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("depth"))).toBe(true);
    }
  });

  it("rejects duplicate item ids, including across sibling branches", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        {
          id: "dup",
          label: { fr: "A" },
          target: { kind: "external", href: "/a" },
          children: [{ id: "dup", label: { fr: "B" }, target: { kind: "external", href: "/b" } }],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("Duplicate"))).toBe(true);
    }
  });

  it("rejects an external target with a disallowed protocol", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        { id: "x", label: { fr: "X" }, target: { kind: "external", href: "javascript:alert(1)" } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a protocol-relative external href", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        { id: "x", label: { fr: "X" }, target: { kind: "external", href: "//evil.example" } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an item whose label is an empty localized string", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [{ id: "x", label: {}, target: { kind: "external", href: "/x" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a pageId that isn't a valid UUID", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [{ id: "x", label: { fr: "X" }, target: { kind: "page", pageId: "not-a-uuid" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more top-level items than the maximum", () => {
    const items = Array.from({ length: 31 }, (_, i) => ({
      id: `item-${String(i)}`,
      label: { fr: `Item ${String(i)}` },
      target: { kind: "external" as const, href: "/x" },
    }));
    const result = navigationSchema.safeParse({ version: 1, items });
    expect(result.success).toBe(false);
  });

  it("uuid1/uuid2/uuid3 are distinct fixtures usable across a multi-item test", () => {
    const result = navigationSchema.safeParse({
      version: 1,
      items: [
        { id: "a", label: { fr: "A" }, target: { kind: "page", pageId: uuid1 } },
        { id: "b", label: { fr: "B" }, target: { kind: "page", pageId: uuid2 } },
        { id: "c", label: { fr: "C" }, target: { kind: "page", pageId: uuid3 } },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("parseDraftNavigation", () => {
  it("normalizes the pre-v0.5 legacy column default ([]) to EMPTY_NAVIGATION", () => {
    expect(parseDraftNavigation([])).toEqual(EMPTY_NAVIGATION);
  });

  it("still rejects a non-empty legacy-shaped array (not tolerated as a special case)", () => {
    expect(() => parseDraftNavigation([{ label: "old shape" }])).toThrow();
  });

  it("parses a real, well-formed navigation object normally", () => {
    const nav = parseDraftNavigation({
      version: 1,
      items: [{ id: "a", label: { fr: "A" }, target: { kind: "page", pageId: uuid1 } }],
    });
    expect(nav.items).toHaveLength(1);
  });
});
