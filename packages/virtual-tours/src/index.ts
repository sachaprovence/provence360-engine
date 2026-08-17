// Registers every built-in provider (currently: Matterport) as a side
// effect of importing this package — see `src/providers/index.ts`.
export * from "./providers";

export {
  DuplicateVirtualTourProviderRegistrationError,
  InvalidVirtualTourProviderInputError,
  PropertyNotFoundError,
  UnitNotFoundError,
  UnknownVirtualTourProviderError,
  VirtualTourConflictError,
  VirtualTourNotFoundError,
} from "./errors";

export { virtualTourProviderRegistry } from "./provider-registry";
export type { VirtualTourProviderDefinition } from "./provider-registry";

export { buildSafeVirtualTourEmbed, listAllProviderFrameOrigins } from "./embed";
export type { SafeVirtualTourEmbed } from "./embed";

export {
  createVirtualTour,
  deleteVirtualTour,
  getPublicVirtualTour,
  getVirtualTour,
  isPublicVirtualTourStatus,
  listVirtualToursForProperty,
  listVirtualToursForUnit,
  updateVirtualTour,
} from "./virtual-tour-repository";
export type { CreateVirtualTourInput, UpdateVirtualTourInput } from "./virtual-tour-repository";
