import { z } from "zod";
import {
  amenityCategoryValues,
  bedTypeValues,
  locationDisclosureValues,
  propertyStatusValues,
  propertyTypeValues,
  rentalPolicyValues,
  unitSizeUnitValues,
  unitStatusValues,
} from "@provence360/database";
import { slugSchema, uuidSchema } from "@provence360/validation";

// A plain 24-hour "HH:MM" (seconds optional) string — locale-independent
// by construction, unlike "2pm"/"14h00", and matches exactly what
// Postgres's `time` column type accepts. See
// docs/adr/0018-rental-domain-guest-experience.md.
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Expected a 24-hour time, e.g. "14:00"');

export const rentalPolicySchema = z.enum(rentalPolicyValues);
export const locationDisclosureSchema = z.enum(locationDisclosureValues);
export const bedTypeSchema = z.enum(bedTypeValues);

export const propertyInputSchema = z
  .object({
    siteId: uuidSchema,
    internalName: z.string().trim().min(1).max(200),
    publicName: z.string().trim().min(1).max(200),
    slug: slugSchema,
    description: z.string().trim().max(5000).optional(),
    propertyType: z.enum(propertyTypeValues),
    addressLine1: z.string().trim().max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    addressCity: z.string().trim().max(120).optional(),
    addressPostalCode: z.string().trim().max(20).optional(),
    addressRegion: z.string().trim().max(120).optional(),
    addressCountry: z.string().trim().max(2).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    status: z.enum(propertyStatusValues).optional(),
    // v0.6 Guest Experience fields — see docs/adr/0018-rental-domain-guest-experience.md.
    checkInTime: timeOfDaySchema.optional(),
    checkOutTime: timeOfDaySchema.optional(),
    quietHoursStart: timeOfDaySchema.optional(),
    quietHoursEnd: timeOfDaySchema.optional(),
    smokingPolicy: rentalPolicySchema.optional(),
    petsPolicy: rentalPolicySchema.optional(),
    eventsPolicy: rentalPolicySchema.optional(),
    locationDisclosure: locationDisclosureSchema.optional(),
  })
  // Mirrors the database's own `properties_quiet_hours_pair_ck` CHECK at
  // the application boundary — both set or both omitted, never one alone.
  .refine((v) => (v.quietHoursStart === undefined) === (v.quietHoursEnd === undefined), {
    message: "quietHoursStart and quietHoursEnd must both be provided, or both omitted",
    path: ["quietHoursEnd"],
  });
export type PropertyInput = z.infer<typeof propertyInputSchema>;

// `size`/`sizeUnit` must both be present or both absent — mirrors the
// database's own `units_size_requires_unit_ck` CHECK constraint at the
// application boundary, so a caller gets a clean Zod issue instead of a
// raw Postgres constraint-violation error.
export const unitInputSchema = z
  .object({
    propertyId: uuidSchema,
    internalName: z.string().trim().min(1).max(200),
    publicName: z.string().trim().min(1).max(200),
    slug: slugSchema,
    status: z.enum(unitStatusValues).optional(),
    maxGuests: z.number().int().min(0).max(200).optional(),
    bedrooms: z.number().int().min(0).max(100).optional(),
    beds: z.number().int().min(0).max(100).optional(),
    bathrooms: z.number().min(0).max(100).multipleOf(0.5).optional(),
    size: z.number().positive().max(100_000).optional(),
    sizeUnit: z.enum(unitSizeUnitValues).optional(),
    description: z.string().trim().max(5000).optional(),
    ordering: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => (v.size === undefined) === (v.sizeUnit === undefined), {
    message: "size and sizeUnit must both be provided, or both omitted",
    path: ["sizeUnit"],
  });
export type UnitInput = z.infer<typeof unitInputSchema>;

export const amenityCategorySchema = z.enum(amenityCategoryValues);

export const sleepingArrangementInputSchema = z.object({
  unitId: uuidSchema,
  roomLabel: z.string().trim().min(1).max(120).optional(),
  bedType: bedTypeSchema,
  quantity: z.number().int().min(1).max(50).default(1),
  ordering: z.number().int().min(0).max(10_000).optional(),
});
export type SleepingArrangementInput = z.infer<typeof sleepingArrangementInputSchema>;

// Deliberately minimal (section 12 of the v0.6 brief explicitly warns
// against building "un framework générique énorme" for this): a small,
// closed, `.strict()` shape shared by both `unit_amenities.metadata` and
// `property_amenities.metadata`, rather than a per-amenity-category schema
// registry. `.strict()` rejects unknown keys outright — this is the actual
// validation that was previously entirely absent for this JSONB column.
export const amenityMetadataSchema = z
  .object({
    featured: z.boolean().optional(),
    note: z.string().trim().max(280).optional(),
  })
  .strict();
export type AmenityMetadata = z.infer<typeof amenityMetadataSchema>;
