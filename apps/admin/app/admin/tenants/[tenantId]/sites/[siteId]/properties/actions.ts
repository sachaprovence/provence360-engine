"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createProperty,
  createUnit,
  deleteProperty,
  deleteUnit,
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

const propertyTypeSchema = z.enum([
  "villa",
  "house",
  "gite",
  "domaine",
  "guest_house",
  "apartment",
  "other",
]);

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
  publicName: z.string().trim().min(1).max(200).optional(),
  propertyType: propertyTypeSchema.optional(),
  addressCity: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export async function updatePropertyAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = updatePropertySchema.safeParse({
    publicName: formData.get("publicName")?.toString() || undefined,
    propertyType: formData.get("propertyType")?.toString() || undefined,
    addressCity: formData.get("addressCity")?.toString() || undefined,
    description: formData.get("description")?.toString() || undefined,
    status: formData.get("status")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTenantPage(tenantId, "property.update", (tx, actor) =>
      updateProperty(tx, {
        id: propertyId,
        ...(parsed.data.publicName !== undefined ? { publicName: parsed.data.publicName } : {}),
        ...(parsed.data.propertyType !== undefined
          ? { propertyType: parsed.data.propertyType }
          : {}),
        ...(parsed.data.addressCity !== undefined ? { addressCity: parsed.data.addressCity } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
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

const updateUnitSchema = z.object({
  publicName: z.string().trim().min(1).max(200).optional(),
  maxGuests: z.coerce.number().int().min(1).max(100).optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
  status: z.enum(["draft", "active", "archived", "not_bookable_separately"]).optional(),
});

export async function updateUnitAction(
  tenantId: string,
  siteId: string,
  propertyId: string,
  unitId: string,
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = updateUnitSchema.safeParse({
    publicName: formData.get("publicName")?.toString() || undefined,
    maxGuests: formData.get("maxGuests")?.toString() || undefined,
    bedrooms: formData.get("bedrooms")?.toString() || undefined,
    status: formData.get("status")?.toString() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTenantPage(tenantId, "unit.update", (tx, actor) =>
      updateUnit(tx, {
        id: unitId,
        ...(parsed.data.publicName !== undefined ? { publicName: parsed.data.publicName } : {}),
        ...(parsed.data.maxGuests !== undefined ? { maxGuests: parsed.data.maxGuests } : {}),
        ...(parsed.data.bedrooms !== undefined ? { bedrooms: parsed.data.bedrooms } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
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
