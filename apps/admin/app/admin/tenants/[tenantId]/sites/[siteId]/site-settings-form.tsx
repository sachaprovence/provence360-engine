"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, labelStyle, inputStyle } from "@/lib/form-styles";
import { updateSiteSettingsAction, type FormActionState } from "./actions";

const initialState: FormActionState = {};

export function SiteSettingsForm({
  tenantId,
  siteId,
  site,
}: {
  tenantId: string;
  siteId: string;
  site: {
    publicName: string | null;
    timezone: string;
    defaultLocale: string;
    enabledLocales: unknown;
    contactEmail: string | null;
  };
}) {
  const [state, formAction, isPending] = useActionState(
    updateSiteSettingsAction.bind(null, tenantId, siteId),
    initialState,
  );

  const enabledLocales = Array.isArray(site.enabledLocales) ? site.enabledLocales.join(", ") : "fr";

  return (
    <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 24 }}>
      <label style={labelStyle}>
        Public name
        <input name="publicName" defaultValue={site.publicName ?? ""} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Timezone
        <input name="timezone" defaultValue={site.timezone} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Default locale
        <input name="defaultLocale" defaultValue={site.defaultLocale} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Enabled locales (comma-separated)
        <input name="enabledLocales" defaultValue={enabledLocales} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Contact email
        <input
          name="contactEmail"
          type="email"
          defaultValue={site.contactEmail ?? ""}
          style={inputStyle}
        />
      </label>
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
