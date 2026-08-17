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

export class VirtualTourNotFoundError extends Error {
  constructor(tourId: string) {
    super(`Virtual tour "${tourId}" was not found (or does not belong to the current tenant).`);
    this.name = "VirtualTourNotFoundError";
  }
}

/** Optimistic-concurrency conflict — same pattern as `packages/sites`' `SiteConflictError`/`packages/rentals`' `PropertyConflictError`. */
export class VirtualTourConflictError extends Error {
  constructor(tourId: string) {
    super(`Virtual tour "${tourId}" was modified by someone else since it was last read.`);
    this.name = "VirtualTourConflictError";
  }
}

/**
 * Thrown by a provider adapter's `normalize()` when the admin-supplied
 * input (a pasted share URL or a bare id) doesn't match that provider's
 * accepted formats — wrong host, wrong protocol, malformed id, or a
 * disguised injection attempt (`javascript:`, `data:`, `blob:`, ...). The
 * message intentionally never echoes the raw input back — see
 * `packages/virtual-tours/src/providers/matterport.ts`.
 */
export class InvalidVirtualTourProviderInputError extends Error {
  constructor(
    public readonly provider: string,
    reason: string,
  ) {
    super(`Invalid input for provider "${provider}": ${reason}`);
    this.name = "InvalidVirtualTourProviderInputError";
  }
}

export class UnknownVirtualTourProviderError extends Error {
  constructor(provider: string) {
    super(`Unknown virtual tour provider "${provider}".`);
    this.name = "UnknownVirtualTourProviderError";
  }
}

export class DuplicateVirtualTourProviderRegistrationError extends Error {
  constructor(provider: string) {
    super(`Virtual tour provider "${provider}" is already registered.`);
    this.name = "DuplicateVirtualTourProviderRegistrationError";
  }
}
