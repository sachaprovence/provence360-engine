import { describe, expect, it } from "vitest";
import {
  InvalidSnapshotError,
  UnknownSnapshotVersionError,
  parseSiteSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
} from "./site-snapshot";

const validTheme = {
  themeId: null,
  tokens: {
    "color.background": "#fff",
    "color.surface": "#eee",
    "color.text": "#111",
    "color.muted": "#666",
    "color.primary": "#000",
    "color.primaryContrast": "#fff",
    "color.accent": "#333",
    "font.heading": "sans-serif",
    "font.body": "sans-serif",
    "radius.small": "4px",
    "radius.medium": "8px",
    "radius.large": "16px",
    "spacing.small": "8px",
    "spacing.medium": "16px",
    "spacing.large": "32px",
    "shadow.small": "0 1px 2px #000",
    "shadow.medium": "0 4px 12px #000",
    "container.narrow": "640px",
    "container.wide": "1200px",
  },
};

function validV2Snapshot() {
  return {
    schemaVersion: 2,
    site: {
      name: "Test Site",
      publicName: null,
      timezone: "Europe/Paris",
      defaultLocale: "fr",
      enabledLocales: ["fr"],
      contactEmail: null,
      contactPhone: null,
      navigation: { items: [] },
      features: {},
    },
    theme: validTheme,
    pages: [],
    media: [],
  };
}

function legacyV1Snapshot() {
  return {
    site: {
      name: "Legacy Site",
      publicName: null,
      timezone: "Europe/Paris",
      defaultLocale: "fr",
      enabledLocales: ["fr"],
      contactEmail: null,
      contactPhone: null,
      navigation: [], // the pre-v0.5 raw column default, never validated
      features: {},
    },
    theme: validTheme,
    pages: [
      {
        slug: "",
        internalName: "Home",
        pageType: "home",
        seo: {},
        content: [{ id: "b1", type: "text", version: 1, props: { body: { fr: "hi" } } }],
      },
    ],
  };
}

describe("parseSiteSnapshot", () => {
  it("accepts a well-formed v2 snapshot", () => {
    const snapshot = parseSiteSnapshot(validV2Snapshot());
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.media).toEqual([]);
  });

  it("rejects a malformed snapshot (missing required fields)", () => {
    expect(() => parseSiteSnapshot({ schemaVersion: 2 })).toThrow(InvalidSnapshotError);
  });

  it("rejects a non-object value outright", () => {
    expect(() => parseSiteSnapshot(null)).toThrow(InvalidSnapshotError);
    expect(() => parseSiteSnapshot("not a snapshot")).toThrow(InvalidSnapshotError);
    expect(() => parseSiteSnapshot(42)).toThrow(InvalidSnapshotError);
  });

  it("rejects an unknown schemaVersion, deterministically and fail-closed", () => {
    const future = { ...validV2Snapshot(), schemaVersion: 999 };
    expect(() => parseSiteSnapshot(future)).toThrow(UnknownSnapshotVersionError);
  });

  it("accepts and normalizes a legacy (v0.4, no schemaVersion) snapshot", () => {
    const snapshot = parseSiteSnapshot(legacyV1Snapshot());
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    // Legacy navigation is never guessed at — normalizes to empty, not an error.
    expect(snapshot.site.navigation).toEqual({ items: [] });
    // No frozen media manifest existed pre-v0.5 — `media` stays absent
    // (not an empty array), which is the renderer's own signal to fall
    // back to a live lookup for that Revision only (see resolve-media.ts).
    expect(snapshot.media).toBeUndefined();
    expect(snapshot.pages).toHaveLength(1);
  });

  it("rejects a legacy-shaped document that is ALSO malformed (not silently accepted just because schemaVersion is absent)", () => {
    const broken = legacyV1Snapshot();
    // @ts-expect-error deliberately corrupting a required field for the test
    broken.site.name = 12345;
    expect(() => parseSiteSnapshot(broken)).toThrow(InvalidSnapshotError);
  });

  it("never returns a value without going through validation — every field of the parsed result is exactly what was asked for, not a wider passthrough", () => {
    const raw = { ...validV2Snapshot(), extraUnexpectedField: "should not appear" };
    const snapshot = parseSiteSnapshot(raw);
    expect(snapshot).not.toHaveProperty("extraUnexpectedField");
  });
});
