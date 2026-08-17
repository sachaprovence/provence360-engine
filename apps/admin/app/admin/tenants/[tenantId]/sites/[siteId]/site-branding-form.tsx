"use client";

import { useActionState } from "react";
// Imported from the `@provence360/themes/branding` subpath, not the
// package's own root barrel: the root re-exports `theme-repository.ts`
// (a `getTheme`/`listThemes` DB read), which drags `@provence360/database`
// — and therefore the Node-only `postgres` client — into this client
// component's browser bundle. `branding.ts` itself has no such dependency
// (pure Zod schemas + closed constant tables), so the subpath import keeps
// this bundle server-code-free while still getting the real runtime
// token arrays (`FONT_TOKENS` etc.), not just their types.
import {
  BUTTON_STYLE_TOKENS,
  FONT_TOKENS,
  RADIUS_TOKENS,
  SECTION_STYLE_TOKENS,
  SPACING_TOKENS,
  type SiteBrandingV1,
} from "@provence360/themes/branding";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { MediaPicker, type MediaPickerOption } from "@/lib/media-picker";
import { updateSiteBrandingAction, type BrandingFormActionState } from "./actions";

const initialState: BrandingFormActionState = {};

const colorInputStyle = { ...inputStyle, padding: 2, height: 32, width: 56, cursor: "pointer" };
const fieldsetStyle = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, margin: 0 };
const legendStyle = { fontSize: 13, fontWeight: 600, padding: "0 4px" };
const colorGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap: 10,
};
const colorFieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "flex-start",
  gap: 4,
  fontSize: 12,
};

function ColorField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label style={colorFieldStyle}>
      {label}
      <input type="color" name={name} defaultValue={defaultValue} style={colorInputStyle} />
    </label>
  );
}

function OptionalColorField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string | undefined;
}) {
  return (
    <label style={colorFieldStyle}>
      {label} (optional)
      <input
        type="text"
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder="#rrggbb"
        style={{ ...inputStyle, width: 100, fontSize: 12 }}
      />
    </label>
  );
}

/**
 * v0.8 — Site Theme, Branding & Design System Kernel (section 16 of the
 * brief: a minimal, structured admin UI — not a raw-CSS/JSON escape hatch
 * and not a visual builder). Every input is a specific closed-shape
 * control (`type="color"`, a `<select>` from a closed token enum, a
 * MediaAsset picker) — there is no free-text field this form could use to
 * submit anything `updateSiteBrandingAction`'s own Zod schema wouldn't
 * already reject. See docs/adr/0021-site-theme-branding-design-system.md.
 */
export function SiteBrandingForm({
  tenantId,
  siteId,
  branding,
  mediaOptions,
}: {
  tenantId: string;
  siteId: string;
  branding: SiteBrandingV1;
  mediaOptions: readonly MediaPickerOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    updateSiteBrandingAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 16, maxWidth: 640, marginBottom: 24 }}>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Brand</legend>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={labelStyle}>
            Brand name
            <input
              type="text"
              name="brandName"
              defaultValue={branding.brand.name ?? ""}
              maxLength={120}
              style={inputStyle}
            />
          </label>
          <MediaPicker
            name="logoMediaId"
            label="Logo"
            defaultValue={branding.brand.logo?.mediaId}
            options={mediaOptions}
          />
          <MediaPicker
            name="logoDarkMediaId"
            label="Logo (dark backgrounds)"
            defaultValue={branding.brand.logoDark?.mediaId}
            options={mediaOptions}
          />
          <MediaPicker
            name="faviconMediaId"
            label="Favicon"
            defaultValue={branding.brand.favicon?.mediaId}
            options={mediaOptions}
          />
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Colors</legend>
        <div style={colorGridStyle}>
          <ColorField
            name="colorBackground"
            label="Background"
            defaultValue={branding.colors.background}
          />
          <ColorField name="colorSurface" label="Surface" defaultValue={branding.colors.surface} />
          <ColorField
            name="colorSurfaceMuted"
            label="Surface (muted)"
            defaultValue={branding.colors.surfaceMuted}
          />
          <ColorField name="colorText" label="Text" defaultValue={branding.colors.text} />
          <ColorField
            name="colorTextMuted"
            label="Text (muted)"
            defaultValue={branding.colors.textMuted}
          />
          <ColorField name="colorPrimary" label="Primary" defaultValue={branding.colors.primary} />
          <ColorField
            name="colorPrimaryForeground"
            label="Primary (foreground)"
            defaultValue={branding.colors.primaryForeground}
          />
          <ColorField
            name="colorSecondary"
            label="Secondary"
            defaultValue={branding.colors.secondary}
          />
          <ColorField
            name="colorSecondaryForeground"
            label="Secondary (foreground)"
            defaultValue={branding.colors.secondaryForeground}
          />
          <ColorField name="colorAccent" label="Accent" defaultValue={branding.colors.accent} />
          <ColorField
            name="colorAccentForeground"
            label="Accent (foreground)"
            defaultValue={branding.colors.accentForeground}
          />
          <ColorField name="colorBorder" label="Border" defaultValue={branding.colors.border} />
        </div>
        <div style={{ ...colorGridStyle, marginTop: 10 }}>
          <OptionalColorField
            name="colorSuccess"
            label="Success"
            defaultValue={branding.colors.success}
          />
          <OptionalColorField
            name="colorWarning"
            label="Warning"
            defaultValue={branding.colors.warning}
          />
          <OptionalColorField
            name="colorDanger"
            label="Danger"
            defaultValue={branding.colors.danger}
          />
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Typography</legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={labelStyle}>
            Heading font
            <select
              name="typographyHeading"
              defaultValue={branding.typography.heading}
              style={inputStyle}
            >
              {FONT_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Body font
            <select
              name="typographyBody"
              defaultValue={branding.typography.body}
              style={inputStyle}
            >
              {FONT_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Radius &amp; spacing</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <label style={labelStyle}>
            Radius (small)
            <select name="radiusSmall" defaultValue={branding.radius.small} style={inputStyle}>
              {RADIUS_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Radius (medium)
            <select name="radiusMedium" defaultValue={branding.radius.medium} style={inputStyle}>
              {RADIUS_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Radius (large)
            <select name="radiusLarge" defaultValue={branding.radius.large} style={inputStyle}>
              {RADIUS_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Section spacing
            <select
              name="spacingSection"
              defaultValue={branding.spacing.section}
              style={inputStyle}
            >
              {SPACING_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Buttons &amp; sections</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          <label style={labelStyle}>
            Primary button
            <select
              name="buttonsPrimaryStyle"
              defaultValue={branding.buttons.primary.style}
              style={inputStyle}
            >
              {BUTTON_STYLE_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Secondary button
            <select
              name="buttonsSecondaryStyle"
              defaultValue={branding.buttons.secondary.style}
              style={inputStyle}
            >
              {BUTTON_STYLE_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Section style
            <select name="sectionsStyle" defaultValue={branding.sections.style} style={inputStyle}>
              {SECTION_STYLE_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save branding"}
        </button>
      </div>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
      {state.warnings && state.warnings.length > 0 ? (
        <div role="status" style={{ fontSize: 13, color: "#92400e" }}>
          Saved — but low contrast detected:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {state.warnings.map((warning) => (
              <li key={warning.pair}>
                {warning.pair}: {warning.ratio}:1 (recommended at least {warning.minimum}:1)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
