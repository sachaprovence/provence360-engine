import { sql } from "drizzle-orm";
import { closeAdminPool, getAdminDb } from "../admin/index";
import { loadDotEnv } from "../load-env";
import { auditLogs, domains, memberships, sites, tenants, users } from "../schema";

// Minimal, idempotent dev seed: two tenants, a handful of users/memberships
// (including one contractor who belongs to both tenants — the reason Users
// are a global identity rather than a tenant-scoped table, see
// docs/MULTI_TENANCY.md), one site per tenant, and multiple domains per
// site. Runs on the admin connection, which owns the tables and therefore
// bypasses RLS by design — this is a bootstrap script, not a request path.

loadDotEnv();

async function main(): Promise<void> {
  const db = getAdminDb();

  console.log("Clearing existing data...");
  await db.execute(
    sql`truncate table ${auditLogs}, ${domains}, ${sites}, ${memberships}, ${tenants}, ${users} restart identity cascade`,
  );

  console.log("Seeding tenants...");
  const [provenceSud, luberonRetreats] = await db
    .insert(tenants)
    .values([
      { slug: "provence-sud", name: "Provence Sud", status: "active" },
      { slug: "luberon-retreats", name: "Luberon Retreats", status: "active" },
    ])
    .returning();
  if (!provenceSud || !luberonRetreats) throw new Error("Failed to seed tenants");

  console.log("Seeding users...");
  const [alice, bob, carla, diego, eve] = await db
    .insert(users)
    .values([
      { email: "alice@provence-sud.test", name: "Alice Martin" },
      { email: "bob@provence-sud.test", name: "Bob Lefevre" },
      { email: "carla@luberon-retreats.test", name: "Carla Rossi" },
      { email: "diego@luberon-retreats.test", name: "Diego Fernandez" },
      { email: "eve@contractor.test", name: "Eve Dubois" },
    ])
    .returning();
  if (!alice || !bob || !carla || !diego || !eve) throw new Error("Failed to seed users");

  console.log("Seeding memberships...");
  await db.insert(memberships).values([
    { tenantId: provenceSud.id, userId: alice.id, role: "owner" },
    { tenantId: provenceSud.id, userId: bob.id, role: "member" },
    { tenantId: luberonRetreats.id, userId: carla.id, role: "owner" },
    { tenantId: luberonRetreats.id, userId: diego.id, role: "admin" },
    // Eve is a contractor with a membership in both tenants — proof that
    // identity is global while access is scoped per membership.
    { tenantId: provenceSud.id, userId: eve.id, role: "member" },
    { tenantId: luberonRetreats.id, userId: eve.id, role: "member" },
  ]);

  console.log("Seeding sites...");
  const [villasCassis] = await db
    .insert(sites)
    .values([
      { tenantId: provenceSud.id, slug: "villas-cassis", name: "Villas Cassis", status: "active" },
    ])
    .returning();
  const [masDuLuberon] = await db
    .insert(sites)
    .values([
      {
        tenantId: luberonRetreats.id,
        slug: "mas-du-luberon",
        name: "Mas du Luberon",
        status: "active",
      },
    ])
    .returning();
  if (!villasCassis || !masDuLuberon) throw new Error("Failed to seed sites");

  console.log("Seeding domains...");
  await db.insert(domains).values([
    {
      tenantId: provenceSud.id,
      siteId: villasCassis.id,
      hostname: "villas-cassis.provence360.app",
      isPrimary: true,
      status: "active",
    },
    {
      tenantId: provenceSud.id,
      siteId: villasCassis.id,
      hostname: "villa-cassis-en-provence.com",
      isPrimary: false,
      status: "active",
    },
    {
      tenantId: luberonRetreats.id,
      siteId: masDuLuberon.id,
      hostname: "mas-du-luberon.provence360.app",
      isPrimary: true,
      status: "active",
    },
    {
      tenantId: luberonRetreats.id,
      siteId: masDuLuberon.id,
      hostname: "masduluberon.com",
      isPrimary: false,
      status: "active",
    },
  ]);

  console.log("Seeding an audit log entry per tenant...");
  await db.insert(auditLogs).values([
    {
      tenantId: provenceSud.id,
      actorUserId: alice.id,
      action: "site.created",
      targetType: "site",
      targetId: villasCassis.id,
      metadata: { slug: villasCassis.slug },
    },
    {
      tenantId: luberonRetreats.id,
      actorUserId: carla.id,
      action: "site.created",
      targetType: "site",
      targetId: masDuLuberon.id,
      metadata: { slug: masDuLuberon.slug },
    },
  ]);

  console.log("Seed complete:");
  console.log(
    `  tenants: provence-sud (${provenceSud.id}), luberon-retreats (${luberonRetreats.id})`,
  );
  console.log(`  sites:   villas-cassis (${villasCassis.id}), mas-du-luberon (${masDuLuberon.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeAdminPool();
  });
