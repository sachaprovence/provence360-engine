import { randomUUID } from "node:crypto";
import {
  amenities,
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
  type AmenityCategory,
  type MediaKind,
  type MembershipRole,
  type PageStatus,
  type PageType,
  type PropertyStatus,
  type PropertyType,
  type SiteStatus,
  type TenantStatus,
  type ThemeStatus,
  type UnitSizeUnit,
  type UnitStatus,
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
