import { describe, expect, it } from "vitest";
import "./index";
import { parseBlockInstance } from "../parse-block";

const propertyId = "01a00000-0000-7000-8000-0000000000b1";
const unitId = "01a00000-0000-7000-8000-0000000000c1";

// v0.6 evolved `property-summary@1`/`unit-grid@1`/`amenities@1` in place
// (section 18 of the brief: never break an already-stored `@1` block
// instance). These tests parse exactly the pre-v0.6 shape — the JSON a
// real stored Page's `content` column could already contain — and confirm
// it still parses, with the new fields taking their documented defaults.

describe("property-summary@1 — non-breaking evolution", () => {
  it("a pre-v0.6 stored instance (no showCheckInOut/showPolicies) still parses, defaulting both to false", () => {
    const block = parseBlockInstance({
      id: "b1",
      type: "property-summary",
      version: 1,
      props: { propertyId, showDescription: true, showAddress: true },
    });
    expect(block.props).toMatchObject({
      showDescription: true,
      showAddress: true,
      showCheckInOut: false,
      showPolicies: false,
    });
  });

  it("a v0.6 instance may opt into the new sections explicitly", () => {
    const block = parseBlockInstance({
      id: "b2",
      type: "property-summary",
      version: 1,
      props: { propertyId, showCheckInOut: true, showPolicies: true },
    });
    expect(block.props).toMatchObject({ showCheckInOut: true, showPolicies: true });
  });
});

describe("unit-grid@1 — non-breaking evolution", () => {
  it("a pre-v0.6 stored instance (no showBedSummary) still parses, defaulting to false", () => {
    const block = parseBlockInstance({
      id: "b3",
      type: "unit-grid",
      version: 1,
      props: { propertyId, columns: 3 },
    });
    expect(block.props).toMatchObject({ showBedSummary: false });
  });
});

describe("amenities@1 — non-breaking widening to Property-level (v0.6)", () => {
  it("a pre-v0.6 stored instance ({ unitId }, no propertyId) still parses unchanged", () => {
    const block = parseBlockInstance({
      id: "b4",
      type: "amenities",
      version: 1,
      props: { unitId },
    });
    expect(block.props).toMatchObject({ unitId });
  });

  it("a v0.6 property-scoped instance ({ propertyId }, no unitId) parses", () => {
    const block = parseBlockInstance({
      id: "b5",
      type: "amenities",
      version: 1,
      props: { propertyId },
    });
    expect(block.props).toMatchObject({ propertyId });
  });

  it("rejects both unitId and propertyId set at once — exactly one reference, never a block ambiguous about which catalog join to use", () => {
    expect(() =>
      parseBlockInstance({
        id: "b6",
        type: "amenities",
        version: 1,
        props: { unitId, propertyId },
      }),
    ).toThrow();
  });

  it("rejects neither unitId nor propertyId set — a block bound to nothing", () => {
    expect(() =>
      parseBlockInstance({
        id: "b7",
        type: "amenities",
        version: 1,
        props: {},
      }),
    ).toThrow();
  });
});
