import { z } from "zod";
import {
  amenityCategoryValues,
  propertyStatusValues,
  propertyTypeValues,
  unitSizeUnitValues,
  unitStatusValues,
} from "@provence360/database";
import { slugSchema, uuidSchema } from "@provence360/validation";

export const propertyInputSchema = z.object({
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
