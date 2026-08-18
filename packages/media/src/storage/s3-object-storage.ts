import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

// v1.0.1 — brief SUJET B: through v1.0, this class never bounded how long a
// single request could take — `@smithy/node-http-handler`'s own defaults
// for `connectionTimeout`/`requestTimeout` are `undefined` (no timeout at
// all), confirmed by reading its source. Combined with the
// virtual-hosted-style DNS failure mode fixed in
// `packages/validation/src/env.ts` (a hostname that will never resolve has
// no inherent ceiling on how long that failure takes), a single stalled
// `put`/`get` could hang a request handler indefinitely — in the smoke
// script, in a real upload/finalize path, in anything that calls this
// class. These are deliberately generous (media payloads run up to the
// package's own 15 MiB `MAX_UPLOAD_BYTES` ceiling — see
// `packages/media/src/domain/constants.ts`) — the goal is "every call
// eventually fails with a clear error" as a floor, not a tight SLA.
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The one place any S3 SDK call lives (brief §4: "ne disperse jamais des
 * appels SDK S3 dans le repository"). Works against real AWS S3 or any
 * genuinely S3-API-compatible provider (Cloudflare R2, MinIO, ...) purely
 * through `endpoint`/`forcePathStyle` — no provider-specific branch inside
 * this class.
 *
 * Exercised against a real S3-compatible HTTP server (v0.9.1) — see
 * `s3-object-storage.integration.test.ts`, run as part of this package's
 * normal `vitest run` (no separate CI stage, no opt-in flag: it spins up
 * its own in-process `s3rver` and tears it down, so it's exactly as
 * deterministic and self-contained as any other test here). MinIO
 * (Docker) was tried first per ADR 0022/the v0.9.1 brief's preference, but
 * pulling any image is blocked by this environment's own egress policy;
 * `s3rver` (a real, maintained S3-REST-API server, not a mock of this
 * class or the AWS SDK) is the documented substitute — see that test
 * file's own doc comment and the v0.9.1 report's LIMITATIONS section for
 * exactly what this does and doesn't prove versus real MinIO/AWS S3/R2.
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
      requestHandler: {
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
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

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of result.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
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
