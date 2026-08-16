export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

export class RevisionNotFoundError extends Error {
  constructor(revisionId: string) {
    super(`Revision "${revisionId}" was not found (or does not belong to this site/tenant).`);
    this.name = "RevisionNotFoundError";
  }
}

export interface PublishValidationIssue {
  code: string;
  message: string;
  pageId?: string;
}

/**
 * Thrown by `createRevisionFromDraft`/`publishSite` when the draft fails
 * the pre-publish validation pipeline (see draft-snapshot.ts's
 * `assembleDraft`). Carries every issue found, not just the first — the
 * admin UI renders the whole list rather than making the tenant fix one
 * problem at a time.
 */
export class PublishValidationError extends Error {
  constructor(public readonly issues: readonly PublishValidationIssue[]) {
    super(`Draft is not publishable: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "PublishValidationError";
  }
}
