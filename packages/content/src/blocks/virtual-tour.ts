import { z } from "zod";
import { uuidSchema } from "@provence360/validation";
import type { BlockDefinition } from "../block-registry";

// A DOMAIN block (section 15 of the brief, extended by v0.7 section 6):
// holds a *reference* to a VirtualTour plus presentation options only —
// never a copy of the tour's provider/providerAssetId/embed URL. The
// renderer resolves the real row from `@provence360/virtual-tours` at
// render time (always live — see the Presentation-Frozen/Business-Live
// boundary in docs/adr/0019-virtual-tour-immersive-kernel.md), so an
// admin can repoint or archive the tour after publish without requiring
// a republish for that change to take effect.
export const virtualTourPropsSchema = z.object({
  tourId: uuidSchema,
  showTitle: z.boolean().default(true),
  aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
  // Optional poster image shown before the iframe loads (documented
  // click-to-load consideration, section 29/31 of the brief) — a MEDIA
  // reference, resolved/frozen through the exact same manifest mechanism
  // as `hero@1`'s `backgroundMediaId`, never a new one.
  posterMediaId: uuidSchema.optional(),
});

export type VirtualTourProps = z.infer<typeof virtualTourPropsSchema>;

export const virtualTourBlockV1: BlockDefinition<VirtualTourProps> = {
  type: "virtual-tour",
  version: 1,
  schema: virtualTourPropsSchema,
  capabilities: { domainBound: true },
  references: (props) => [
    { kind: "domain", domainType: "virtualTour", id: props.tourId },
    ...(props.posterMediaId ? [{ kind: "media" as const, id: props.posterMediaId }] : []),
  ],
};
