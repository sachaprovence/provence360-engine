import Link from "next/link";
import { listMembershipsForUser } from "@provence360/auth";
import { requireCurrentUser } from "@/lib/actor";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function TenantSwitcherPage() {
  const user = await requireCurrentUser();
  const memberships = await listMembershipsForUser(user.id);

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1.5rem" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>Your tenants</h1>
          <p style={{ fontSize: 14, color: "#6b7280" }}>{user.email}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" style={{ fontSize: 14, color: "#374151", cursor: "pointer" }}>
            Sign out
          </button>
        </form>
      </header>

      {memberships.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          You don&apos;t belong to any tenant yet. Ask a tenant owner to add you.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {memberships.map((m) => (
            <li key={m.tenantId}>
              <Link
                href={`/admin/tenants/${m.tenantId}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "#111827",
                }}
              >
                <span style={{ fontWeight: 600 }}>{m.tenantName}</span>
                <span style={{ fontSize: 13, color: "#6b7280", textTransform: "uppercase" }}>
                  {m.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
