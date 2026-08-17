"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createProperty,
  createSleepingArrangement,
  createUnit,
  deleteProperty,
  deleteSleepingArrangement,
  deleteUnit,
  setPropertyAmenities,
  setUnitAmenities,
  updateProperty,
  updateUnit,
} from "@provence360/rentals";
import { toSlug } from "@provence360/validation";
import { withTenantPage } from "@/lib/actor";

export interface FormActionState {
  error?: string;
}

function propertiesBasePath(tenantId: string, siteId: string): string {
  return `/admin/tenants/${tenantId}/sites/${siteId}/properties`;
}

/** See the doc comment at its one call site in `updatePropertyAction`. */
function omitUndefinedKeys<T extends object>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

const propertyTypeSchema = z.enum([
  "villa",
  "house",
  "gite",
  "domaine",
  "guest_house",
  "apartment",
  "other",
]);

// v0.6 — see packages/rentals/src/validation.ts's `timeOfDaySchema`/
// `rentalPolicySchema`/`locationDisclosureSchema` (this form's own copy,
// same shape, since apps/admin builds its own narrow per-form Zod schemas
// rather than importing packages/rentals' broader input schemas — same
// pre-existing convention as `propertyTypeSchema` above).
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected "HH:MM"');
const rentalPolicySchema = z.enum(["allowed", "not_allowed", "on_request"]);
const locationDisclosureSchema = z.enum(["exact", "approximate", "hidden"]);

const createPropertySchema = z.object({
  publicName: z.string().trim().min(1).max(200),
  propertyType: propertyTypeSchema,
  addressCity: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
});

