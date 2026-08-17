import type { PropertySummaryProps } from "@provence360/content";
import { getPropertyGuestView } from "@provence360/rentals";
import type { BlockRenderer } from "../block-renderer-registry";
import { DomainReferenceUnavailable } from "./domain-reference-unavailable";

const policyLabels: Record<string, string> = {
  allowed: "Allowed",
  not_allowed: "Not allowed",
  on_request: "On request",
};

// A DOMAIN block: `props` holds only `propertyId` + presentation flags —
// the actual Property row is loaded here, scoped to the current tenant,
// via `packages/rentals`' guest-view read model (never a copy of the
// Property's name/address/description stored in the block itself). When
// `context.publicOnly` is set (v0.6), the read model itself both gates on
// the Property being currently public and filters the address down to
// whatever its `locationDisclosure` setting allows — a `propertyId`
// belonging to another tenant, or a non-public one, resolves to `null`
// under `publicOnly`, never a leaked address and never a thrown error that
// would take the whole page down with it (see
// docs/RENDERING.md#error-handling and the cross-tenant/location-privacy
// renderer tests).
export const propertySummaryRendererV1: BlockRenderer<PropertySummaryProps> = async ({
  id,
  props,
  context,
}) => {
  const t = context.tokens;
  const view = await getPropertyGuestView(context.tx, props.propertyId, {
    public: context.publicOnly === true,
  });
  if (!view) {
    return <DomainReferenceUnavailable id={id} blockType="property-summary" tokens={t} />;
  }

  const address = [
    view.location.addressLine1,
    view.location.addressCity,
    view.location.addressCountry,
  ]
    .filter(Boolean)
    .join(", ");

  const hasQuietHours = view.quietHours !== undefined;
  const policyEntries = Object.entries(view.policies).filter(
    ([, value]) => value !== undefined,
  ) as [string, string][];

  return (
    <section
      key={id}
      data-block="property-summary"
      style={{ padding: t["spacing.medium"], color: t["color.text"] }}
    >
      <h2 style={{ fontFamily: t["font.heading"], marginTop: 0 }}>{view.publicName}</h2>
      {props.showDescription && view.description ? (
        <p style={{ fontFamily: t["font.body"] }}>{view.description}</p>
      ) : null}
      {props.showAddress && address ? (
        <p style={{ color: t["color.muted"], fontFamily: t["font.body"] }}>{address}</p>
      ) : null}
      {props.showCheckInOut && (view.checkInTime ?? view.checkOutTime ?? hasQuietHours) ? (
        <ul style={{ listStyle: "none", padding: 0, fontFamily: t["font.body"] }}>
          {view.checkInTime ? <li>Check-in: {view.checkInTime}</li> : null}
          {view.checkOutTime ? <li>Check-out: {view.checkOutTime}</li> : null}
          {view.quietHours ? (
            <li>
              Quiet hours: {view.quietHours.start} - {view.quietHours.end}
            </li>
          ) : null}
        </ul>
      ) : null}
      {props.showPolicies && policyEntries.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, fontFamily: t["font.body"] }}>
          {policyEntries.map(([key, value]) => (
            <li key={key}>
              {key}: {policyLabels[value] ?? value}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
