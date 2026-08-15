import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./blocks";
import { DuplicateBlockRegistrationError, blockRegistry, registerBlock } from "./block-registry";
import {
  InvalidBlockPropsError,
  MalformedBlockEnvelopeError,
  UnknownBlockError,
} from "./block-registry";
import { generateBlockInstanceId } from "./block-instance";
import { parseBlockInstance, parsePageContentStrict } from "./parse-block";

describe("block registry: built-in blocks", () => {
  it("registers all 8 required blocks at type@version", () => {
    for (const [type, version] of [
      ["hero", 1],
      ["text", 1],
      ["gallery", 1],
      ["feature-list", 1],
      ["cta", 1],
      ["property-summary", 1],
      ["unit-grid", 1],
      ["amenities", 1],
    ] as const) {
      expect(blockRegistry.get(type, version)).toBeDefined();
    }
  });

  it("distinguishes content blocks from domain blocks via capabilities.domainBound", () => {
    expect(blockRegistry.get("hero", 1)?.capabilities.domainBound).toBe(false);
    expect(blockRegistry.get("property-summary", 1)?.capabilities.domainBound).toBe(true);
    expect(blockRegistry.get("unit-grid", 1)?.capabilities.domainBound).toBe(true);
    expect(blockRegistry.get("amenities", 1)?.capabilities.domainBound).toBe(true);
  });
});

describe("registerBlock: duplicate registration", () => {
  it("refuses to register the same type@version twice", () => {
    const definition = {
      type: `test-dup-${Date.now()}`,
      version: 1,
      schema: z.object({ text: z.string() }),
      capabilities: { domainBound: false },
    };
    registerBlock(definition);
    expect(() => registerBlock(definition)).toThrow(DuplicateBlockRegistrationError);
  });

  it("allows two different versions of the same type to coexist", () => {
    const type = `test-versioned-${Date.now()}`;
    registerBlock({
      type,
      version: 1,
      schema: z.object({ old: z.string() }),
      capabilities: { domainBound: false },
    });
    expect(() =>
      registerBlock({
        type,
        version: 2,
        schema: z.object({ next: z.string() }),
        capabilities: { domainBound: false },
      }),
    ).not.toThrow();

    expect(blockRegistry.get(type, 1)).toBeDefined();
    expect(blockRegistry.get(type, 2)).toBeDefined();
  });
});

describe("parseBlockInstance", () => {
  it("parses a known block + known version successfully, with the correctly typed props", () => {
    const parsed = parseBlockInstance({
      id: generateBlockInstanceId(),
      type: "hero",
      version: 1,
      props: { headline: { fr: "Bienvenue", en: "Welcome" } },
    });
    expect(parsed.type).toBe("hero");
    expect((parsed.props as { headline: Record<string, string> }).headline.fr).toBe("Bienvenue");
  });

  it("fails on an unknown block type", () => {
    expect(() =>
      parseBlockInstance({
        id: generateBlockInstanceId(),
        type: "does-not-exist",
        version: 1,
        props: {},
      }),
    ).toThrow(UnknownBlockError);
  });

  it("fails cleanly on an unknown version of a known type", () => {
    expect(() =>
      parseBlockInstance({ id: generateBlockInstanceId(), type: "hero", version: 999, props: {} }),
    ).toThrow(UnknownBlockError);
  });

  it("fails on invalid props for an otherwise-known block", () => {
    expect(() =>
      parseBlockInstance({
        id: generateBlockInstanceId(),
        type: "hero",
        // missing required `headline`
        version: 1,
        props: { subheadline: { fr: "x" } },
      }),
    ).toThrow(InvalidBlockPropsError);
  });

  it("fails on a malformed envelope (not even shaped like a block instance)", () => {
    expect(() => parseBlockInstance({ nope: true })).toThrow(MalformedBlockEnvelopeError);
    expect(() => parseBlockInstance("just a string")).toThrow(MalformedBlockEnvelopeError);
    expect(() => parseBlockInstance(null)).toThrow(MalformedBlockEnvelopeError);
  });

  it("rejects an empty LocalizedString (no locale keys at all)", () => {
    expect(() =>
      parseBlockInstance({
        id: generateBlockInstanceId(),
        type: "hero",
        version: 1,
        props: { headline: {} },
      }),
    ).toThrow(InvalidBlockPropsError);
  });
});

describe("parsePageContentStrict", () => {
  it("parses a valid array of block instances", () => {
    const parsed = parsePageContentStrict([
      { id: generateBlockInstanceId(), type: "hero", version: 1, props: { headline: { fr: "A" } } },
      { id: generateBlockInstanceId(), type: "text", version: 1, props: { body: { fr: "B" } } },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("rejects a non-array", () => {
    expect(() => parsePageContentStrict({})).toThrow(MalformedBlockEnvelopeError);
  });

  it("fails the whole page on the first invalid block, not silently skipping it", () => {
    expect(() =>
      parsePageContentStrict([
        {
          id: generateBlockInstanceId(),
          type: "hero",
          version: 1,
          props: { headline: { fr: "A" } },
        },
        { id: generateBlockInstanceId(), type: "unknown-type", version: 1, props: {} },
      ]),
    ).toThrow(UnknownBlockError);
  });

  it("accepts an empty page", () => {
    expect(parsePageContentStrict([])).toEqual([]);
  });
});
