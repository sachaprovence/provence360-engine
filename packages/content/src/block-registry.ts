import type { z } from "zod";

/**
 * The one place a block type is described (section 11 of the brief).
 * `capabilities.domainBound` distinguishes a **content block** (Hero,
 * Text, CTA — its `props` fully describe what to render) from a
 * **domain block** (PropertySummary, UnitGrid, Amenities — its `props`
 * hold a *reference* into the Rental domain, e.g. a `propertyId`, plus
 * presentation options; the actual Property/Unit/Amenity data is loaded
 * at render time from `packages/rentals`, never duplicated into the
 * block's own JSON). See section 15 of the brief and docs/BLOCK_SYSTEM.md.
 */
export interface BlockDefinition<TProps = unknown> {
  type: string;
  version: number;
  schema: z.ZodType<TProps>;
  capabilities: { domainBound: boolean };
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
    this.#definitions.set(key, definition);
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
