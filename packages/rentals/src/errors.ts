export class SiteNotFoundError extends Error {
  constructor(siteId: string) {
    super(`Site "${siteId}" was not found (or does not belong to the current tenant).`);
    this.name = "SiteNotFoundError";
  }
}

export class PropertyNotFoundError extends Error {
  constructor(propertyId: string) {
    super(`Property "${propertyId}" was not found (or does not belong to the current tenant).`);
    this.name = "PropertyNotFoundError";
  }
}

export class UnitNotFoundError extends Error {
  constructor(unitId: string) {
    super(`Unit "${unitId}" was not found (or does not belong to the current tenant).`);
    this.name = "UnitNotFoundError";
  }
}

export class AmenityNotFoundError extends Error {
  constructor(amenityId: string) {
    super(`Amenity "${amenityId}" was not found (or is not active).`);
    this.name = "AmenityNotFoundError";
  }
}
