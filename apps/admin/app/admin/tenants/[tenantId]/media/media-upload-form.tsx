"use client";

import { useActionState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { uploadMediaAction, type UploadMediaFormState } from "./actions";

const initialState: UploadMediaFormState = {};

/**
 * Admin Media Library upload form (brief §17): a file picker, an optional
 * alt text field, explicit pending/success/error states via
 * `useActionState` — the same idiom every other admin form in this app
 * uses (see `CreateDomainForm`). No client-side image processing or
 * preview-before-upload: the server is the only place that decodes,
 * validates, and creates variants (brief §37 — processing happens at
 * ingestion, never duplicated client-side).
 */
export function MediaUploadForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, isPending] = useActionState(
    uploadMediaAction.bind(null, tenantId),
    initialState,
  );

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        marginBottom: 20,
        flexWrap: "wrap",
      }}
    >
      <label style={labelStyle}>
        Image file
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Alt text (optional)
        <input type="text" name="altText" maxLength={500} style={inputStyle} />
      </label>
      <button type="submit" disabled={isPending} style={buttonStyle}>
        {isPending ? "Uploading…" : "Upload"}
      </button>
      {state.error ? (
        <span role="alert" style={errorTextStyle}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
