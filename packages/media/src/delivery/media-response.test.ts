import { describe, expect, it } from "vitest";
import type { MediaDeliveryResult } from "./media-delivery-handler";
import { buildMediaDeliveryResponse } from "./media-response";

function makeResult(overrides: Partial<MediaDeliveryResult> = {}): MediaDeliveryResult {
  return {
    body: Buffer.from("fake image bytes"),
    contentType: "image/jpeg",
    immutable: true,
    etag: "a".repeat(64) + "-original",
    ...overrides,
  };
}

describe("buildMediaDeliveryResponse", () => {
  it("GET returns 200 with the body, ETag, Content-Length, and the given Cache-Control", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "GET",
      ifNoneMatch: null,
      cacheControl: "public, max-age=31536000, immutable",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(`"${result.etag}"`);
    expect(response.headers.get("Content-Length")).toBe(String(result.body.byteLength));
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(result.body)).toBe(true);
  });

  it("HEAD returns the same headers as GET but with no body", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "HEAD",
      ifNoneMatch: null,
      cacheControl: "private, no-store",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(result.body.byteLength));
    expect(response.headers.get("ETag")).toBe(`"${result.etag}"`);
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("a matching If-None-Match returns 304, with no body", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "GET",
      ifNoneMatch: `"${result.etag}"`,
      cacheControl: "public, max-age=31536000, immutable",
    });

    expect(response.status).toBe(304);
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("If-None-Match: * always matches, regardless of the actual ETag", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "GET",
      ifNoneMatch: "*",
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(response.status).toBe(304);
  });

  it("a non-matching If-None-Match returns 200 with the real body, not a false 304", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "GET",
      ifNoneMatch: '"some-other-etag-entirely"',
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(response.status).toBe(200);
  });

  it("a comma-separated If-None-Match list matches if ANY entry matches", async () => {
    const result = makeResult();
    const response = buildMediaDeliveryResponse(result, {
      method: "GET",
      ifNoneMatch: `"unrelated-1", "${result.etag}", "unrelated-2"`,
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(response.status).toBe(304);
  });

  it("two different variants of the same asset never share an ETag", () => {
    const original = buildMediaDeliveryResponse(makeResult({ etag: "abc-original" }), {
      method: "GET",
      ifNoneMatch: null,
      cacheControl: "public, max-age=31536000, immutable",
    });
    const thumbnail = buildMediaDeliveryResponse(makeResult({ etag: "abc-thumbnail" }), {
      method: "GET",
      ifNoneMatch: null,
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(original.headers.get("ETag")).not.toBe(thumbnail.headers.get("ETag"));
  });
});
