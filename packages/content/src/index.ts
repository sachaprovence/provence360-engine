export { localizedStringSchema, resolveLocalizedString } from "./localized-string";
export type { LocalizedString } from "./localized-string";

export { seoSchema } from "./seo";
export type { Seo } from "./seo";

export {
  EMPTY_NAVIGATION,
  NAVIGATION_SCHEMA_VERSION,
  navigationExternalTargetSchema,
  navigationInternalTargetSchema,
  navigationSchema,
  navigationTargetSchema,
  parseDraftNavigation,
} from "./navigation";
export type {
  Navigation,
  NavigationExternalTarget,
  NavigationInternalTarget,
  NavigationItem,
  NavigationTarget,
} from "./navigation";

export { blockEnvelopeSchema, generateBlockInstanceId } from "./block-instance";
export type { BlockEnvelope } from "./block-instance";

export {
  DuplicateBlockRegistrationError,
  InvalidBlockPropsError,
  MalformedBlockEnvelopeError,
  UnknownBlockError,
  blockRegistry,
  registerBlock,
} from "./block-registry";
export type { BlockDefinition, BlockReference } from "./block-registry";

export { extractBlockReferences, parseBlockInstance, parsePageContentStrict } from "./parse-block";
export type { ParsedBlock } from "./parse-block";

// Importing this barrel registers every built-in block as a side effect —
// see src/blocks/index.ts.
export * from "./blocks";

export {
  BlockNotFoundError,
  InvalidReorderError,
  MediaAssetNotFoundError,
  PageConflictError,
  PageNotFoundError,
  SiteNotFoundError,
} from "./errors";

export {
  createMediaAsset,
  deleteMediaAsset,
  getMediaAsset,
  listMediaAssets,
  listMediaAssetsByIds,
} from "./media-repository";
export type { CreateMediaAssetInput } from "./media-repository";

export {
  addBlock,
  createPage,
  deletePage,
  getPage,
  getPageBySlug,
  listPagesForSite,
  removeBlock,
  reorderBlocks,
  updateBlockProps,
  updatePageMeta,
} from "./page-repository";
export type {
  AddBlockInput,
  CreatePageInput,
  RemoveBlockInput,
  ReorderBlocksInput,
  UpdateBlockPropsInput,
  UpdatePageMetaInput,
} from "./page-repository";
