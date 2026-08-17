import type { VirtualTourProps } from "@provence360/content";
import {
  buildSafeVirtualTourEmbed,
  getPublicVirtualTour,
  getVirtualTour,
} from "@provence360/virtual-tours";
import type { BlockRenderer } from "../block-renderer-registry";
import { resolveMediaDescriptor } from "../resolve-media";
import { DomainReferenceUnavailable } from "./domain-reference-unavailable";

// `paddingBottom` percentages implementing the classic intrinsic-ratio
// technique (a fixed-position child filling an absolutely-sized parent) —
// the container never depends on the iframe's own dimensions, so the
// layout stays responsive without any provider-side cooperation.
const aspectRatioPadding: Record<VirtualTourProps["aspectRatio"], string> = {
  "16:9": "56.25%",
  "4:3": "75%",
};

// A DOMAIN block: `props` holds only a `tourId` reference + presentation
// options — the real VirtualTour row (provider, providerAssetId, status)
// is loaded here, scoped to the current tenant, and always LIVE, never
// from any frozen manifest (unlike `media`/`posterMediaId` below): an
// admin repointing or archiving a Tour after publish must take effect
// immediately, without a republish (Presentation-Frozen/Business-Live
// boundary — see docs/adr/0019-virtual-tour-immersive-kernel.md). When
// `context.publicOnly` is set, only an `active` Tour resolves; a
// `draft`/`archived` one — or one belonging to another tenant — resolves
// to `null`, rendering `DomainReferenceUnavailable` instead of throwing,
// exactly like `property-summary`/`unit-grid`.
//
// The `src` this component passes to `<iframe>` is never derived from
// anything admin- or visitor-supplied at render time: it comes only from
// `buildSafeVirtualTourEmbed`, which in turn only ever returns a
// registered provider's own deterministic, first-party-constructed URL
// (see `packages/virtual-tours/src/embed.ts`). No `dangerouslySetInnerHTML`,
// no stored HTML/iframe string, ever.
export const virtualTourRendererV1: BlockRenderer<VirtualTourProps> = async ({
  id,
  props,
  context,
}) => {
  const t = context.tokens;
  const tour = context.publicOnly
    ? await getPublicVirtualTour(context.tx, props.tourId)
    : await getVirtualTour(context.tx, props.tourId);
  if (!tour) {
    return <DomainReferenceUnavailable id={id} blockType="virtual-tour" tokens={t} />;
  }

  const embed = buildSafeVirtualTourEmbed(tour);
  const poster = props.posterMediaId
    ? await resolveMediaDescriptor(props.posterMediaId, context)
    : null;

  return (
    <section key={id} data-block="virtual-tour" style={{ padding: t["spacing.medium"] }}>
      {props.showTitle ? (
        <h2 style={{ fontFamily: t["font.heading"], marginTop: 0 }}>{tour.publicName}</h2>
      ) : null}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: aspectRatioPadding[props.aspectRatio],
          background: poster
            ? `${t["color.surface"]} url(${poster.storageKey}) center/cover`
            : t["color.surface"],
          borderRadius: t["radius.large"],
          overflow: "hidden",
        }}
      >
        <iframe
          src={embed.src}
          title={tour.publicName}
          loading="lazy"
          allowFullScreen={embed.allowFullscreen}
          allow={embed.iframeAllow}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </div>
    </section>
  );
};
