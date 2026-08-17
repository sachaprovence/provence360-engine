import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  amenities,
  domains,
  mediaAssets,
  memberships,
  pages,
  properties,
  propertyAmenities,
  siteRevisions,
  sitePublications,
  sites,
  tenants,
  themes,
  unitAmenities,
  units,
  unitSleepingArrangements,
  users,
  virtualTours,
  type AmenityCategory,
  type BedType,
  type LocationDisclosure,
  type MediaKind,
  type MembershipRole,
  type PageStatus,
  type PageType,
  type PropertyStatus,
  type PropertyType,
  type PublicationAction,
  type RentalPolicy,
  type SiteStatus,
  type TenantStatus,
  type ThemeStatus,
  type UnitSizeUnit,
  type UnitStatus,
  type VirtualTourProvider,
  type VirtualTourStatus,
} from "@provence360/database";
import { getAdminDb } from "@provence360/database/admin";

// Fixture factories for tests. All writes go through the admin (RLS-
// bypassing) connection, on purpose: arranging test data is not a
// tenant-scoped operation, and forcing fixtures through withTenantContext()
// would make it impossible to construct the very cross-tenant scenarios the
// isolation tests need to set up.

function shortId(): string {
  return randomUUID().slice(0, 8);
}

export async function createTenant(
  overrides: {
    slug?: string;
    name?: string;
    status?: TenantStatus;
  } = {},
) {
  const db = getAdminDb();
  const [row] = await db
    .insert(tenants)
    .values({
      slug: overrides.slug ?? `tenant-${shortId()}`,
      name: overrides.name ?? "Test Tenant",
      status: overrides.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test tenant");
  return row;
}

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(users)
    .values({
      email: overrides.email ?? `user-${shortId()}@example.test`,
      name: overrides.name ?? "Test User",
    })
    .returning();
  if (!row) throw new Error("Failed to create test user");
  return row;
}

export async function createMembership(input: {
  tenantId: string;
  userId: string;
  role?: MembershipRole;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(memberships)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role ?? "member",
    })
    .returning();
  if (!row) throw new Error("Failed to create test membership");
  return row;
}

