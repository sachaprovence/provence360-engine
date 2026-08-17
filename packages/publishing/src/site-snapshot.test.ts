import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_BRANDING } from "@provence360/themes";
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

function validV3Snapshot() {
  return {
    schemaVersion: 3,
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
    branding: DEFAULT_SITE_BRANDING,
    pages: [],
    media: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "image",
        storageKey: "tenants/t1/media/original/legacy.jpg",
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        altText: null,
        // No checksumSha256/byteSize/variants — a real pre-v0.9 descriptor
        // (this MediaAsset was never through v0.9's ingestion pipeline).
      },
    ],
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

  // v0.9 — Media Ingestion, Asset Lifecycle & Delivery Kernel (ADR 0022):
  // the SNAPSHOT_SCHEMA_VERSION 3 -> 4 upgrade chain. No shape actually
  // changed (mediaDescriptorSchema's new fields are additive-optional), so
  // a real historical v3 Revision — including one whose media entries
  // predate v0.9 and have no checksum/variants at all — must keep parsing
  // and simply get relabeled schemaVersion 4, never rejected and never
  // silently mutated.
  it("accepts a well-formed v3 snapshot and upgrades it to the current schema version", () => {
    const snapshot = parseSiteSnapshot(validV3Snapshot());
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.branding).toEqual(DEFAULT_SITE_BRANDING);
    expect(snapshot.media).toEqual([
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        storageKey: "tenants/t1/media/original/legacy.jpg",
      }),
    ]);
    // Genuinely absent, not present-but-undefined — a v3 descriptor never
    // had these keys at all.
    expect(snapshot.media?.[0]).not.toHaveProperty("checksumSha256");
    expect(snapshot.media?.[0]).not.toHaveProperty("variants");
  });

  it("accepts a v4 snapshot whose media descriptors carry v0.9 fingerprint/variant data", () => {
    const v4 = {
      ...validV3Snapshot(),
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      media: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "image",
          storageKey: "tenants/t1/media/original/hero.jpg",
          mimeType: "image/jpeg",
          width: 2000,
          height: 1200,
          altText: "A villa at sunset",
          checksumSha256: "a".repeat(64),
          byteSize: 123_456,
          variants: {
            thumbnail: {
              storageKey: "tenants/t1/media/variants/hero-thumbnail.jpg",
              width: 320,
              height: 192,
              byteSize: 12_000,
            },
          },
        },
      ],
    };
    const snapshot = parseSiteSnapshot(v4);
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.media?.[0]?.checksumSha256).toBe("a".repeat(64));
    expect(snapshot.media?.[0]?.variants?.thumbnail?.width).toBe(320);
  });

  it("rejects a v4 snapshot with a malformed checksumSha256 (not a 64-char lowercase hex digest)", () => {
    const v4 = {
      ...validV3Snapshot(),
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      media: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "image",
          storageKey: "tenants/t1/media/original/bad.jpg",
          mimeType: "image/jpeg",
          width: 100,
          height: 100,
          altText: null,
          checksumSha256: "not-a-real-digest",
        },
      ],
    };
    expect(() => parseSiteSnapshot(v4)).toThrow(InvalidSnapshotError);
  });
});
