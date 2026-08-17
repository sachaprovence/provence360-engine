import type {
  AppTx,
  BedType,
  LocationDisclosure,
  PropertyStatus,
  PropertyType,
  RentalPolicy,
  UnitSizeUnit,
  UnitStatus,
  properties,
  units,
} from "@provence360/database";
import { getProperty, getPublicProperty } from "./property-repository";
import { listSleepingArrangementsForUnit } from "./sleeping-arrangement-repository";
import { getPublicUnit, getUnit } from "./unit-repository";

type PropertyRow = typeof properties.$inferSelect;
type UnitRow = typeof units.$inferSelect;

/**
 * The guest-facing shape of a Property's location — never the raw address
 * columns. Which fields are present depends on `disclosure` (section 8 of
 * the v0.6 brief): `"exact"` includes everything, `"approximate"` includes
 * only city/region/country, `"hidden"` includes nothing beyond the
 * disclosure flag itself. Fields are *omitted*, never set to `null` or
 * `undefined`, when not disclosed — under `exactOptionalPropertyTypes`
 * this is also what makes "this field is present but empty" structurally
 * different from "this field was never allowed to leak" (see
 * `buildLocationView` below).
 */
export interface PropertyLocationView {
  disclosure: LocationDisclosure;
  addressCity?: string;
  addressRegion?: string;
  addressCountry?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface PropertyGuestView {
  id: string;
  publicName: string;
  slug: string;
  propertyType: PropertyType;
  status: PropertyStatus;
  description?: string;
  location: PropertyLocationView;
  checkInTime?: string;
  checkOutTime?: string;
  quietHours?: { start: string; end: string };
  policies: {
    smoking?: RentalPolicy;
    pets?: RentalPolicy;
    events?: RentalPolicy;
  };
}

/**
 * Projects a raw Property row into its guest-facing view. `publicView`
 * controls location filtering: `false` (the admin/preview path — an owner
 * editing or previewing their own Property) always sees the full address
 * regardless of `locationDisclosure`, since that setting governs what
 * *guests* see, not what the owner can see of their own data; `true` (the
 * actual public rendering path) enforces it. This is deliberately a pure,
 * DB-free function — the leak-prevention logic is exercised directly by
 * unit tests without needing a database, and `getPropertyGuestView` below
 * is a thin wrapper that only adds the fetch.
 */
export function buildPropertyGuestView(
  property: PropertyRow,
  publicView: boolean,
): PropertyGuestView {
  const disclosure = property.locationDisclosure;
  const showApproximate = !publicView || disclosure !== "hidden";
  const showExact = !publicView || disclosure === "exact";

  const location: PropertyLocationView = { disclosure };
  if (showApproximate) {
    if (property.addressCity) location.addressCity = property.addressCity;
    if (property.addressRegion) location.addressRegion = property.addressRegion;
    if (property.addressCountry) location.addressCountry = property.addressCountry;
  }
  if (showExact) {
    if (property.addressLine1) location.addressLine1 = property.addressLine1;
    if (property.addressLine2) location.addressLine2 = property.addressLine2;
    if (property.addressPostalCode) location.addressPostalCode = property.addressPostalCode;
    if (property.latitude != null) location.latitude = Number(property.latitude);
    if (property.longitude != null) location.longitude = Number(property.longitude);
  }

  const quietHours =
    property.quietHoursStart && property.quietHoursEnd
      ? { start: property.quietHoursStart, end: property.quietHoursEnd }
      : undefined;

  return {
    id: property.id,
    publicName: property.publicName,
    slug: property.slug,
    propertyType: property.propertyType,
    status: property.status,
    ...(property.description ? { description: property.description } : {}),
    location,
    ...(property.checkInTime ? { checkInTime: property.checkInTime } : {}),
    ...(property.checkOutTime ? { checkOutTime: property.checkOutTime } : {}),
    ...(quietHours ? { quietHours } : {}),
    policies: {
      ...(property.smokingPolicy ? { smoking: property.smokingPolicy } : {}),
      ...(property.petsPolicy ? { pets: property.petsPolicy } : {}),
      ...(property.eventsPolicy ? { events: property.eventsPolicy } : {}),
    },
  };
}

/**
 * Fetches a Property and projects it through {@link buildPropertyGuestView}
 * in one call — the function a block renderer should use instead of
 * calling `getProperty`/`getPublicProperty` and shaping the result itself
 * (section 14 of the v0.6 brief: domain read-model functions so the
 * renderer never does ad-hoc business queries). `options.public: true`
 * both gates on {@link isPublicPropertyStatus} (via `getPublicProperty` —
 * a draft/archived Property resolves to `null`, never a partially-filled
 * view) and enforces `locationDisclosure` filtering.
 */
export async function getPropertyGuestView(
  tx: AppTx,
  propertyId: string,
  options?: { public?: boolean },
): Promise<PropertyGuestView | null> {
  const publicView = options?.public ?? false;
  const property = publicView
    ? await getPublicProperty(tx, propertyId)
    : await getProperty(tx, propertyId);
  if (!property) return null;
  return buildPropertyGuestView(property, publicView);
}

export interface SleepingArrangementView {
  id: string;
  roomLabel?: string;
  bedType: BedType;
  quantity: number;
  ordering: number;
}

export interface UnitGuestView {
  id: string;
  publicName: string;
  slug: string;
  status: UnitStatus;
  maxGuests?: number;
  bedrooms?: number;
  bathrooms?: number;
  size?: number;
  sizeUnit?: UnitSizeUnit;
  description?: string;
  /**
   * The bed count to display (section 10 of the v0.6 brief's
   * aggregates-vs-detail strategy): the sum of `sleepingArrangements`'
   * quantities when any detail rows exist, otherwise the raw `beds`
   * column. Never both shown at once, so "beds: 3" and "detail sums to 5"
   * can never be displayed simultaneously — see
   * docs/adr/0018-rental-domain-guest-experience.md.
   */
  effectiveBedCount?: number;
  sleepingArrangements: SleepingArrangementView[];
}

function toSleepingArrangementView(row: {
  id: string;
  roomLabel: string | null;
  bedType: BedType;
  quantity: number;
  ordering: number;
}): SleepingArrangementView {
  return {
    id: row.id,
    ...(row.roomLabel ? { roomLabel: row.roomLabel } : {}),
    bedType: row.bedType,
    quantity: row.quantity,
    ordering: row.ordering,
  };
}

export function buildUnitGuestView(
  unit: UnitRow,
  sleepingArrangements: readonly SleepingArrangementView[],
): UnitGuestView {
  const detailTotal = sleepingArrangements.reduce((sum, row) => sum + row.quantity, 0);
  const effectiveBedCount =
    sleepingArrangements.length > 0 ? detailTotal : (unit.beds ?? undefined);

  return {
    id: unit.id,
    publicName: unit.publicName,
    slug: unit.slug,
    status: unit.status,
    ...(unit.maxGuests != null ? { maxGuests: unit.maxGuests } : {}),
    ...(unit.bedrooms != null ? { bedrooms: unit.bedrooms } : {}),
    ...(unit.bathrooms != null ? { bathrooms: Number(unit.bathrooms) } : {}),
    ...(unit.size != null ? { size: Number(unit.size) } : {}),
    ...(unit.sizeUnit ? { sizeUnit: unit.sizeUnit } : {}),
    ...(unit.description ? { description: unit.description } : {}),
    ...(effectiveBedCount != null ? { effectiveBedCount } : {}),
    sleepingArrangements: [...sleepingArrangements],
  };
}

/** Fetch-and-project convenience wrapper, same shape as {@link getPropertyGuestView}. */
export async function getUnitGuestView(
  tx: AppTx,
  unitId: string,
  options?: { public?: boolean },
): Promise<UnitGuestView | null> {
  const publicView = options?.public ?? false;
  const unit = publicView ? await getPublicUnit(tx, unitId) : await getUnit(tx, unitId);
  if (!unit) return null;
  const arrangements = await listSleepingArrangementsForUnit(tx, unitId);
  return buildUnitGuestView(unit, arrangements.map(toSleepingArrangementView));
}
