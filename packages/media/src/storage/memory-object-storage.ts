import type { ObjectMetadata, ObjectStorage } from "./object-storage";

/**
 * A deterministic, in-process `ObjectStorage` — the storage double every
 * unit/integration/E2E test in this repo uses (see ADR 0022, "storage
 * abstraction": this sandboxed CI environment has no Docker/MinIO
 * available, so a real S3-compatible integration test is out of reach
 * here — a disclosed, deliberate limitation, not an oversight). Each
 * instance owns its own isolated `Map`; tests construct a fresh one per
 * test rather than sharing global state.
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
}
