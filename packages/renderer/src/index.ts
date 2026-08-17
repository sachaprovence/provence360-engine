// Importing this barrel registers every built-in block's React renderer
// as a side effect — see src/blocks/index.ts.
import "./blocks/index";

export type { FrozenMediaDescriptor, RenderContext } from "./render-context";

export {
  DuplicateBlockRendererError,
  blockRendererRegistry,
  registerBlockRenderer,
} from "./block-renderer-registry";
export type { BlockRenderer } from "./block-renderer-registry";

export { renderBlocks } from "./render-page";

export { renderNavigation } from "./render-navigation";
export type {
  RenderableNavigation,
  RenderableNavigationItem,
  RenderableNavigationTarget,
} from "./render-navigation";

export { resolveMediaDescriptor, resolveMediaDescriptors } from "./resolve-media";

export { resolveSiteThemeTokens } from "./resolve-site-theme";
