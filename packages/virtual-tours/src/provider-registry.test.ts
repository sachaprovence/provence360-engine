import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DuplicateVirtualTourProviderRegistrationError,
  UnknownVirtualTourProviderError,
} from "./errors";
import {
  virtualTourProviderRegistry,
  type VirtualTourProviderDefinition,
} from "./provider-registry";
import "./providers";

function fakeProvider(provider: string): VirtualTourProviderDefinition {
  return {
    provider,
    normalize: (rawInput) => ({ providerAssetId: rawInput }),
    validateExternalId: () => true,
    buildEmbedUrl: (providerAssetId) => `https://example.test/${provider}/${providerAssetId}`,
    frameOrigins: ["https://example.test"],
    capabilities: { allowFullscreen: false },
  };
}

// The process-wide singleton (same "one shared registry, unique keys per
// test" convention as packages/content's block-registry.test.ts). The
// registry itself is a CLOSED mechanism (section 8 of the v0.7 brief):
// there is no "generic"/pass-through provider it could ever hand back, and
// no way to register the same provider key twice.
describe("virtualTourProviderRegistry", () => {
  it("register/get round-trips a provider definition", () => {
    const definition = fakeProvider(`fake-${randomUUID()}`);
    virtualTourProviderRegistry.register(definition);
    expect(virtualTourProviderRegistry.get(definition.provider)).toBe(definition);
  });

  it("get returns undefined for an unregistered provider", () => {
    expect(virtualTourProviderRegistry.get(`nope-${randomUUID()}`)).toBeUndefined();
  });

  it("require throws UnknownVirtualTourProviderError for an unregistered provider", () => {
    expect(() => virtualTourProviderRegistry.require(`nope-${randomUUID()}`)).toThrow(
      UnknownVirtualTourProviderError,
    );
  });

  it("require returns the definition for a registered provider", () => {
    const definition = fakeProvider(`fake-${randomUUID()}`);
    virtualTourProviderRegistry.register(definition);
    expect(virtualTourProviderRegistry.require(definition.provider)).toBe(definition);
  });

  it("registering the same provider key twice throws DuplicateVirtualTourProviderRegistrationError", () => {
    const definition = fakeProvider(`fake-${randomUUID()}`);
    virtualTourProviderRegistry.register(definition);
    expect(() => virtualTourProviderRegistry.register(definition)).toThrow(
      DuplicateVirtualTourProviderRegistrationError,
    );
  });

  it("list includes every registered provider, including the built-in Matterport one", () => {
    const providers = virtualTourProviderRegistry.list().map((p) => p.provider);
    expect(providers).toContain("matterport");
  });
});
