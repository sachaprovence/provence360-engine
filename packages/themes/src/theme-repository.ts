import { eq } from "drizzle-orm";
import type { AppTx } from "@provence360/database";
import { themes } from "@provence360/database";

/**
 * The platform-level theme catalog (docs/adr/0011-theme-token-model.md) —
 * not tenant-scoped, read-only from tenant-facing code. There is no
 * `createTheme`/`updateTheme` here in v0.3: the catalog is curated by the
 * admin/owner role (migrations/seed), never by a Server Action reachable
 * from `withAuthorizedTenantContext`.
 */
export async function listThemes(tx: AppTx) {
  return tx.select().from(themes).where(eq(themes.status, "active"));
}

export async function getTheme(tx: AppTx, id: string) {
  const [row] = await tx.select().from(themes).where(eq(themes.id, id));
  return row ?? null;
}
