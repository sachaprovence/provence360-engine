"use client";

import { useActionState } from "react";
import {
  buttonStyle,
  errorTextStyle,
  inputStyle,
  labelStyle,
  textareaStyle,
} from "@/lib/form-styles";
import { updateSiteThemeAction, type FormActionState } from "./actions";

const initialState: FormActionState = {};

// Themes are a curated, platform-level catalog (docs/adr/0011-theme-token-model.md)
// — this form only lets a Site choose one and narrow it with overrides,
// never author a new theme or write arbitrary CSS (docs/THEMES.md). The
// override field is a JSON object of the closed token catalog's keys only
// (e.g. {"color.primary": "#123456"}) — anything else is rejected server-side.
export function SiteThemeForm({
  tenantId,
  siteId,
  currentThemeId,
  currentOverrides,
  themes,
}: {
  tenantId: string;
  siteId: string;
  currentThemeId: string | null;
  currentOverrides: unknown;
  themes: Array<{ id: string; key: string; name: string }>;
}) {
  const [state, formAction, isPending] = useActionState(
    updateSiteThemeAction.bind(null, tenantId, siteId),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 24 }}>
      <label style={labelStyle}>
        Base theme
        <select name="themeId" defaultValue={currentThemeId ?? ""} style={inputStyle}>
          <option value="">— none (fallback tokens) —</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name} ({theme.key})
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Theme overrides (JSON, closed token catalog only)
        <textarea
          name="themeOverrides"
          defaultValue={JSON.stringify(currentOverrides ?? {}, null, 2)}
          style={textareaStyle}
        />
      </label>
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save theme"}
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
