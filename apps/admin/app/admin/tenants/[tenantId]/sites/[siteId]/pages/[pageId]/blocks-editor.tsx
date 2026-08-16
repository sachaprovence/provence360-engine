"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import {
  buttonStyle,
  dangerButtonStyle,
  errorTextStyle,
  secondaryButtonStyle,
  textareaStyle,
} from "@/lib/form-styles";
import {
  removeBlockAction,
  reorderBlocksAction,
  updateBlockPropsAction,
  type FormActionState,
} from "../actions";

export interface BlockRow {
  id: string;
  type: string;
  version: number;
  props: unknown;
}

const initialState: FormActionState = {};

function BlockPropsForm({
  tenantId,
  siteId,
  pageId,
  block,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  block: BlockRow;
}) {
  const [state, formAction, isPending] = useActionState(
    updateBlockPropsAction.bind(null, tenantId, siteId, pageId, block.id),
    initialState,
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 6 }}>
      <textarea
        name="props"
        defaultValue={JSON.stringify(block.props, null, 2)}
        style={textareaStyle}
      />
      <div>
        <button type="submit" disabled={isPending} style={buttonStyle}>
          {isPending ? "Saving…" : "Save props"}
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

// Blocks are a validated JSONB array, never relational rows (docs/adr/0013-page-content-storage.md)
// — reordering means submitting the FULL, permuted list of instance ids
// (docs/CONTENT_MODEL.md), never a single "move" operation the server has
// to interpret. Every mutation here (remove/reorder) goes straight
// through a Server Action rather than a <form>, because there's no
// FormData to collect — just an id (or a recomputed id order) already
// known client-side.
export function BlocksEditor({
  tenantId,
  siteId,
  pageId,
  blocks,
  canEdit,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  blocks: readonly BlockRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = blocks.map((b) => b.id);
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    startTransition(async () => {
      await reorderBlocksAction(tenantId, siteId, pageId, next);
      router.refresh();
    });
  }

  function remove(blockId: string) {
    startTransition(async () => {
      await removeBlockAction(tenantId, siteId, pageId, blockId);
      router.refresh();
    });
  }

  if (blocks.length === 0) {
    return <p style={{ color: "#6b7280", fontSize: 14 }}>No blocks yet.</p>;
  }

  return (
    <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
      {blocks.map((block, index) => (
        <li key={block.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 13 }}>
              {block.type}@{block.version}
            </strong>
            {canEdit ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  disabled={isPending || index === 0}
                  onClick={() => {
                    move(index, -1);
                  }}
                  style={secondaryButtonStyle}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={isPending || index === blocks.length - 1}
                  onClick={() => {
                    move(index, 1);
                  }}
                  style={secondaryButtonStyle}
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    remove(block.id);
                  }}
                  style={dangerButtonStyle}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
          {canEdit ? (
            <BlockPropsForm tenantId={tenantId} siteId={siteId} pageId={pageId} block={block} />
          ) : (
            <pre style={{ ...textareaStyle, background: "#f9fafb" }}>
              {JSON.stringify(block.props, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}
