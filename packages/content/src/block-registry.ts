import type { z } from "zod";

/**
 * A single external resource a block instance's `props` points at —
 * either a `MediaAsset` (an image/video the block renders) or a Rental
 * domain row (a Property/Unit the block references). This is the generic
 * mechanism `packages/publishing`'s composition/publish pipeline uses to
 * discover what to freeze (media) or existence-check (domain) at publish
 * time, without a central switch statement that has to know every block
 * type by name (section 8 of the v0.5 brief) — a new block declares its
 * own `references`, the pipeline stays unchanged.
 */
export interface BlockReference {
  kind: "media" | "domain";
  /** Only meaningful when `kind === "domain"` — which Rental entity this reference targets. */
  domainType?: "property" | "unit";
  id: string;
}

/**
 * The one place a block type is described (section 11 of the brief).
 * `capabilities.domainBound` distinguishes a **content block** (Hero,
 * Text, CTA — its `props` fully describe what to render) from a
 * **domain block** (PropertySummary, UnitGrid, Amenities — its `props`
 * hold a *reference* into the Rental domain, e.g. a `propertyId`, plus
 * presentation options; the actual Property/Unit/Amenity data is loaded
 * at render time from `packages/rentals`, never duplicated into the
 * block's own JSON). See section 15 of the brief and docs/BLOCK_SYSTEM.md.
 *
 * `references` (v0.5, optional) is a pure function from a block's own
 * already-validated `props` to the {@link BlockReference}s it holds — a
 * block with no external references (Text, FeatureList, CTA's plain text
 * fields) simply omits it, which `extractBlockReferences` (parse-block.ts)
 * treats as "references nothing."
 */
export interface BlockDefinition<TProps = unknown> {
  type: string;
  version: number;
  schema: z.ZodType<TProps>;
  capabilities: { domainBound: boolean };
  references?: (props: TProps) => readonly BlockReference[];
}

export class DuplicateBlockRegistrationError extends Error {
  constructor(type: string, version: number) {
    super(`Block "${type}@${version}" is already registered.`);
    this.name = "DuplicateBlockRegistrationError";
  }
}

export class UnknownBlockError extends Error {
  constructor(
    public readonly type: string,
    public readonly version: number,
  ) {
    super(`Unknown block "${type}@${version}" — no BlockDefinition is registered for it.`);
    this.name = "UnknownBlockError";
  }
}

export class InvalidBlockPropsError extends Error {
  constructor(
    public readonly type: string,
    public readonly version: number,
    public readonly issues: z.core.$ZodIssue[],
  ) {
    super(
      `Invalid props for block "${type}@${version}": ${issues.map((i) => i.message).join("; ")}`,
    );
    this.name = "InvalidBlockPropsError";
  }
}

export class MalformedBlockEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Malformed block instance: ${reason}`);
    this.name = "MalformedBlockEnvelopeError";
  }
}

function blockKey(type: string, version: number): string {
  return `${type}@${version}`;
}

class BlockRegistry {
  #definitions = new Map<string, BlockDefinition>();

  register<TProps>(definition: BlockDefinition<TProps>): void {
    const key = blockKey(definition.type, definition.version);
    if (this.#definitions.has(key)) {
      throw new DuplicateBlockRegistrationError(definition.type, definition.version);
    }
    // Type-erased on storage, the same idiom `packages/renderer`'s sibling
    // registry uses for its own renderer functions (`as BlockRenderer<never>`
    // there) — every reader (`get()`) already returns the erased
    // `BlockDefinition` (TProps=unknown), so this cast doesn't widen what
    // callers can actually observe.
    this.#definitions.set(key, definition as BlockDefinition);
  }

  get(type: string, version: number): BlockDefinition | undefined {
    return this.#definitions.get(blockKey(type, version));
  }

  /** Every registered `type@version` — used by admin UI "add a block" pickers. */
  list(): readonly BlockDefinition[] {
    return [...this.#definitions.values()];
  }
}

/**
 * The process-wide registry. A singleton by design (mirroring
 * `packages/tenant`'s single `AsyncLocalStorage` instance): every
 * `registerBlock` call anywhere in the process — from `packages/content`'s
 * own built-in blocks, or a future first-party extension — writes into
 * the same map the parser reads from.
 */
export const blockRegistry = new BlockRegistry();

export function registerBlock<TProps>(definition: BlockDefinition<TProps>): void {
  blockRegistry.register(definition);
}
