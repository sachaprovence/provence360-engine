import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMembership, getPermissionsForRole, listMembershipsForUser } from "@provence360/auth";
import { requireCurrentUser } from "@/lib/actor";
import { logoutAction } from "../../actions";
import { TenantSwitcher } from "./tenant-switcher";

export const dynamic = "force-dynamic";

// Chrome-level check: confirms the session's user has a Membership in this
// tenant so the nav/switcher render correctly, and 404s (not 403 — see
// docs/SECURITY.md) otherwise. This is NOT the security boundary by
// itself — every page under this layout independently calls
// `withTenantPage()` (which re-derives the same check plus the specific
// `permission` that page's data actually requires) before touching any
// tenant data. A layout that merely decided *not to render a link* would
// not stop a request that skipped straight to the page's URL.
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const user = await requireCurrentUser();

  const membership = await getMembership(user.id, tenantId);
  if (!membership) notFound();

  const [otherMemberships, permissions] = await Promise.all([
    listMembershipsForUser(user.id),
    Promise.resolve(getPermissionsForRole(membership.role)),
  ]);

  const base = `/admin/tenants/${tenantId}`;
  const navItems: Array<{ href: string; label: string; visible: boolean }> = [
    { href: base, label: "Overview", visible: permissions.has("tenant.read") },
    { href: `${base}/sites`, label: "Sites", visible: permissions.has("site.read") },
    { href: `${base}/domains`, label: "Domains", visible: permissions.has("domain.read") },
    { href: `${base}/media`, label: "Media", visible: permissions.has("media.read") },
    { href: `${base}/members`, label: "Members", visible: permissions.has("member.read") },
    { href: `${base}/audit`, label: "Audit log", visible: permissions.has("audit.read") },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid #e5e7eb",
          padding: "20px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <TenantSwitcher currentTenantId={tenantId} memberships={otherMemberships} />

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#111827",
                  textDecoration: "none",
                }}
              >
                {item.label}
              </Link>
            ))}
        </nav>

        <div style={{ marginTop: "auto", fontSize: 13, color: "#6b7280" }}>
          <p style={{ margin: "0 0 8px" }}>{user.email}</p>
          <form action={logoutAction}>
            <button type="submit" style={{ cursor: "pointer", color: "#374151" }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, padding: "24px 32px" }}>{children}</main>
    </div>
  );
}
