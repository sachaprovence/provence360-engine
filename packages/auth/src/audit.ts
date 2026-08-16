import { auditLogs } from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";

/**
 * Platform-level audit events (AUTH_LOGIN_SUCCESS, AUTH_LOGIN_FAILURE,
 * AUTH_LOGOUT) — happen before any tenant is selected, so `tenantId` is
 * always `null`. Written via `provence360_auth`, whose `auth_insert_audit_logs`
 * RLS policy only permits `tenant_id IS NULL` rows — this function is
 * structurally incapable of forging a tenant-scoped audit entry. For
 * tenant-scoped events (MEMBER_CREATED, SITE_CREATED, ...), use
 * `recordAuditLog` from `@provence360/observability` instead, inside
 * `withTenantContext`.
 *
 * Never pass a password, password hash, session token, or cookie value in
 * `metadata` — see docs/SECURITY.md.
 */
export async function recordAuthAuditEvent(input: {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getAuthDb()
    .insert(auditLogs)
    .values({
      tenantId: null,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    });
}
