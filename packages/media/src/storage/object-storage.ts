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
}
