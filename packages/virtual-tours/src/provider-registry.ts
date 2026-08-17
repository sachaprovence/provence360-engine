import {
  DuplicateVirtualTourProviderRegistrationError,
  UnknownVirtualTourProviderError,
} from "./errors";

/**
 * The one place a Virtual Tour provider is described (section 7 of the
 * v0.7 brief). Every provider-specific concern lives entirely behind this
 * shape — `packages/publishing`, `packages/renderer`, and `apps/admin`
 * only ever call `normalize`/`buildEmbedUrl`/etc. through the registry,
 * never branch on `provider === "matterport"` themselves. Adding a second
 * provider later means writing one more `VirtualTourProviderDefinition`
 * and registering it — no change to any of those call sites.
 *
 * This is deliberately a CLOSED registry: there is no "generic iframe
 * provider" and no way to register one whose `buildEmbedUrl` returns a
 * caller-supplied URL unchanged (section 8 of the brief) — every
 * definition here is first-party code that fully controls what src a
 * VirtualTour can ever resolve to.
 */
export interface VirtualTourProviderDefinition {
  /** Stable key, stored verbatim in `virtual_tours.provider`. */
  provider: string;
  /**
   * Parses admin-facing input (a pasted share URL, or a bare provider id)
   * into this provider's canonical external identity. Throws
   * `InvalidVirtualTourProviderInputError` — never returns a partial or
   * best-effort result — when the input doesn't match any format this
   * provider accepts.
   */
  normalize(rawInput: string): { providerAssetId: string };
  /**
   * Re-validates an already-stored `providerAssetId` — used at publish
   * time and at render time to catch a row that somehow ended up with a
   * malformed id (a defense-in-depth re-check, not the primary write-time
   * validation, which is `normalize`).
   */
  validateExternalId(providerAssetId: string): boolean;
  /**
   * Deterministically builds the safe, first-party-constructed embed
   * `src` for an already-validated `providerAssetId`. Never accepts or
   * echoes back anything from outside this module — the only input is the
   * provider's own canonical id.
   */
  buildEmbedUrl(providerAssetId: string): string;
  /** A safe, public, "open in a new tab" URL — when the provider has one distinct from the embed src. */
  buildPublicUrl?(providerAssetId: string): string;
  /** The exact origin(s) this provider's embeds are served from — the source of truth for the CSP `frame-src` allowlist (see `docs/adr/0019-virtual-tour-immersive-kernel.md`). */
  frameOrigins: readonly string[];
  capabilities: {
    allowFullscreen: boolean;
    /** Verbatim `iframe allow="..."` permissions-policy value from this provider's own official embed snippet — e.g. Matterport's documented `"xr-spatial-tracking"`. `undefined` when a provider's official snippet specifies none. Never a renderer-side guess: the renderer only ever passes this value through. */
    iframeAllow?: string;
  };
}

class VirtualTourProviderRegistry {
  #providers = new Map<string, VirtualTourProviderDefinition>();

  register(definition: VirtualTourProviderDefinition): void {
    if (this.#providers.has(definition.provider)) {
      throw new DuplicateVirtualTourProviderRegistrationError(definition.provider);
    }
    this.#providers.set(definition.provider, definition);
  }

  get(provider: string): VirtualTourProviderDefinition | undefined {
    return this.#providers.get(provider);
  }

  /** Throws `UnknownVirtualTourProviderError` instead of returning `undefined` — every call site that reaches here already expects a real, registered provider (a stored `virtual_tours.provider` value, or an admin-facing provider picker). */
  require(provider: string): VirtualTourProviderDefinition {
    const definition = this.get(provider);
    if (!definition) throw new UnknownVirtualTourProviderError(provider);
    return definition;
  }

  /** Every registered provider — used by the CSP `frame-src` builder and admin "which providers are supported" UI. */
  list(): readonly VirtualTourProviderDefinition[] {
    return [...this.#providers.values()];
  }
}

/** The process-wide registry — mirrors `packages/content`'s `blockRegistry` singleton pattern. */
export const virtualTourProviderRegistry = new VirtualTourProviderRegistry();