export async function createPropertyAction(
  tenantId: string,
  siteId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = createPropertySchema.safeParse({
    publicName: formData.get("publicName"),
    propertyType: formData.get("propertyType"),
    addressCity: formData.get("addressCity")?.toString() || undefined,
    description: formData.get("description")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let slug: string;
  try {
    slug = toSlug(parsed.data.publicName);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid slug." };
  }

  try {
    await withTenantPage(tenantId, "property.create", (tx, actor) =>
      createProperty(tx, {
        siteId,
        internalName: parsed.data.publicName,
        publicName: parsed.data.publicName,
        slug,
        propertyType: parsed.data.propertyType,
        ...(parsed.data.addressCity ? { addressCity: parsed.data.addressCity } : {}),
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { error: "A property with that slug already exists on this site." };
    }
    if (error instanceof Error && error.name === "SiteNotFoundError")
      return { error: "Site not found." };
    throw error;
  }

  revalidatePath(propertiesBasePath(tenantId, siteId));
  return {};
}

const updatePropertySchema = z.object({
  internalName: z.string().trim().min(1).max(200).optional(),
  publicName: z.string().trim().min(1).max(200).optional(),
  propertyType: propertyTypeSchema.optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  addressCity: z.string().trim().max(200).optional(),
  addressPostalCode: z.string().trim().max(20).optional(),
  addressRegion: z.string().trim().max(120).optional(),
  addressCountry: z.string().trim().max(2).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  timezone: z.string().trim().max(64).optional(),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  checkInTime: timeOfDaySchema.optional(),
  checkOutTime: timeOfDaySchema.optional(),
  quietHoursStart: timeOfDaySchema.optional(),
  quietHoursEnd: timeOfDaySchema.optional(),
  smokingPolicy: rentalPolicySchema.optional(),
  petsPolicy: rentalPolicySchema.optional(),
  eventsPolicy: rentalPolicySchema.optional(),
  locationDisclosure: locationDisclosureSchema.optional(),
});

export async function updatePropertyAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const field = (name: string) => formData.get(name)?.toString() || undefined;
  const parsed = updatePropertySchema.safeParse({
    internalName: field("internalName"),
    publicName: field("publicName"),
    propertyType: field("propertyType"),
    addressLine1: field("addressLine1"),
    addressLine2: field("addressLine2"),
    addressCity: field("addressCity"),
    addressPostalCode: field("addressPostalCode"),
    addressRegion: field("addressRegion"),
    addressCountry: field("addressCountry"),
    latitude: field("latitude"),
    longitude: field("longitude"),
    timezone: field("timezone"),
    description: field("description"),
    status: field("status"),
    checkInTime: field("checkInTime"),
    checkOutTime: field("checkOutTime"),
    quietHoursStart: field("quietHoursStart"),
    quietHoursEnd: field("quietHoursEnd"),
    smokingPolicy: field("smokingPolicy"),
    petsPolicy: field("petsPolicy"),
    eventsPolicy: field("eventsPolicy"),
    locationDisclosure: field("locationDisclosure"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTenantPage(tenantId, "property.update", (tx, actor) =>
      updateProperty(tx, {
        id: propertyId,
        // Zod's parsed output keeps every optional key present, set to
        // `undefined`, when the form omitted it — `omitUndefinedKeys`
        // strips those back out so `updateProperty`'s own `...rest` spread
        // never passes an explicit `undefined` into Drizzle's `.set()`
        // (which would otherwise write SQL NULL to an untouched column).
        ...omitUndefinedKeys(parsed.data),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "PropertyNotFoundError")
      return { error: "Property not found." };
    throw error;
  }

  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}`);
  return {};
}

export async function setPropertyAmenitiesAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  amenityIds: readonly string[],
): Promise<void> {
  await withTenantPage(tenantId, "property.update", (tx) =>
    setPropertyAmenities(tx, propertyId, amenityIds),
  );
  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}`);
}

export async function deletePropertyAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
): Promise<void> {
  await withTenantPage(tenantId, "property.delete", (tx, actor) =>
    deleteProperty(tx, propertyId, actor.userId),
  );
  revalidatePath(propertiesBasePath(tenantId, siteId));
}

const createUnitSchema = z.object({
  publicName: z.string().trim().min(1).max(200),
  maxGuests: z.coerce.number().int().min(1).max(100).optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
  ordering: z.coerce.number().int().min(0).max(9999).optional(),
});

export async function createUnitAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = createUnitSchema.safeParse({
    publicName: formData.get("publicName"),
    maxGuests: formData.get("maxGuests")?.toString() || undefined,
    bedrooms: formData.get("bedrooms")?.toString() || undefined,
    ordering: formData.get("ordering")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let slug: string;
  try {
    slug = toSlug(parsed.data.publicName);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid slug." };
  }

  try {
    await withTenantPage(tenantId, "unit.create", (tx, actor) =>
      createUnit(tx, {
        propertyId,
        internalName: parsed.data.publicName,
        publicName: parsed.data.publicName,
        slug,
        ...(parsed.data.maxGuests !== undefined ? { maxGuests: parsed.data.maxGuests } : {}),
        ...(parsed.data.bedrooms !== undefined ? { bedrooms: parsed.data.bedrooms } : {}),
        ...(parsed.data.ordering !== undefined ? { ordering: parsed.data.ordering } : {}),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { error: "A unit with that slug already exists on this property." };
    }
    if (error instanceof Error && error.name === "PropertyNotFoundError")
      return { error: "Property not found." };
    throw error;
  }

  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}`);
  return {};
}

const updateUnitSchema = z
  .object({
    internalName: z.string().trim().min(1).max(200).optional(),
    publicName: z.string().trim().min(1).max(200).optional(),
    maxGuests: z.coerce.number().int().min(1).max(100).optional(),
    bedrooms: z.coerce.number().int().min(0).max(50).optional(),
    beds: z.coerce.number().int().min(0).max(100).optional(),
    bathrooms: z.coerce.number().min(0).max(100).multipleOf(0.5).optional(),
    size: z.coerce.number().positive().max(100_000).optional(),
    sizeUnit: z.enum(["sqm", "sqft"]).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(["draft", "active", "archived", "not_bookable_separately"]).optional(),
  })
  // Mirrors the database's own `units_size_requires_unit_ck` — a clean
  // form error instead of a raw constraint-violation.
  .refine((v) => (v.size === undefined) === (v.sizeUnit === undefined), {
    message: "size and sizeUnit must both be set, or both left blank",
    path: ["sizeUnit"],
  });

export async function updateUnitAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const field = (name: string) => formData.get(name)?.toString() || undefined;
  const parsed = updateUnitSchema.safeParse({
    internalName: field("internalName"),
    publicName: field("publicName"),
    maxGuests: field("maxGuests"),
    bedrooms: field("bedrooms"),
    beds: field("beds"),
    bathrooms: field("bathrooms"),
    size: field("size"),
    sizeUnit: field("sizeUnit"),
    description: field("description"),
    status: field("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTenantPage(tenantId, "unit.update", (tx, actor) =>
      updateUnit(tx, {
        id: unitId,
        ...omitUndefinedKeys(parsed.data),
        actorUserId: actor.userId,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "UnitNotFoundError")
      return { error: "Unit not found." };
    throw error;
  }

  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}/units/${unitId}`);
  return {};
}

export async function deleteUnitAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
): Promise<void> {
  await withTenantPage(tenantId, "unit.delete", (tx, actor) =>
    deleteUnit(tx, unitId, actor.userId),
  );
  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}`);
}

export async function setUnitAmenitiesAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
  amenityIds: readonly string[],
): Promise<void> {
  await withTenantPage(tenantId, "unit.update", (tx) => setUnitAmenities(tx, unitId, amenityIds));
  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}/units/${unitId}`);
}

const bedTypeSchema = z.enum([
  "single",
  "double",
  "queen",
  "king",
  "bunk",
  "sofa_bed",
  "floor_mattress",
  "crib",
  "other",
]);

const createSleepingArrangementSchema = z.object({
  roomLabel: z.string().trim().min(1).max(120).optional(),
  bedType: bedTypeSchema,
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  ordering: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function createSleepingArrangementAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = createSleepingArrangementSchema.safeParse({
    roomLabel: formData.get("roomLabel")?.toString() || undefined,
    bedType: formData.get("bedType")?.toString() || undefined,
    quantity: formData.get("quantity")?.toString() || undefined,
    ordering: formData.get("ordering")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await withTenantPage(tenantId, "unit.update", (tx) =>
    createSleepingArrangement(tx, {
      unitId,
      bedType: parsed.data.bedType,
      quantity: parsed.data.quantity,
      ordering: parsed.data.ordering,
      ...(parsed.data.roomLabel !== undefined ? { roomLabel: parsed.data.roomLabel } : {}),
    }),
  );
  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}/units/${unitId}`);
  return {};
}

export async function deleteSleepingArrangementAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
  sleepingArrangementId: string,
): Promise<void> {
  await withTenantPage(tenantId, "unit.update", (tx) =>
    deleteSleepingArrangement(tx, sleepingArrangementId),
  );
  revalidatePath(`${propertiesBasePath(tenantId, siteId)}/${propertyId}/units/${unitId}`);
}
