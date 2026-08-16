import type { AppTx } from "@provence360/database";
import { publishRevision } from "./publish-revision";

export interface RollbackSiteInput {
  siteId: string;
  targetRevisionId: string;
  actorUserId?: string;
}

/**
 * Re-publishes an existing, already-immutable Revision — never creates a
 * new one and never modifies the old one in place (Invariant E: a rollback
 * must not destroy history). Subject to the exact same tenant/site
 * ownership check as a normal publish (`publishRevision` re-derives
 * `targetRevisionId` through this tenant's RLS-scoped transaction and
 * checks it belongs to this Site), so rolling back to another tenant's — or
 * another Site's — revision id is rejected the same way a cross-tenant
 * publish is.
 */
export async function rollbackSite(tx: AppTx, input: RollbackSiteInput) {
  return publishRevision(tx, {
    siteId: input.siteId,
    revisionId: input.targetRevisionId,
    action: "rollback",
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
  });
}
