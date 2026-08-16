import type { ReactElement } from "react";
import type { RenderContext } from "./render-context";

/**
 * A React component for a `type@version` block — deliberately a SEPARATE
 * registry from `packages/content`'s `blockRegistry` (which only knows
 * about `{ type, version, schema, capabilities }`, never React). Keeping
 * them apart means `packages/content` stays free of any React/JSX
 * dependency (only apps + this renderer package touch React — same
 * boundary reasoning as every other package in this monorepo), and a
 * schema can exist and validate content before a renderer for it does.
 */
export type BlockRenderer<TProps = never> = (props: {
  id: string;
  props: TProps;
  context: RenderContext;
}) => ReactElement | Promise<ReactElement>;

export class DuplicateBlockRendererError extends Error {
  constructor(type: string, version: number) {
    super(`A renderer for block "${type}@${version}" is already registered.`);
    this.name = "DuplicateBlockRendererError";
  }
}

function rendererKey(type: string, version: number): string {
  return `${type}@${version}`;
}

class BlockRendererRegistry {
  #renderers = new Map<string, BlockRenderer<never>>();

  register<TProps>(type: string, version: number, renderer: BlockRenderer<TProps>): void {
    const key = rendererKey(type, version);
    if (this.#renderers.has(key)) {
      throw new DuplicateBlockRendererError(type, version);
    }
    this.#renderers.set(key, renderer as BlockRenderer<never>);
  }

  get(type: string, version: number): BlockRenderer<never> | undefined {
    return this.#renderers.get(rendererKey(type, version));
  }
}

/** The process-wide renderer registry — mirrors `packages/content`'s `blockRegistry` singleton pattern. */
export const blockRendererRegistry = new BlockRendererRegistry();

export function registerBlockRenderer<TProps>(
  type: string,
  version: number,
  renderer: BlockRenderer<TProps>,
): void {
  blockRendererRegistry.register(type, version, renderer);
}