export async function createSite(input: {
  tenantId: string;
  slug?: string;
  name?: string;
  status?: SiteStatus;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(sites)
    .values({
      tenantId: input.tenantId,
      slug: input.slug ?? `site-${shortId()}`,
      name: input.name ?? "Test Site",
      status: input.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test site");
  return row;
}

export async function createDomain(input: {
  tenantId: string;
  siteId: string;
  hostname?: string;
  isPrimary?: boolean;
  status?: "pending" | "active" | "disabled";
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(domains)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      hostname: input.hostname ?? `${shortId()}.test.example`,
      isPrimary: input.isPrimary ?? false,
      status: input.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test domain");
  return row;
}

export async function createProperty(input: {
  tenantId: string;
  siteId: string;
  internalName?: string;
  publicName?: string;
  slug?: string;
  propertyType?: PropertyType;
  status?: PropertyStatus;
  addressLine1?: string;
  addressCity?: string;
  addressCountry?: string;
  latitude?: number;
  longitude?: number;
  checkInTime?: string;
  checkOutTime?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  smokingPolicy?: RentalPolicy;
  petsPolicy?: RentalPolicy;
  eventsPolicy?: RentalPolicy;
  locationDisclosure?: LocationDisclosure;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(properties)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      internalName: input.internalName ?? "Test Property",
      publicName: input.publicName ?? "Test Property",
      slug: input.slug ?? `property-${shortId()}`,
      propertyType: input.propertyType ?? "villa",
      status: input.status ?? "active",
      addressLine1: input.addressLine1,
      addressCity: input.addressCity,
      addressCountry: input.addressCountry,
      ...(input.latitude !== undefined ? { latitude: String(input.latitude) } : {}),
      ...(input.longitude !== undefined ? { longitude: String(input.longitude) } : {}),
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      smokingPolicy: input.smokingPolicy,
      petsPolicy: input.petsPolicy,
      eventsPolicy: input.eventsPolicy,
      ...(input.locationDisclosure !== undefined
        ? { locationDisclosure: input.locationDisclosure }
        : {}),
    })
    .returning();
  if (!row) throw new Error("Failed to create test property");
  return row;
}

export async function createUnit(input: {
  tenantId: string;
  propertyId: string;
  internalName?: string;
  publicName?: string;
  slug?: string;
  status?: UnitStatus;
  maxGuests?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  size?: number;
  sizeUnit?: UnitSizeUnit;
  ordering?: number;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(units)
    .values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      internalName: input.internalName ?? "Test Unit",
      publicName: input.publicName ?? "Test Unit",
      slug: input.slug ?? `unit-${shortId()}`,
      status: input.status ?? "active",
      maxGuests: input.maxGuests,
      bedrooms: input.bedrooms,
      beds: input.beds,
      ...(input.bathrooms !== undefined ? { bathrooms: String(input.bathrooms) } : {}),
      ...(input.size !== undefined ? { size: String(input.size) } : {}),
      sizeUnit: input.sizeUnit,
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create test unit");
  return row;
}

export async function createAmenity(input: {
  key?: string;
  category?: AmenityCategory;
  label?: string;
}) {
  const db = getAdminDb();
  const key = input.key ?? `amenity-${shortId()}`;
  const [row] = await db
    .insert(amenities)
    .values({
      key,
      category: input.category ?? "comfort",
      label: input.label ?? key,
    })
    .returning();
  if (!row) throw new Error("Failed to create test amenity");
  return row;
}

export async function attachUnitAmenity(input: {
  tenantId: string;
  unitId: string;
  amenityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(unitAmenities)
    .values({
      tenantId: input.tenantId,
      unitId: input.unitId,
      amenityId: input.amenityId,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!row) throw new Error("Failed to attach test unit amenity");
  return row;
}

export async function attachPropertyAmenity(input: {
  tenantId: string;
  propertyId: string;
  amenityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(propertyAmenities)
    .values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      amenityId: input.amenityId,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!row) throw new Error("Failed to attach test property amenity");
  return row;
}

export async function createSleepingArrangement(input: {
  tenantId: string;
  unitId: string;
  roomLabel?: string;
  bedType?: BedType;
  quantity?: number;
  ordering?: number;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(unitSleepingArrangements)
    .values({
      tenantId: input.tenantId,
      unitId: input.unitId,
      roomLabel: input.roomLabel,
      bedType: input.bedType ?? "double",
      quantity: input.quantity ?? 1,
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create test sleeping arrangement");
  return row;
}

/**
 * Inserts a `virtual_tours` row directly via the admin connection, bypassing
 * `@provence360/virtual-tours`' own `createVirtualTour` (which normalizes
 * `rawProviderInput` through the provider registry and enforces ownership
 * checks under `withTenantContext()`). Use this — same as every other
 * factory here — to arrange fixtures for tests that exercise some *other*
 * package (a `virtual-tour@1` block reference, a publish-validation check,
 * a renderer, an RLS isolation test); use the real package function instead
 * when the test is actually about normalization/ownership/optimistic
 * concurrency.
 */
export async function createVirtualTour(input: {
  tenantId: string;
  propertyId: string;
  unitId?: string;
  provider?: VirtualTourProvider;
  providerAssetId?: string;
  internalName?: string;
  publicName?: string;
  status?: VirtualTourStatus;
  ordering?: number;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(virtualTours)
    .values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      provider: input.provider ?? "matterport",
      // `shortId()` is 8 hex chars; prefixed to 11 total — a valid-shaped
      // Matterport Model SID by construction, so fixtures pass
      // `validateExternalId` by default without every test needing to know
      // that format itself.
      providerAssetId: input.providerAssetId ?? `sid${shortId()}`,
      internalName: input.internalName ?? "Test Virtual Tour",
      publicName: input.publicName ?? "Test Virtual Tour",
      status: input.status ?? "draft",
      ordering: input.ordering ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create test virtual tour");
  return row;
}

export async function createMediaAsset(input: {
  tenantId: string;
  kind?: MediaKind;
  storageKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  altText?: string;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(mediaAssets)
    .values({
      tenantId: input.tenantId,
      kind: input.kind ?? "image",
      storageKey: input.storageKey ?? `test/${shortId()}.jpg`,
      mimeType: input.mimeType ?? "image/jpeg",
      width: input.width,
      height: input.height,
      altText: input.altText,
    })
    .returning();
  if (!row) throw new Error("Failed to create test media asset");
  return row;
}

export async function createTheme(input: {
  key?: string;
  name?: string;
  tokens?: Record<string, unknown>;
  status?: ThemeStatus;
}) {
  const db = getAdminDb();
  const key = input.key ?? `theme-${shortId()}`;
  const [row] = await db
    .insert(themes)
    .values({
      key,
      name: input.name ?? key,
      tokens: input.tokens ?? {
        "color.background": "#ffffff",
        "color.surface": "#f5f5f5",
        "color.text": "#111111",
        "color.muted": "#666666",
        "color.primary": "#2f6f4f",
        "color.primaryContrast": "#ffffff",
        "color.accent": "#c98a3e",
        "font.heading": "system-ui, sans-serif",
        "font.body": "system-ui, sans-serif",
        "radius.small": "4px",
        "radius.medium": "8px",
        "radius.large": "16px",
      },
      status: input.status ?? "active",
    })
    .returning();
  if (!row) throw new Error("Failed to create test theme");
  return row;
}

export async function createSiteRevision(input: {
  tenantId: string;
  siteId: string;
  revisionNumber?: number;
  snapshot?: Record<string, unknown>;
  createdByUserId?: string;
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(siteRevisions)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      revisionNumber: input.revisionNumber ?? 1,
      snapshot: input.snapshot ?? { site: {}, theme: { themeId: null, tokens: {} }, pages: [] },
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create test site revision");
  return row;
}

/** Publishes `revisionId` for `siteId` directly (admin connection) — sets the pointer AND records history, bypassing packages/publishing's own transactional logic. Only for arranging fixtures (e.g. cross-tenant RLS tests); never use this to test publish/rollback behavior itself. */
export async function publishRevisionForTest(input: {
  tenantId: string;
  siteId: string;
  revisionId: string;
  action?: PublicationAction;
  publishedByUserId?: string;
}) {
  const db = getAdminDb();
  await db
    .update(sites)
    .set({ publishedRevisionId: input.revisionId })
    .where(eq(sites.id, input.siteId));
  const [row] = await db
    .insert(sitePublications)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      revisionId: input.revisionId,
      action: input.action ?? "publish",
      publishedByUserId: input.publishedByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create test site publication");
  return row;
}

export async function createPage(input: {
  tenantId: string;
  siteId: string;
  slug?: string;
  internalName?: string;
  status?: PageStatus;
  pageType?: PageType;
  seo?: Record<string, unknown>;
  content?: unknown[];
}) {
  const db = getAdminDb();
  const [row] = await db
    .insert(pages)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      slug: input.slug ?? (input.pageType === "home" ? "" : `page-${shortId()}`),
      internalName: input.internalName ?? "Test Page",
      status: input.status ?? "active",
      pageType: input.pageType ?? "standard",
      seo: input.seo ?? {},
      content: input.content ?? [],
    })
    .returning();
  if (!row) throw new Error("Failed to create test page");
  return row;
}
