import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectMetadata, ObjectStorage } from "./object-storage";

export interface S3ObjectStorageConfig {
  bucket: string;
  region: string;
  /** Set for any S3-compatible provider that isn't AWS itself (R2, MinIO, ...). Omit for real AWS S3. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO/most non-AWS S3-compatible providers require path-style addressing. */
  forcePathStyle?: boolean;
}

/**
 * The one place any S3 SDK call lives (brief §4: "ne disperse jamais des
 * appels SDK S3 dans le repository"). Works against real AWS S3 or any
 * genuinely S3-API-compatible provider (Cloudflare R2, MinIO, ...) purely
 * through `endpoint`/`forcePathStyle` — no provider-specific branch inside
 * this class.
 *
 * Not exercised against a live bucket by this repo's test suite: this
 * sandboxed environment has no Docker/MinIO available to stand up a real
 * S3-compatible endpoint (see ADR 0022, "storage abstraction," and
 * `MemoryObjectStorage`'s own doc comment). It is exercised by TypeScript
 * (the `ObjectStorage` contract) and is a small, direct, SDK-call-per-
 * method wrapper with no independent logic of its own to unit-test
 * meaningfully without a real or mocked HTTP layer — a disclosed,
 * deliberate limitation, not an oversight.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotFound" || error.name === "NoSuchKey")
  );
}
