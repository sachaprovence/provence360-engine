"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  buttonStyle,
  dangerButtonStyle,
  errorTextStyle,
  secondaryButtonStyle,
  textareaStyle,
} from "@/lib/form-styles";
import { GalleryMediaPicker, MediaPicker, type MediaPickerOption } from "@/lib/media-picker";
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

/** Best-effort read of a string/string[] field out of the props JSON currently in the textarea — never throws, since the textarea may transiently hold invalid JSON while the admin is mid-edit. */
function readPropsField(propsText: string, key: string): unknown {
  try {
    const parsed = JSON.parse(propsText) as Record<string, unknown>;
    return parsed[key];
  } catch {
    return undefined;
  }
}

function patchPropsField(propsText: string, key: string, value: unknown): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(propsText) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  if (value === "" || value === undefined) {
    delete parsed[key];
  } else {
    parsed[key] = value;
  }
  return JSON.stringify(parsed, null, 2);
}

function BlockPropsForm({
  tenantId,
  siteId,
  pageId,
  block,
  mediaOptions,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  block: BlockRow;
  mediaOptions: readonly MediaPickerOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    updateBlockPropsAction.bind(null, tenantId, siteId, pageId, block.id),
    initialState,
  );
  // Controlled, not `defaultValue`: the Hero/Gallery media pickers below
  // patch this same JSON text on selection (brief §18) — the textarea
  // stays the single source of truth and remains directly editable for
  // every other field (localized headline/caption text, CTA href, etc.),
  // so nothing about the pre-existing generic block editor regresses.
  const [propsText, setPropsText] = useState(() => JSON.stringify(block.props, null, 2));

  const backgroundMediaId =
    block.type === "hero"
      ? (readPropsField(propsText, "backgroundMediaId") as string | undefined)
      : undefined;
  const galleryIdsRaw =
    block.type === "gallery" ? readPropsField(propsText, "mediaAssetIds") : undefined;
  const galleryIds = Array.isArray(galleryIdsRaw)
    ? galleryIdsRaw.filter((id): id is string => typeof id === "string")
    : [];

  return (
    <form action={formAction} style={{ display: "grid", gap: 6 }}>
      {block.type === "hero" ? (
        <MediaPicker
          label="Background image"
          options={mediaOptions}
          defaultValue={backgroundMediaId}
          onChange={(id) => {
            setPropsText((current) => patchPropsField(current, "backgroundMediaId", id));
          }}
        />
      ) : null}
      {block.type === "gallery" ? (
        <GalleryMediaPicker
          label="Images"
          options={mediaOptions}
          selectedIds={galleryIds}
          onChange={(ids) => {
            setPropsText((current) => patchPropsField(current, "mediaAssetIds", ids));
          }}
        />
      ) : null}
      <textarea
        name="props"
        value={propsText}
        onChange={(event) => {
          setPropsText(event.target.value);
        }}
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
  mediaOptions,
}: {
  tenantId: string;
  siteId: string;
  pageId: string;
  blocks: readonly BlockRow[];
  canEdit: boolean;
  mediaOptions: readonly MediaPickerOption[];
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
            <BlockPropsForm
              tenantId={tenantId}
              siteId={siteId}
              pageId={pageId}
              block={block}
              mediaOptions={mediaOptions}
            />
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
