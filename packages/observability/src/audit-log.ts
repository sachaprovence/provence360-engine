import type { AppTx } from "@provence360/database";
import { auditLogs } from "@provence360/database";
import { requireCurrentTenantId } from "@provence360/tenant";

/**
 * Records an audit trail entry for the current tenant. Like every other
 * write in this codebase, `tenantId` is derived from the active
 * `withTenantContext()` call, never accepted as an argument. The
 * `tenant_read_audit_logs` / `tenant_insert_audit_logs` RLS policies grant
 * the app role SELECT and INSERT here — deliberately no UPDATE/DELETE
 * policy exists, so this table is append-only at the database level, not
 * just by application convention.
 */
export async function recordAuditLog(
  tx: AppTx,
  input: {
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const tenantId = requireCurrentTenantId();
  const [row] = await tx
    .insert(auditLogs)
    .values({
      tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!row) throw new Error("Failed to record audit log entry");
  return row;
}
