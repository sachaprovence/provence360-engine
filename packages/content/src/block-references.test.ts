import { describe, expect, it } from "vitest";
import "./blocks";
import { extractBlockReferences, parseBlockInstance } from "./parse-block";

const mediaId = "01a00000-0000-7000-8000-0000000000a1";
const mediaId2 = "01a00000-0000-7000-8000-0000000000a2";
const propertyId = "01a00000-0000-7000-8000-0000000000b1";
const unitId1 = "01a00000-0000-7000-8000-0000000000c1";
const unitId2 = "01a00000-0000-7000-8000-0000000000c2";

describe("extractBlockReferences", () => {
  it("hero: extracts its backgroundMediaId as a media reference, none when absent", () => {
    const withImage = parseBlockInstance({
      id: "b1",
      type: "hero",
      version: 1,
      props: { headline: { fr: "H" }, backgroundMediaId: mediaId },
    });
    expect(extractBlockReferences(withImage)).toEqual([{ kind: "media", id: mediaId }]);

    const withoutImage = parseBlockInstance({
      id: "b2",
      type: "hero",
      version: 1,
      props: { headline: { fr: "H" } },
    });
    expect(extractBlockReferences(withoutImage)).toEqual([]);
  });

  it("gallery: extracts every mediaAssetId, in the block's own order", () => {
    const block = parseBlockInstance({
      id: "b3",
      type: "gallery",
      version: 1,
      props: { mediaAssetIds: [mediaId, mediaId2] },
    });
    expect(extractBlockReferences(block)).toEqual([
      { kind: "media", id: mediaId },
      { kind: "media", id: mediaId2 },
    ]);
  });

  it("property-summary: extracts a domain reference to its propertyId", () => {
    const block = parseBlockInstance({
      id: "b4",
      type: "property-summary",
      version: 1,
      props: { propertyId },
    });
    expect(extractBlockReferences(block)).toEqual([
      { kind: "domain", domainType: "property", id: propertyId },
    ]);
  });

  it("unit-grid: extracts a domain reference to its propertyId, plus one per explicit unitId", () => {
    const block = parseBlockInstance({
      id: "b5",
      type: "unit-grid",
      version: 1,
      props: { propertyId, unitIds: [unitId1, unitId2] },
    });
    expect(extractBlockReferences(block)).toEqual([
      { kind: "domain", domainType: "property", id: propertyId },
      { kind: "domain", domainType: "unit", id: unitId1 },
      { kind: "domain", domainType: "unit", id: unitId2 },
    ]);
  });

  it("amenities: extracts a domain reference to its unitId", () => {
    const block = parseBlockInstance({
      id: "b6",
      type: "amenities",
      version: 1,
      props: { unitId: unitId1 },
    });
    expect(extractBlockReferences(block)).toEqual([
      { kind: "domain", domainType: "unit", id: unitId1 },
    ]);
  });

  it("amenities: extracts a domain reference to its propertyId when property-scoped (v0.6)", () => {
    const block = parseBlockInstance({
      id: "b6b",
      type: "amenities",
      version: 1,
      props: { propertyId },
    });
    expect(extractBlockReferences(block)).toEqual([
      { kind: "domain", domainType: "property", id: propertyId },
    ]);
  });

  it("text/feature-list/cta: reference nothing (no `references` declared)", () => {
    const text = parseBlockInstance({
      id: "b7",
      type: "text",
      version: 1,
      props: { body: { fr: "hello" } },
    });
    const featureList = parseBlockInstance({
      id: "b8",
      type: "feature-list",
      version: 1,
      props: { items: [{ title: { fr: "X" } }] },
    });
    const cta = parseBlockInstance({
      id: "b9",
      type: "cta",
      version: 1,
      props: { buttonLabel: { fr: "Go" }, buttonHref: "/go" },
    });
    expect(extractBlockReferences(text)).toEqual([]);
    expect(extractBlockReferences(featureList)).toEqual([]);
    expect(extractBlockReferences(cta)).toEqual([]);
  });
});
