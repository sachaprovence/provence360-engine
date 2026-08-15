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

export class MediaAssetNotFoundError extends Error {
  constructor(mediaAssetId: string) {
    super(`MediaAsset "${mediaAssetId}" was not found (or does not belong to the current tenant).`);
    this.name = "MediaAssetNotFoundError";
  }
}
