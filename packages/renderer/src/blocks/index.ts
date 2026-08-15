import { registerBlockRenderer } from "../block-renderer-registry";
import { amenitiesRendererV1 } from "./amenities";
import { ctaRendererV1 } from "./cta";
import { featureListRendererV1 } from "./feature-list";
import { galleryRendererV1 } from "./gallery";
import { heroRendererV1 } from "./hero";
import { propertySummaryRendererV1 } from "./property-summary";
import { textRendererV1 } from "./text";
import { unitGridRendererV1 } from "./unit-grid";

// Registers a React renderer for every built-in `type@version` the
// content package's own `blocks/index.ts` registers a schema for — same
// import-time-side-effect singleton pattern, kept in its own registry
// (see block-renderer-registry.ts for why).
registerBlockRenderer("hero", 1, heroRendererV1);
registerBlockRenderer("text", 1, textRendererV1);
registerBlockRenderer("gallery", 1, galleryRendererV1);
registerBlockRenderer("feature-list", 1, featureListRendererV1);
registerBlockRenderer("cta", 1, ctaRendererV1);
registerBlockRenderer("property-summary", 1, propertySummaryRendererV1);
registerBlockRenderer("unit-grid", 1, unitGridRendererV1);
registerBlockRenderer("amenities", 1, amenitiesRendererV1);
