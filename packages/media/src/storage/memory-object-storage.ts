import type { ObjectMetadata, ObjectStorage } from "./object-storage";

/**
 * A deterministic, in-process `ObjectStorage` — the storage double every
 * unit/integration/E2E test in this repo uses (see ADR 0022, "storage
 * abstraction"). `S3ObjectStorage` itself is additionally covered by a
 * real S3-compatible integration suite (`s3-object-storage.integration.test.ts`,
 * v0.9.1) — this fake is for every *other* test, where a real network
 * round-trip would be pure overhead, never a substitute for that coverage.
 * Each instance owns its own isolated `Map`; tests construct a fresh one
 * per test rather than sharing global state. **Dev/test only — never
 * production** (see `getObjectStorage`'s own doc comment and
 * docs/MEDIA.md, "Storage").
 */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType: opts.contentType });
  }

  async getObject(key: string): Promise<Buffer | null> {
    const entry = this.objects.get(key);
    return entry ? Buffer.from(entry.body) : null;
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    const entry = this.objects.get(key);
    return entry ? { byteSize: entry.body.byteLength, contentType: entry.contentType } : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}
