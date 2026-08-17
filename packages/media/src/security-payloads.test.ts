import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, ensureTestDatabaseReady, resetDatabase } from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { MediaDecodeError } from "./errors";
import { createMediaUploadIntent } from "./repository/media-upload-repository";
import { finalizeMediaUpload } from "./upload/finalize";
import { MemoryObjectStorage } from "./storage/memory-object-storage";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 3, g: 3, b: 3 } },
  })
    .jpeg()
    .toBuffer();
}

// v0.9 upload security payload audit (brief §22) — the specific cases not
// already covered by `validation/image-validation.test.ts` (forged
// extension/MIME, empty/oversized/corrupted files, SVG, wrong-format) or
// `upload/finalize.test.ts` (double finalize, expired/cross-tenant
// intents). This file proves the remaining named cases end to end through
// the real two-phase upload pipeline: a hostile `originalFilename` (path
// traversal, embedded HTML/script, a null byte) never reaches the storage
// key or any filesystem path, and a forged `declaredMimeType` never
// substitutes for the real, decoded content type.
describe("upload security payloads", () => {
  it("a path-traversal originalFilename is stored as inert display text and never influences the storage key", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();
    const maliciousFilename = "../../../../etc/passwd";

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, {
        maxBytes: bytes.byteLength + 1,
        originalFilename: maliciousFilename,
      });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    // Stored verbatim, as plain text metadata — never parsed as a path.
    expect(asset.originalFilename).toBe(maliciousFilename);
    // The real storage key is always the server-generated, opaque
    // `tenants/{tenantId}/media/{uuid}/original` shape (buildOriginalStorageKey)
    // — no path segment derived from the filename anywhere in it.
    expect(asset.storageKey).toMatch(
      new RegExp(`^tenants/${tenant.id}/media/[0-9a-f-]+/original$`),
    );
    expect(asset.storageKey).not.toContain("..");
    expect(asset.storageKey).not.toContain("etc/passwd");
  });

  it("an HTML/script-embedded originalFilename is stored as inert text, not executed or unescaped anywhere in the pipeline", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();
    const maliciousFilename = "<img src=x onerror=alert(1)><script>alert(document.cookie)</script>";

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, {
        maxBytes: bytes.byteLength + 1,
        originalFilename: maliciousFilename,
      });
      await storage.putObject(intent.storageKey, bytes, { contentType: "image/jpeg" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    // The repository/DB layer makes no attempt to sanitize or interpret
    // this string — it's opaque display metadata. Escaping on render is
    // the Admin UI's job (React's default text-node escaping — this
    // string is never dangerouslySetInnerHTML'd anywhere in this
    // codebase), not the ingestion pipeline's.
    expect(asset.originalFilename).toBe(maliciousFilename);
    expect(asset.storageKey).not.toContain("<script>");
    expect(asset.storageKey).not.toContain("onerror");
  });

  it('a null byte in originalFilename (classic extension-bypass payload, e.g. "evil.jpg\\0.exe") is rejected outright by Postgres itself, never silently truncated or stored', async () => {
    const tenant = await createTenant();
    // A NUL byte is not valid inside a Postgres `text` value at all — a
    // genuine defense-in-depth property discovered while writing this
    // test (no application-level sanitization strips it; Postgres's own
    // wire protocol refuses the value before it's ever stored). Asserted
    // here rather than merely assumed.
    const maliciousFilename = "evil.jpg\0.exe";

    let thrown: unknown;
    try {
      await withTenantContext(tenant.id, (tx) =>
        createMediaUploadIntent(tx, { maxBytes: 1000, originalFilename: maliciousFilename }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    // drizzle wraps the driver error as "Failed query: ..."; the real
    // Postgres complaint ("invalid byte sequence for encoding \"UTF8\":
    // 0x00") is on `.cause`.
    const cause = thrown instanceof Error ? thrown.cause : undefined;
    expect(String(cause instanceof Error ? cause.message : cause)).toMatch(
      /invalid byte sequence/i,
    );
  });

  it("a forged declaredMimeType never overrides the real, decoded content type", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const bytes = await makeJpeg();

    const asset = await withTenantContext(tenant.id, async (tx) => {
      const intent = await createMediaUploadIntent(tx, {
        maxBytes: bytes.byteLength + 1,
        // Client claims this is a plain text file — the real bytes are a JPEG.
        declaredMimeType: "text/plain",
      });
      await storage.putObject(intent.storageKey, bytes, { contentType: "text/plain" });
      return finalizeMediaUpload(tx, storage, intent.id);
    });

    // finalizeMediaUpload never even reads `declaredMimeType` when
    // deciding the asset's real `mimeType` — it's informative-only,
    // exactly like `originalFilename`.
    expect(asset.mimeType).toBe("image/jpeg");
  });

  it("a forged declaredMimeType claiming image/jpeg provides no bypass for genuinely non-image bytes", async () => {
    const tenant = await createTenant();
    const storage = new MemoryObjectStorage();
    const notAnImage = Buffer.from("plain text pretending, via declaredMimeType, to be a JPEG");

    await expect(
      withTenantContext(tenant.id, async (tx) => {
        const intent = await createMediaUploadIntent(tx, {
          maxBytes: 1000,
          declaredMimeType: "image/jpeg",
        });
        await storage.putObject(intent.storageKey, notAnImage, { contentType: "image/jpeg" });
        return finalizeMediaUpload(tx, storage, intent.id);
      }),
    ).rejects.toThrow(MediaDecodeError);
  });
});
