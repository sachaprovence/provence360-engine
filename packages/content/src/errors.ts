export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

export class PageNotFoundError extends Error {
  constructor(pageId: string) {
    super(`Page "${pageId}" was not found (or does not belong to the current tenant).`);
    this.name = "PageNotFoundError";
  }
}

export class BlockNotFoundError extends Error {
  constructor(blockId: string, pageId: string) {
    super(`Block "${blockId}" was not found on page "${pageId}".`);
    this.name = "BlockNotFoundError";
  }
}

export class InvalidReorderError extends Error {
  constructor(reason: string) {
    super(`Invalid block reorder: ${reason}`);
    this.name = "InvalidReorderError";
  }
}

/**
 * Thrown by a Page mutation when the caller passed `expectedUpdatedAt` (an
 * optimistic-concurrency token — see packages/publishing/docs/PUBLISHING.md)
 * and the row's actual `updatedAt` no longer matches: someone else's write
 * already landed since the caller last read this page. Distinct from
 * {@link PageNotFoundError} — the page exists, it just isn't the version the
 * caller thinks it is. A caller that never passes `expectedUpdatedAt` (every
 * v0.3 call site) can never see this error; the check is opt-in.
 */
export class PageConflictError extends Error {
  constructor(pageId: string) {
    super(`Page "${pageId}" was modified by someone else since it was last read.`);
    this.name = "PageConflictError";
  }
}

export class MediaAssetNotFoundError extends Error {
  constructor(mediaAssetId: string) {
    super(`MediaAsset "${mediaAssetId}" was not found (or does not belong to the current tenant).`);
    this.name = "MediaAssetNotFoundError";
  }
}
