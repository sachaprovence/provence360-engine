// Importing this barrel registers every built-in block's React renderer
// as a side effect — see src/blocks/index.ts.
import "./blocks/index";

export type { RenderContext } from "./render-context";

export {
  DuplicateBlockRendererError,
  blockRendererRegistry,
  registerBlockRenderer,
} from "./block-renderer-registry";
export type { BlockRenderer } from "./block-renderer-registry";

export { renderBlocks } from "./render-page";

export { resolveSiteThemeTokens } from "./resolve-site-theme";
