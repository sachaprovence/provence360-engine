import { describe, expect, it } from "vitest";
import {
  blockRendererRegistry,
  DuplicateBlockRendererError,
  registerBlockRenderer,
} from "./block-renderer-registry";
// Side effect: registers every built-in block's React renderer once.
import "./blocks/index";

describe("blockRendererRegistry", () => {
  it("has a registered renderer for every built-in content/domain block type@version", () => {
    const builtins = [
      "hero@1",
      "text@1",
      "gallery@1",
      "feature-list@1",
      "cta@1",
      "property-summary@1",
      "unit-grid@1",
      "amenities@1",
    ];
    for (const key of builtins) {
      const [type, version] = key.split("@") as [string, string];
      expect(blockRendererRegistry.get(type, Number(version))).toBeDefined();
    }
  });

  it("returns undefined for an unregistered type@version — the caller (renderBlocks) degrades gracefully rather than crashing", () => {
    expect(blockRendererRegistry.get("video", 1)).toBeUndefined();
    expect(blockRendererRegistry.get("hero", 999)).toBeUndefined();
  });

  it("refuses to register the same type@version twice", () => {
    registerBlockRenderer("__test_block__", 1, () => null as never);
    expect(() => {
      registerBlockRenderer("__test_block__", 1, () => null as never);
    }).toThrow(DuplicateBlockRendererError);
  });
});
