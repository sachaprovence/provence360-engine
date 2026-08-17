export { assembleDraft } from "./draft-snapshot";
export type { DraftAssembly, SiteSnapshot, SiteSnapshotPage } from "./draft-snapshot";

export {
  EMPTY_RESOLVED_NAVIGATION,
  InvalidSnapshotError,
  SNAPSHOT_SCHEMA_VERSION,
  UnknownSnapshotVersionError,
  mediaDescriptorSchema,
  parseSiteSnapshot,
  resolvedNavigationSchema,
  resolvedNavigationTargetSchema,
  siteSnapshotV3Schema,
} from "./site-snapshot";
export type {
  MediaDescriptor,
  ResolvedNavigation,
  ResolvedNavigationItem,
  ResolvedNavigationTarget,
} from "./site-snapshot";

export { resolveNavigation } from "./resolve-navigation";
export type { NavigationResolution, PublishablePage } from "./resolve-navigation";

export {
  collectReferences,
  resolveBrandMedia,
  resolveMediaManifest,
  validateDomainReferences,
} from "./media-manifest";
export type { CollectedReferences } from "./media-manifest";

export { snapshotsEqual } from "./snapshot-equal";

export { createRevisionFromDraft } from "./create-revision";
export type { CreateRevisionFromDraftInput } from "./create-revision";

export { publishRevision } from "./publish-revision";
export type { PublishRevisionInput } from "./publish-revision";

export { publishSite } from "./publish";
export type { PublishSiteInput } from "./publish";

export { rollbackSite } from "./rollback";
export type { RollbackSiteInput } from "./rollback";

export { getDraftSummary, listPublicationHistory, listRevisions } from "./draft-service";
export type { DraftSummary, PublicationHistoryEntry, RevisionSummary } from "./draft-service";

export { getPublishedRevision } from "./published-revision";
export type { PublishedRevisionResult } from "./published-revision";

export { PublishValidationError, RevisionNotFoundError, SiteNotFoundError } from "./errors";
export type { PublishValidationIssue } from "./errors";
