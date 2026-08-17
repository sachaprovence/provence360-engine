import { registerBlock } from "../block-registry";
import { amenitiesBlockV1 } from "./amenities";
import { ctaBlockV1 } from "./cta";
import { featureListBlockV1 } from "./feature-list";
import { galleryBlockV1 } from "./gallery";
import { heroBlockV1 } from "./hero";
import { propertySummaryBlockV1 } from "./property-summary";
import { textBlockV1 } from "./text";
import { unitGridBlockV1 } from "./unit-grid";
import { virtualTourBlockV1 } from "./virtual-tour";

// Registers every built-in block exactly once, as a side effect of
// importing this module (ES modules are evaluated once per process — a
// second `import` anywhere else in the same process reuses this same
// module instance, it does not re-run this file and re-throw
// DuplicateBlockRegistrationError). This is the ONLY place `type ===`
// string comparisons happen to assemble the registry — see
// docs/adr/0014-block-registry-versioning.md.
registerBlock(heroBlockV1);
registerBlock(textBlockV1);
registerBlock(galleryBlockV1);
registerBlock(featureListBlockV1);
registerBlock(ctaBlockV1);
registerBlock(propertySummaryBlockV1);
registerBlock(unitGridBlockV1);
registerBlock(amenitiesBlockV1);
registerBlock(virtualTourBlockV1);

export {
  amenitiesBlockV1,
  ctaBlockV1,
  featureListBlockV1,
  galleryBlockV1,
  heroBlockV1,
  propertySummaryBlockV1,
  textBlockV1,
  unitGridBlockV1,
  virtualTourBlockV1,
};
export type { AmenitiesProps } from "./amenities";
export type { CtaProps } from "./cta";
export type { FeatureListProps } from "./feature-list";
export type { GalleryProps } from "./gallery";
export type { HeroProps } from "./hero";
export type { PropertySummaryProps } from "./property-summary";
export type { TextProps } from "./text";
export type { UnitGridProps } from "./unit-grid";
export type { VirtualTourProps } from "./virtual-tour";
