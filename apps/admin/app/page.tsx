import { getAdminDb } from "@provence360/database/admin-db";
import { domains, sites, tenants } from "@provence360/database";

// Internal, read-only operator view across ALL tenants — the one place in
// this codebase where using the RLS-bypassing admin connection from
// request-serving code is intentional: an admin dashboard's entire purpose
// is a cross-tenant view. It is NOT gated by authentication yet (Foundation
// v0.1 has no login flow — see docs/ROADMAP.md). Do not deploy this
// publicly reachable until that lands; see docs/SECURITY.md.
//
// Imports "./admin-db" specifically, not the full "./admin" barrel: that
// barrel also re-exports runMigrations()/setupRoles(), which resolve the
// migrations folder via `new URL("../../migrations", import.meta.url)` —
// meaningful for a Node script, meaningless (and unbuildable — Turbopack
// and webpack both fail to resolve it) once bundled into a Next.js app.

// This page has no dynamic API (no headers()/cookies()), so Next would
// otherwise try to statically prerender it at build time — freezing live,
// cross-tenant admin data into a stale snapshot, and requiring a database
// connection to even be available during `next build`. Force it dynamic:
// this view must always reflect the current database.
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const db = getAdminDb();
  const [allTenants, allSites, allDomains] = await Promise.all([
    db.select().from(tenants),
    db.select().from(sites),
    db.select().from(domains),
  ]);

  const sitesByTenant = new Map<string, number>();
  for (const site of allSites) {
    sitesByTenant.set(site.tenantId, (sitesByTenant.get(site.tenantId) ?? 0) + 1);
  }
  const domainsByTenant = new Map<string, number>();
  for (const domain of allDomains) {
    domainsByTenant.set(domain.tenantId, (domainsByTenant.get(domain.tenantId) ?? 0) + 1);
  }

  return (
    <main style={{ maxWidth: 800, margin: "3rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: 24 }}>Tenants</h1>
      <p style={{ fontSize: 13, color: "#b91c1c", marginBottom: 24 }}>
        Unauthenticated internal tool — Foundation v0.1 has no login flow yet.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ padding: "8px 4px" }}>Tenant</th>
            <th style={{ padding: "8px 4px" }}>Status</th>
            <th style={{ padding: "8px 4px" }}>Sites</th>
            <th style={{ padding: "8px 4px" }}>Domains</th>
          </tr>
        </thead>
        <tbody>
          {allTenants.map((tenant) => (
            <tr key={tenant.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px 4px" }}>{tenant.name}</td>
              <td style={{ padding: "8px 4px" }}>{tenant.status}</td>
              <td style={{ padding: "8px 4px" }}>{sitesByTenant.get(tenant.id) ?? 0}</td>
              <td style={{ padding: "8px 4px" }}>{domainsByTenant.get(tenant.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
