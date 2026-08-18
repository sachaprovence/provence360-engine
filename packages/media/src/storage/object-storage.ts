/**
 * The narrow storage-provider boundary v0.9's domain code depends on —
 * never an AWS SDK type, never a provider-specific option, anywhere
 * outside `packages/media/src/storage/*`. See ADR 0022, "storage
 * abstraction." Every method takes/returns plain data; a provider adapter
 * translates to/from its own SDK underneath.
 */
export interface ObjectMetadata {
  byteSize: number;
  contentType: string | null;
}

export interface ObjectStorage {
  /** Uploads (overwrites) an object at `key`. */
  putObject(key: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  /** Full bytes, or `null` if nothing exists at `key`. */
  getObject(key: string): Promise<Buffer | null>;
  /** Existence + metadata only, no body transfer — `null` if absent. */
  headObject(key: string): Promise<ObjectMetadata | null>;
  deleteObject(key: string): Promise<void>;
  /**
   * Every key currently stored under `prefix` (v0.9.1 — brief §7, orphan
   * reconciliation: distinguishing a storage-orphan, an object present but
   * unreferenced by any row, requires actually enumerating what storage
   * holds, which no v0.9 method could do). Always tenant-scoped by the
   * caller's own `prefix` (e.g. `tenants/{tenantId}/media/`) — this method
   * itself has no tenant awareness, exactly like every other method here.
   * Not expected to be called from any request-serving path — reconciliation
   * is an operational/diagnostic primitive, not part of upload or delivery.
   */
  listObjects(prefix: string): Promise<string[]>;
}
