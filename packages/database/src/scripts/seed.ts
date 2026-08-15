import { hash as argon2Hash } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import { closeAdminPool, getAdminDb } from "../admin/index";
import { loadDotEnv } from "../load-env";
import { auditLogs, domains, memberships, sites, tenants, users } from "../schema";

// Minimal, idempotent dev seed: two tenants ("Alpha" = Provence Sud, "Beta"
// = Luberon Retreats), a handful of users/memberships exercising every
// role/scope combination the Control Plane's authorization tests rely on,
// one site per tenant, and multiple domains per site. Runs on the admin
// connection, which owns the tables and therefore bypasses RLS by design —
// this is a bootstrap script, not a request path.
//
// SEED PASSWORDS ARE PUBLIC. They exist only so `pnpm test:e2e` and local
// `pnpm dev` have something to log in with. Never reuse them, never seed
// this script against a database that also holds real user data, and
// never let a deploy run this script against production (see
// docs/SECURITY.md and docs/AUTHENTICATION.md#seed-data).
const SEED_PASSWORD = "provence360-seed-only-not-a-real-password";

// Mirrors packages/auth/src/password.ts's ARGON2_OPTIONS. Duplicated
// rather than imported: packages/auth depends on packages/database, so
// the reverse import would be circular. Keep the two in sync by hand.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

loadDotEnv();

async function main(): Promise<void> {
  const db = getAdminDb();
  const seedPasswordHash = await argon2Hash(SEED_PASSWORD, ARGON2_OPTIONS);

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
  // - alice: sole OWNER of Alpha (Provence Sud)
  // - bob: plain MEMBER of Alpha
  // - carla: sole OWNER of Beta (Luberon Retreats)
  // - diego: MEMBER of Beta (permission-boundary tests: read-only)
  // - eve: the multi-tenant contractor — ADMIN of Alpha, MEMBER of Beta —
  //   proof identity is global while access is scoped per membership, and
  //   the tenant switcher's primary test fixture.
  const [alice, bob, carla, diego, eve] = await db
    .insert(users)
    .values([
      { email: "alice@provence-sud.test", name: "Alice Martin", passwordHash: seedPasswordHash },
      { email: "bob@provence-sud.test", name: "Bob Lefevre", passwordHash: seedPasswordHash },
      { email: "carla@luberon-retreats.test", name: "Carla Rossi", passwordHash: seedPasswordHash },
      {
        email: "diego@luberon-retreats.test",
        name: "Diego Fernandez",
        passwordHash: seedPasswordHash,
      },
      { email: "eve@contractor.test", name: "Eve Dubois", passwordHash: seedPasswordHash },
    ])
    .returning();
  if (!alice || !bob || !carla || !diego || !eve) throw new Error("Failed to seed users");

  console.log("Seeding memberships...");
  await db.insert(memberships).values([
    { tenantId: provenceSud.id, userId: alice.id, role: "owner" },
    { tenantId: provenceSud.id, userId: bob.id, role: "member" },
    { tenantId: provenceSud.id, userId: eve.id, role: "admin" },
    { tenantId: luberonRetreats.id, userId: carla.id, role: "owner" },
    { tenantId: luberonRetreats.id, userId: diego.id, role: "member" },
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
      action: "SITE_CREATED",
      targetType: "site",
      targetId: villasCassis.id,
      metadata: { slug: villasCassis.slug },
    },
    {
      tenantId: luberonRetreats.id,
      actorUserId: carla.id,
      action: "SITE_CREATED",
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
  console.log(
    `  login password for every seed user: "${SEED_PASSWORD}" (seed-only, see docs/AUTHENTICATION.md)`,
  );
  console.log("  alice@provence-sud.test      OWNER of Provence Sud");
  console.log("  bob@provence-sud.test        MEMBER of Provence Sud");
  console.log("  eve@contractor.test          ADMIN of Provence Sud, MEMBER of Luberon Retreats");
  console.log("  carla@luberon-retreats.test  OWNER of Luberon Retreats");
  console.log("  diego@luberon-retreats.test  MEMBER of Luberon Retreats");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeAdminPool();
  });
