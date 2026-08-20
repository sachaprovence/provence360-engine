"use client";

import { useActionState, useMemo, useState } from "react";
import { buttonStyle, errorTextStyle, inputStyle, labelStyle } from "@/lib/form-styles";
import { addBlockAction, type FormActionState } from "../actions";

const initialState: FormActionState = {};

const blockLabels: Record<string, string> = {
  hero: "Grand titre",
  text: "Texte",
  gallery: "Galerie",
  "feature-list": "Liste d'avantages",
  cta: "Appel à l'action",
  "property-summary": "Présentation d'un hébergement",
  "unit-grid": "Liste des logements",
  amenities: "Équipements",
  "virtual-tour": "Visite virtuelle",
};

function localized(value: string): Record<string, string> {
  return { fr: value.trim() };
}

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
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonHref, setButtonHref] = useState("");

  const friendlyProps = useMemo(() => {
    switch (selected?.type) {
      case "hero":
        return {
          headline: localized(title || "Nouveau titre"),
          ...(body.trim() ? { subheadline: localized(body) } : {}),
          ...(buttonLabel.trim() ? { ctaLabel: localized(buttonLabel) } : {}),
          ...(buttonHref.trim() ? { ctaHref: buttonHref.trim() } : {}),
        };
      case "text":
        return {
          ...(title.trim() ? { heading: localized(title) } : {}),
          body: localized(body || "Nouveau texte"),
        };
      case "feature-list":
        return {
          ...(title.trim() ? { heading: localized(title) } : {}),
          items: [{ title: localized(body || "Nouvel avantage") }],
        };
      case "cta":
        return {
          ...(title.trim() ? { heading: localized(title) } : {}),
          ...(body.trim() ? { body: localized(body) } : {}),
          buttonLabel: localized(buttonLabel || "En savoir plus"),
          buttonHref: buttonHref.trim() || "#contact",
        };
      default:
        return {};
    }
  }, [body, buttonHref, buttonLabel, selected?.type, title]);

  const hasFriendlyForm = ["hero", "text", "feature-list", "cta"].includes(
    selected?.type ?? "",
  );

  return (
    <form action={formAction} style={{ display: "grid", gap: 12, maxWidth: 560, marginBottom: 24 }}>
      <label style={labelStyle}>
        Type de contenu
        <select
          name="type"
          data-testid="add-block-type"
          value={selected?.type ?? ""}
          onChange={(event) => {
            const next = availableBlocks.find((block) => block.type === event.target.value);
            if (next) setSelected(next);
          }}
          style={inputStyle}
        >
          {availableBlocks.map((block) => (
            <option key={`${block.type}@${String(block.version)}`} value={block.type}>
              {blockLabels[block.type] ?? block.type}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="version" value={selected?.version ?? 1} />

      {hasFriendlyForm ? (
        <>
          <label style={labelStyle}>
            Titre
            <input value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            {selected?.type === "feature-list" ? "Premier avantage" : "Texte"}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
            />
          </label>
          {selected?.type === "hero" || selected?.type === "cta" ? (
            <>
              <label style={labelStyle}>
                Texte du bouton
                <input
                  value={buttonLabel}
                  onChange={(event) => setButtonLabel(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Lien du bouton
                <input
                  value={buttonHref}
                  onChange={(event) => setButtonHref(event.target.value)}
                  placeholder="/contact ou #contact"
                  style={inputStyle}
                />
              </label>
            </>
          ) : null}
        </>
      ) : (
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
          Ce bloc doit référencer un média, un hébergement ou une visite déjà créé. Utilisez
          sa fiche dédiée avant de l'ajouter.
        </p>
      )}

      <input
        type="hidden"
        name="props"
        data-testid="add-block-props"
        value={JSON.stringify(friendlyProps)}
      />
      <div>
        <button type="submit" disabled={isPending || !hasFriendlyForm} style={buttonStyle}>
          {isPending ? "Ajout..." : "Ajouter le bloc"}
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
