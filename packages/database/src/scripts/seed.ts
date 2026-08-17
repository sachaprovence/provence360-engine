import { randomUUID } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { closeAdminPool, getAdminDb } from "../admin/index";
import { loadDotEnv } from "../load-env";
import {
  amenities,
  auditLogs,
  domains,
  mediaAssets,
  memberships,
  pages,
  properties,
  sites,
  tenants,
  themes,
  unitAmenities,
  units,
  users,
  virtualTours,
} from "../schema";

// Minimal, idempotent dev seed: two tenants ("Alpha" = Provence Sud, "Beta"
// = Luberon Retreats), a handful of users/memberships exercising every
// role/scope combination the Control Plane's authorization tests rely on,
// one site per tenant, multiple domains per site — and, as of v0.3, one
// shared Theme, a shared Amenity catalog, and a genuinely distinct Property
// / Unit / Page / content graph per site (see docs/SITE_DOMAIN.md and
// docs/CONTENT_MODEL.md). Both sites are rendered by the exact same
// `packages/renderer` code — nothing here is a per-client component, only
// data. Runs on the admin connection, which owns the tables and therefore
// bypasses RLS by design — this is a bootstrap script, not a request path.
//
// Block instance JSON below is hand-constructed to match each block's
// registered schema (packages/content/src/blocks/*.ts) rather than
// validated through `parseBlockInstance` at seed time — packages/database
// intentionally has no dependency on packages/content (that dependency
// runs the other way), so this file is the one place block shapes are
// duplicated by hand. Anything wrong here is caught the moment the
// renderer or admin UI reads it back (see packages/renderer's per-block
// error handling) — a malformed seed block degrades to a placeholder, it
// does not crash the app either way.
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

function blockId(): string {
  return `blk_${randomUUID()}`;
}

