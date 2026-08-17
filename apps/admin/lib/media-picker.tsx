"use client";

import { useState } from "react";
import { labelStyle, secondaryButtonStyle } from "./form-styles";

export interface MediaPickerOption {
  id: string;
  /** "" for a legacy/non-image asset with no delivery URL yet — rendered as a placeholder tile, still selectable. */
  previewUrl: string;
  altText: string | null;
  originalFilename: string | null;
}

const panelStyle = {
  marginTop: 8,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 10,
  maxHeight: 260,
  overflowY: "auto" as const,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
  gap: 8,
};

const tileStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 4,
  cursor: "pointer",
  background: "white",
  display: "grid",
  gap: 4,
  fontSize: 10,
  color: "#6b7280",
  textAlign: "center" as const,
};

const selectedTileStyle = { ...tileStyle, borderColor: "#111827", borderWidth: 2 };

const thumbBoxStyle = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: 4,
  background: "#f3f4f6",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden" as const,
};

function Thumb({ option }: { option: MediaPickerOption }) {
  if (!option.previewUrl) {
    return <span style={{ fontSize: 9, color: "#9ca3af" }}>no preview</span>;
  }
  // Admin-only tooling grid, not the public renderer (which uses
  // next/image's <Image> conventions via resolveResponsiveImage); a plain
  // <img> avoids opting a Client Component into Next's image optimizer for
  // a same-origin, already-small "thumbnail" variant.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={option.previewUrl}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

/**
 * A reusable MediaAsset picker for admin `<form>`s (brief §18): renders like
 * any other form field — a hidden `<input name={name}>` carrying the
 * selected MediaAsset id — but replaces a raw text/UUID input with a visual
 * grid of the tenant's own media, so nobody has to know or type a UUID by
 * hand. `options` is pre-resolved server-side (`resolveMediaThumbnail` in
 * `apps/admin/lib/media-thumbnail.ts`) and passed down as plain data — this
 * component itself never touches `@provence360/media` or the database (see
 * that file's own doc comment for why).
 */
export function MediaPicker({
  name,
  label,
  defaultValue,
  options,
  onChange,
}: {
  /** Omit when used as a controlled widget (see `onChange`) rather than a plain `<form>` field — no hidden input is rendered in that case. */
  name?: string | undefined;
  label: string;
  defaultValue?: string | null | undefined;
  options: readonly MediaPickerOption[];
  /** Fires on every selection/clear — lets a parent (e.g. the Hero block editor) mirror the choice into something other than this component's own hidden input, such as a JSON props blob. */
  onChange?: (id: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;

  function select(id: string) {
    setValue(id);
    onChange?.(id);
  }

  return (
    <div style={labelStyle}>
      {label}
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...thumbBoxStyle, width: 48, height: 48 }}>
          {selected ? (
            <Thumb option={selected} />
          ) : (
            <span style={{ fontSize: 9, color: "#9ca3af" }}>none</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>
          {selected
            ? (selected.altText ?? selected.originalFilename ?? selected.id)
            : "— none selected —"}
        </span>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
        >
          {open ? "Close" : "Choose…"}
        </button>
        {value ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              select("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {open ? (
        <div style={panelStyle} role="listbox" aria-label={label}>
          {options.length === 0 ? (
            <p style={{ fontSize: 12, color: "#6b7280", gridColumn: "1 / -1" }}>
              No media uploaded yet.
            </p>
          ) : (
            options.map((option) => (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                aria-label={option.altText ?? option.originalFilename ?? option.id}
                style={option.id === value ? selectedTileStyle : tileStyle}
                onClick={() => {
                  select(option.id);
                  setOpen(false);
                }}
                title={option.altText ?? option.originalFilename ?? option.id}
              >
                <div style={thumbBoxStyle}>
                  <Thumb option={option} />
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Gallery block's multi-image counterpart to `MediaPicker`: an ordered
 * list of selected MediaAsset ids (`galleryPropsSchema.mediaAssetIds`,
 * brief §18), rendered as a picker grid where a tile toggles membership
 * (click to add, click again to remove) instead of replacing a single
 * value. Always controlled — the caller (the Gallery block editor) owns
 * `selectedIds`, the same "picker patches the JSON props blob" pattern
 * `MediaPicker`'s own `onChange` mode uses.
 */
export function GalleryMediaPicker({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: readonly MediaPickerOption[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <div style={labelStyle}>
      {label} ({selectedIds.length} selected)
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {selectedIds.map((id, index) => {
          const option = options.find((candidate) => candidate.id === id);
          return (
            <div key={id} style={{ ...thumbBoxStyle, width: 40, height: 40, position: "relative" }}>
              {option ? <Thumb option={option} /> : <span style={{ fontSize: 8 }}>?</span>}
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  fontSize: 9,
                  background: "#111827",
                  color: "white",
                  borderRadius: 3,
                  padding: "0 3px",
                }}
              >
                {index + 1}
              </span>
            </div>
          );
        })}
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
        >
          {open ? "Close" : "Add images…"}
        </button>
      </div>
      {open ? (
        <div style={panelStyle} role="listbox" aria-label={label} aria-multiselectable="true">
          {options.length === 0 ? (
            <p style={{ fontSize: 12, color: "#6b7280", gridColumn: "1 / -1" }}>
              No media uploaded yet.
            </p>
          ) : (
            options.map((option) => (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={selectedIds.includes(option.id)}
                aria-label={option.altText ?? option.originalFilename ?? option.id}
                style={selectedIds.includes(option.id) ? selectedTileStyle : tileStyle}
                onClick={() => {
                  toggle(option.id);
                }}
                title={option.altText ?? option.originalFilename ?? option.id}
              >
                <div style={thumbBoxStyle}>
                  <Thumb option={option} />
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
