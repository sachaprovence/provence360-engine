"use client";

import { useActionState, useState } from "react";
import {
  buttonStyle,
  errorTextStyle,
  inputStyle,
  labelStyle,
  textareaStyle,
} from "@/lib/form-styles";
import { addBlockAction, type FormActionState } from "../actions";

const initialState: FormActionState = {};

export function AddBlockForm({
  tenantId,
  siteId,
  pageId,
  availableBlocks,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  availableBlocks: ReadonlyArray<{ type: string; version: number }>;
}) {
  const [state, formAction, isPending] = useActionState(
    addBlockAction.bind(null, tenantId, siteId, pageId),
    initialState,
  );
  const [selected, setSelected] = useState(availableBlocks[0]);

  return (
    <form action={formAction} style={{ display: "grid", gap: 8, maxWidth: 420, marginBottom: 24 }}>
      <label style={labelStyle}>
        Block type
        <select
          name="type"
          data-testid="add-block-type"
          value={selected?.type ?? ""}
          onChange={(event) => {
            const next = availableBlocks.find((b) => b.type === event.target.value);
            if (next) setSelected(next);
          }}
          style={inputStyle}
        >
          {availableBlocks.map((block) => (
            <option key={`${block.type}@${String(block.version)}`} value={block.type}>
              {block.type}@{block.version}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="version" value={selected?.version ?? 1} />
      <label style={labelStyle}>
        Props (JSON)
        <textarea
          name="props"
          data-testid="add-block-props"
          defaultValue="{}"
          style={textareaStyle}
        />
      </label>
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Adding…" : "Add block"}
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
