import { domains, sites } from "@provence360/database";
import { listMembers } from "@provence360/auth";
import { withTenantPage } from "@/lib/actor";

export const dynamic = "force-dynamic";

export default async function TenantOverviewPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const { tenant, siteCount, domainCount, memberCount } = await withTenantPage(
    tenantId,
    "tenant.read",
    async (tx, actor) => {
      const [siteRows, domainRows, memberRows] = await Promise.all([
        tx.select().from(sites),
        tx.select().from(domains),
        listMembers(tx),
      ]);
      return {
        tenant: actor,
        siteCount: siteRows.length,
        domainCount: domainRows.length,
        memberCount: memberRows.length,
      };
    },
  );

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Overview</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        Signed in as <strong>{tenant.role}</strong>
      </p>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          maxWidth: 480,
        }}
      >
        <Stat label="Sites" value={siteCount} />
        <Stat label="Domains" value={domainCount} />
        <Stat label="Members" value={memberCount} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
      <dt style={{ fontSize: 12, color: "#6b7280" }}>{label}</dt>
      <dd style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</dd>
    </div>
  );
}