async function main(): Promise<void> {
  const db = getAdminDb();
  const seedPasswordHash = await argon2Hash(SEED_PASSWORD, ARGON2_OPTIONS);

  console.log("Clearing existing data...");
  await db.execute(
    sql`truncate table ${auditLogs}, ${unitAmenities}, ${virtualTours}, ${units}, ${properties}, ${pages}, ${mediaAssets}, ${domains}, ${sites}, ${memberships}, ${tenants}, ${users}, ${amenities}, ${themes} restart identity cascade`,
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

  console.log("Seeding the shared Theme...");
  // ONE base theme, reused by both sites (docs/adr/0011-theme-token-model.md
  // and docs/THEMES.md) — each site below narrows only `color.primary`,
  // proving Base Theme + Site Overrides = Resolved Theme without forking.
  const [provenceTheme] = await db
    .insert(themes)
    .values([
      {
        key: "provence",
        name: "Provence",
        status: "active",
        tokens: {
          "color.background": "#fdfaf5",
          "color.surface": "#f3ece0",
          "color.text": "#2b241b",
          "color.muted": "#7a6f5e",
          "color.primary": "#a9633f",
          "color.primaryContrast": "#ffffff",
          "color.accent": "#c98a4b",
          "font.heading": "Georgia, 'Playfair Display', serif",
          "font.body": "system-ui, sans-serif",
          "radius.small": "4px",
          "radius.medium": "10px",
          "radius.large": "24px",
          "spacing.small": "8px",
          "spacing.medium": "20px",
          "spacing.large": "48px",
          "shadow.small": "0 1px 2px rgba(0,0,0,0.08)",
          "shadow.medium": "0 6px 16px rgba(0,0,0,0.14)",
          "container.narrow": "640px",
          "container.wide": "1140px",
        },
      },
    ])
    .returning();
  if (!provenceTheme) throw new Error("Failed to seed theme");

  console.log("Seeding the shared Amenity catalog...");
  const [
    poolAmenity,
    wifiAmenity,
    gardenAmenity,
    bbqAmenity,
    parkingAmenity,
    mountainViewAmenity,
    fireplaceAmenity,
  ] = await db
    .insert(amenities)
    .values([
      {
        key: "pool",
        category: "wellness",
        label: "Piscine chauffée",
        iconKey: "pool",
        status: "active",
      },
      { key: "wifi", category: "connectivity", label: "Wi-Fi", iconKey: "wifi", status: "active" },
      { key: "garden", category: "outdoor", label: "Jardin", iconKey: "garden", status: "active" },
      { key: "bbq", category: "outdoor", label: "Barbecue", iconKey: "bbq", status: "active" },
      {
        key: "parking",
        category: "other",
        label: "Parking privé",
        iconKey: "parking",
        status: "active",
      },
      {
        key: "mountain_view",
        category: "outdoor",
        label: "Vue sur le Luberon",
        iconKey: "mountain_view",
        status: "active",
      },
      {
        key: "fireplace",
        category: "comfort",
        label: "Cheminée",
        iconKey: "fireplace",
        status: "active",
      },
    ])
    .returning();
  if (
    !poolAmenity ||
    !wifiAmenity ||
    !gardenAmenity ||
    !bbqAmenity ||
    !parkingAmenity ||
    !mountainViewAmenity ||
    !fireplaceAmenity
  ) {
    throw new Error("Failed to seed amenities");
  }

  console.log("Seeding sites...");
  const [villasCassis] = await db
    .insert(sites)
    .values([
      {
        tenantId: provenceSud.id,
        slug: "villas-cassis",
        name: "Villas Cassis",
        publicName: "Villa des Oliviers",
        status: "active",
        timezone: "Europe/Paris",
        defaultLocale: "fr",
        enabledLocales: ["fr", "en"],
        contactEmail: "contact@villa-des-oliviers.test",
        themeId: provenceTheme.id,
        themeOverrides: { "color.primary": "#6b7f3a" },
      },
    ])
    .returning();
  const [masDuLuberon] = await db
    .insert(sites)
    .values([
      {
        tenantId: luberonRetreats.id,
        slug: "mas-du-luberon",
        name: "Mas du Luberon",
        publicName: "Mas du Luberon",
        status: "active",
        timezone: "Europe/Paris",
        defaultLocale: "fr",
        enabledLocales: ["fr"],
        contactEmail: "contact@mas-du-luberon.test",
        themeId: provenceTheme.id,
        themeOverrides: { "color.primary": "#3a5f7f" },
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

  console.log("Seeding media assets...");
  const [villaHeroImage, villaGalleryImage1, villaGalleryImage2] = await db
    .insert(mediaAssets)
    .values([
      {
        tenantId: provenceSud.id,
        kind: "image",
        storageKey: "seed/villa-des-oliviers/hero.jpg",
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        altText: "Villa des Oliviers, piscine et façade provençale",
      },
      {
        tenantId: provenceSud.id,
        kind: "image",
        storageKey: "seed/villa-des-oliviers/pool.jpg",
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        altText: "Piscine chauffée de la Villa des Oliviers",
      },
      {
        tenantId: provenceSud.id,
        kind: "image",
        storageKey: "seed/villa-des-oliviers/garden.jpg",
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        altText: "Jardin ombragé de la Villa des Oliviers",
      },
    ])
    .returning();
  const [masHeroImage] = await db
    .insert(mediaAssets)
    .values([
      {
        tenantId: luberonRetreats.id,
        kind: "image",
        storageKey: "seed/mas-du-luberon/hero.jpg",
        mimeType: "image/jpeg",
        width: 1600,
        height: 900,
        altText: "Mas du Luberon, vue sur les collines",
      },
    ])
    .returning();
  if (!villaHeroImage || !villaGalleryImage1 || !villaGalleryImage2 || !masHeroImage) {
    throw new Error("Failed to seed media assets");
  }

  console.log("Seeding Properties...");
  // Villa des Oliviers: one Property owning TWO Units — the "a Property
  // may own multiple Units" case (docs/adr/0010-property-unit-ownership.md).
  const [villaDesOliviers] = await db
    .insert(properties)
    .values([
      {
        tenantId: provenceSud.id,
        siteId: villasCassis.id,
        internalName: "Villa des Oliviers — Cassis",
        publicName: "Villa des Oliviers",
        slug: "villa-des-oliviers",
        description:
          "Nichée au cœur de Cassis, la Villa des Oliviers offre une piscine chauffée, un grand jardin ombragé et un espace barbecue, à deux pas des calanques.",
        propertyType: "villa",
        addressLine1: "12 chemin des Oliviers",
        addressCity: "Cassis",
        addressPostalCode: "13260",
        addressRegion: "Provence-Alpes-Côte d'Azur",
        addressCountry: "FR",
        latitude: "43.2140",
        longitude: "5.5390",
        timezone: "Europe/Paris",
        status: "active",
      },
    ])
    .returning();
  // Mas du Luberon: one Property owning exactly ONE Unit — the "just one
  // logement" case, deliberately modeled the same way (Property -> Unit),
  // never collapsed into "the Property IS the bookable unit".
  const [masDuLuberonProperty] = await db
    .insert(properties)
    .values([
      {
        tenantId: luberonRetreats.id,
        siteId: masDuLuberon.id,
        internalName: "Mas du Luberon",
        publicName: "Mas du Luberon",
        slug: "mas-du-luberon",
        description:
          "Un mas provençal en pierre restauré avec soin, posé au calme au cœur des collines du Luberon, avec une vue imprenable et une cheminée d'époque.",
        propertyType: "gite",
        addressLine1: "Route des Collines",
        addressCity: "Bonnieux",
        addressPostalCode: "84480",
        addressRegion: "Provence-Alpes-Côte d'Azur",
        addressCountry: "FR",
        latitude: "43.8280",
        longitude: "5.3080",
        timezone: "Europe/Paris",
        status: "active",
      },
    ])
    .returning();
  if (!villaDesOliviers || !masDuLuberonProperty) throw new Error("Failed to seed properties");

  console.log("Seeding Units...");
  const [villaPrincipale, studioAnnexe] = await db
    .insert(units)
    .values([
      {
        tenantId: provenceSud.id,
        propertyId: villaDesOliviers.id,
        internalName: "Villa principale",
        publicName: "Villa principale",
        slug: "villa-principale",
        status: "active",
        maxGuests: 8,
        bedrooms: 4,
        beds: 6,
        bathrooms: "3",
        size: "220",
        sizeUnit: "sqm",
        description: "Le corps principal de la villa : 4 chambres, piscine privée et terrasse.",
        ordering: 0,
      },
      {
        tenantId: provenceSud.id,
        propertyId: villaDesOliviers.id,
        internalName: "Studio annexe",
        publicName: "Studio annexe",
        slug: "studio-annexe",
        status: "active",
        maxGuests: 2,
        bedrooms: 1,
        beds: 1,
        bathrooms: "1",
        size: "35",
        sizeUnit: "sqm",
        description: "Un studio indépendant avec kitchenette, idéal pour deux personnes.",
        ordering: 1,
      },
    ])
    .returning();
  const [masUnit] = await db
    .insert(units)
    .values([
      {
        tenantId: luberonRetreats.id,
        propertyId: masDuLuberonProperty.id,
        internalName: "Mas du Luberon",
        publicName: "Mas du Luberon",
        slug: "mas",
        status: "active",
        maxGuests: 4,
        bedrooms: 2,
        beds: 2,
        bathrooms: "1",
        size: "90",
        sizeUnit: "sqm",
        description: "Le mas dans son intégralité : deux chambres, séjour avec cheminée en pierre.",
        ordering: 0,
      },
    ])
    .returning();
  if (!villaPrincipale || !studioAnnexe || !masUnit) throw new Error("Failed to seed units");

  console.log("Attaching amenities to Units...");
  await db.insert(unitAmenities).values([
    { tenantId: provenceSud.id, unitId: villaPrincipale.id, amenityId: poolAmenity.id },
    { tenantId: provenceSud.id, unitId: villaPrincipale.id, amenityId: gardenAmenity.id },
    { tenantId: provenceSud.id, unitId: villaPrincipale.id, amenityId: bbqAmenity.id },
    { tenantId: provenceSud.id, unitId: villaPrincipale.id, amenityId: wifiAmenity.id },
    { tenantId: provenceSud.id, unitId: villaPrincipale.id, amenityId: parkingAmenity.id },
    { tenantId: provenceSud.id, unitId: studioAnnexe.id, amenityId: wifiAmenity.id },
    { tenantId: provenceSud.id, unitId: studioAnnexe.id, amenityId: parkingAmenity.id },
    { tenantId: luberonRetreats.id, unitId: masUnit.id, amenityId: mountainViewAmenity.id },
    { tenantId: luberonRetreats.id, unitId: masUnit.id, amenityId: fireplaceAmenity.id },
    { tenantId: luberonRetreats.id, unitId: masUnit.id, amenityId: wifiAmenity.id },
  ]);

  console.log("Seeding a demo VirtualTour (v0.7)...");
  // One Property-level Matterport tour on Villa des Oliviers, wired into
  // its home Page below via a `virtual-tour@1` block — the demo case for
  // section 39 of the v0.7 brief. `providerAssetId` is a syntactically
  // valid-shaped (11-character alphanumeric) demo Model SID, not a real,
  // publicly browsable Matterport space — see
  // packages/virtual-tours/src/providers/matterport.ts for the exact
  // format this must match.
  const [villaVirtualTour] = await db
    .insert(virtualTours)
    .values([
      {
        tenantId: provenceSud.id,
        propertyId: villaDesOliviers.id,
        provider: "matterport",
        providerAssetId: "SxQL3iGyeYo",
        internalName: "Visite virtuelle — Villa des Oliviers",
        publicName: "Visite virtuelle 360°",
        status: "active",
        ordering: 0,
      },
    ])
    .returning();
  if (!villaVirtualTour) throw new Error("Failed to seed virtual tour");

  console.log("Seeding home Pages (Content Graph)...");
  // Two deliberately different block compositions and orders, rendered by
  // the exact same `packages/renderer` code and block registry — no
  // per-client component anywhere (section 8 of docs/RENDERING.md).
  const [villasCassisHomePage, masDuLuberonHomePage] = await db
    .insert(pages)
    .values([
      {
        tenantId: provenceSud.id,
        siteId: villasCassis.id,
        slug: "",
        internalName: "Accueil — Villa des Oliviers",
        status: "active",
        pageType: "home",
        seo: {
          title: {
            fr: "Villa des Oliviers — Location à Cassis",
            en: "Villa des Oliviers — Cassis rental",
          },
          description: {
            fr: "Villa avec piscine chauffée à louer à Cassis, en Provence.",
            en: "Villa with a heated pool to rent in Cassis, Provence.",
          },
          canonicalPath: "/",
          noIndex: false,
          noFollow: false,
        },
        content: [
          {
            id: blockId(),
            type: "hero",
            version: 1,
            props: {
              headline: {
                fr: "Villa des Oliviers — Cassis, Provence",
                en: "Villa des Oliviers — Cassis, Provence",
              },
              subheadline: {
                fr: "Piscine chauffée, jardin ombragé et vue sur les calanques.",
                en: "Heated pool, shaded garden, and views over the calanques.",
              },
              backgroundMediaId: villaHeroImage.id,
              ctaLabel: { fr: "Réserver", en: "Book now" },
              ctaHref: "/contact",
            },
          },
          {
            id: blockId(),
            type: "text",
            version: 1,
            props: {
              heading: { fr: "Bienvenue", en: "Welcome" },
              body: {
                fr: "Nichée au cœur de Cassis, la Villa des Oliviers vous accueille dans un cadre provençal authentique.\nÀ deux pas des calanques et du port, elle allie calme et proximité des commerces.",
                en: "Tucked in the heart of Cassis, Villa des Oliviers welcomes you in an authentic Provençal setting.\nMinutes from the calanques and the harbor, it combines quiet with easy access to shops.",
              },
            },
          },
          {
            id: blockId(),
            type: "gallery",
            version: 1,
            props: {
              mediaAssetIds: [villaHeroImage.id, villaGalleryImage1.id, villaGalleryImage2.id],
              caption: { fr: "La villa et ses extérieurs", en: "The villa and its grounds" },
            },
          },
          {
            id: blockId(),
            type: "feature-list",
            version: 1,
            props: {
              heading: { fr: "Équipements phares", en: "Highlights" },
              items: [
                { iconKey: "pool", title: { fr: "Piscine chauffée", en: "Heated pool" } },
                { iconKey: "garden", title: { fr: "Jardin ombragé", en: "Shaded garden" } },
                { iconKey: "bbq", title: { fr: "Espace barbecue", en: "BBQ area" } },
              ],
            },
          },
          {
            id: blockId(),
            type: "property-summary",
            version: 1,
            props: { propertyId: villaDesOliviers.id, showDescription: true, showAddress: true },
          },
          {
            id: blockId(),
            type: "unit-grid",
            version: 1,
            props: { propertyId: villaDesOliviers.id, columns: 2 },
          },
          {
            id: blockId(),
            type: "virtual-tour",
            version: 1,
            props: { tourId: villaVirtualTour.id, showTitle: true, aspectRatio: "16:9" },
          },
          {
            id: blockId(),
            type: "amenities",
            version: 1,
            props: { unitId: villaPrincipale.id, heading: { fr: "Tout confort", en: "Comforts" } },
          },
          {
            id: blockId(),
            type: "cta",
            version: 1,
            props: {
              heading: {
                fr: "Prêt pour vos vacances en Provence ?",
                en: "Ready for your Provence getaway?",
              },
              buttonLabel: { fr: "Contactez-nous", en: "Contact us" },
              buttonHref: "/contact",
            },
          },
        ],
      },
      {
        tenantId: luberonRetreats.id,
        siteId: masDuLuberon.id,
        slug: "",
        internalName: "Accueil — Mas du Luberon",
        status: "active",
        pageType: "home",
        seo: {
          title: { fr: "Mas du Luberon — Location à Bonnieux" },
          description: { fr: "Mas provençal en pierre à louer au cœur du Luberon." },
          canonicalPath: "/",
          noIndex: false,
          noFollow: false,
        },
        // Deliberately a different order than Villas Cassis (FeatureList
        // before the PropertySummary, no Gallery/Amenities block at all) —
        // configurable per Page, not hard-coded in the renderer.
        content: [
          {
            id: blockId(),
            type: "hero",
            version: 1,
            props: {
              headline: { fr: "Mas du Luberon — refuge au cœur des collines" },
              subheadline: { fr: "Vue imprenable sur le Luberon, calme absolu." },
              backgroundMediaId: masHeroImage.id,
              ctaLabel: { fr: "Réserver" },
              ctaHref: "/contact",
            },
          },
          {
            id: blockId(),
            type: "feature-list",
            version: 1,
            props: {
              heading: { fr: "Pourquoi ce mas" },
              items: [
                { iconKey: "mountain_view", title: { fr: "Vue sur le Luberon" } },
                { iconKey: "fireplace", title: { fr: "Cheminée en pierre" } },
              ],
            },
          },
          {
            id: blockId(),
            type: "property-summary",
            version: 1,
            props: {
              propertyId: masDuLuberonProperty.id,
              showDescription: true,
              showAddress: true,
            },
          },
          {
            id: blockId(),
            type: "text",
            version: 1,
            props: {
              heading: { fr: "Le mas" },
              body: {
                fr: "Un mas provençal restauré avec soin, posé au calme au cœur des collines du Luberon.\nIdéal pour un séjour au vert, loin de l'agitation.",
              },
            },
          },
          {
            id: blockId(),
            type: "unit-grid",
            version: 1,
            props: { propertyId: masDuLuberonProperty.id, columns: 1 },
          },
          {
            id: blockId(),
            type: "cta",
            version: 1,
            props: {
              buttonLabel: { fr: "Nous contacter" },
              buttonHref: "/contact",
            },
          },
        ],
      },
    ])
    .returning();
  if (!villasCassisHomePage || !masDuLuberonHomePage) throw new Error("Failed to seed home pages");

  console.log("Seeding a Contact page + Draft navigation for Villas Cassis...");
  // v0.5: demonstrates the typed Site Composition navigation contract
  // end-to-end — internal links reference a Page by its stable `id`
  // (`packages/content/src/navigation.ts`'s `NavigationItem`), resolved to
  // a real route only at publish time (`packages/publishing`'s
  // `resolveNavigation`). Mas du Luberon deliberately keeps the column's
  // pre-v0.5 default (`[]`, no navigation configured) — exercising the
  // "empty navigation renders nothing" path alongside this one.
  const [villasCassisContactPage] = await db
    .insert(pages)
    .values([
      {
        tenantId: provenceSud.id,
        siteId: villasCassis.id,
        slug: "contact",
        internalName: "Contact — Villa des Oliviers",
        status: "active",
        pageType: "contact",
        seo: {
          title: { fr: "Contact — Villa des Oliviers", en: "Contact — Villa des Oliviers" },
          canonicalPath: "/contact",
        },
        content: [
          {
            id: blockId(),
            type: "text",
            version: 1,
            props: {
              heading: { fr: "Nous contacter", en: "Contact us" },
              body: {
                fr: "Pour toute question ou demande de réservation, écrivez-nous à contact@villa-des-oliviers.test.",
                en: "For any question or booking request, email us at contact@villa-des-oliviers.test.",
              },
            },
          },
        ],
      },
    ])
    .returning();
  if (!villasCassisContactPage) throw new Error("Failed to seed the Contact page");

  await db
    .update(sites)
    .set({
      navigation: {
        version: 1,
        items: [
          {
            id: "nav_home",
            label: { fr: "Accueil", en: "Home" },
            target: { kind: "page", pageId: villasCassisHomePage.id },
            children: [],
          },
          {
            id: "nav_contact",
            label: { fr: "Contact", en: "Contact" },
            target: { kind: "page", pageId: villasCassisContactPage.id },
            children: [],
          },
        ],
      },
    })
    .where(eq(sites.id, villasCassis.id));

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
    `  properties: villa-des-oliviers (${villaDesOliviers.id}), mas-du-luberon (${masDuLuberonProperty.id})`,
  );
  console.log(`  virtual tours: villa-des-oliviers demo tour (${villaVirtualTour.id})`);
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
