import { AsyncLocalStorage } from "node:async_hooks";

interface TenantStore {
  tenantId: string;
}

// Application-level view of "which tenant is this async call chain acting
// on". This is layer 1 of the defense-in-depth described in
// docs/MULTI_TENANCY.md — a convenience and a guard rail for application
// code (audit logging, assertions, error messages), NOT the security
// boundary itself. The boundary is Postgres RLS (layer 3), enforced
// independently of whether anything ever reads this store.
const tenantStorage = new AsyncLocalStorage<TenantStore>();

export class MissingTenantContextError extends Error {
  constructor() {
    super(
      "No tenant context is active. Every tenant-scoped operation must run inside withTenantContext().",
    );
    this.name = "MissingTenantContextError";
  }
}

/** The tenant id of the currently active `withTenantContext` call, if any. */
export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/** Same as {@link getCurrentTenantId}, but throws instead of returning undefined. */
export function requireCurrentTenantId(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) throw new MissingTenantContextError();
  return tenantId;
}

/** @internal used only by withTenantContext() to install the store. */
export function runWithTenantStore<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run({ tenantId }, fn);
}
