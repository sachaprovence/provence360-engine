import type { AppTx } from "@provence360/database";
import { createRevisionFromDraft } from "./create-revision";
import { publishRevision } from "./publish-revision";

export interface PublishSiteInput {
  siteId: string;
  actorUserId?: string;
}

/**
 * The admin "Publish" button's one entry point: validate the draft, freeze
 * it into a new immutable Revision, then atomically make that Revision the
 * Site's live one. Both steps run inside the same transaction (this
 * function opens none of its own — the caller's `withAuthorizedTenantContext`
 * already did), so a validation failure or a mid-flight error leaves the
 * previous publication exactly as it was: no half-published state is ever
 * observable (Invariant C/D — see docs/PUBLISHING.md).
 */
export async function publishSite(tx: AppTx, input: PublishSiteInput) {
  const revision = await createRevisionFromDraft(tx, input);
  return publishRevision(tx, {
    siteId: input.siteId,
    revisionId: revision.id,
    action: "publish",
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
  });
}
