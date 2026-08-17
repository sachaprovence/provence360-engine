import { describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "./memory-object-storage";

describe("MemoryObjectStorage", () => {
  it("round-trips a put object through get/head", async () => {
    const storage = new MemoryObjectStorage();
    const body = Buffer.from("hello world");
    await storage.putObject("k1", body, { contentType: "text/plain" });

    expect(await storage.getObject("k1")).toEqual(body);
    expect(await storage.headObject("k1")).toEqual({
      byteSize: body.byteLength,
      contentType: "text/plain",
    });
  });

  it("returns null for a key that was never written", async () => {
    const storage = new MemoryObjectStorage();
    expect(await storage.getObject("missing")).toBeNull();
    expect(await storage.headObject("missing")).toBeNull();
  });

  it("delete removes the object", async () => {
    const storage = new MemoryObjectStorage();
    await storage.putObject("k1", Buffer.from("x"), { contentType: "text/plain" });
    await storage.deleteObject("k1");
    expect(await storage.getObject("k1")).toBeNull();
  });

  it("deleting an absent key is a no-op, never throws", async () => {
    const storage = new MemoryObjectStorage();
    await expect(storage.deleteObject("never-existed")).resolves.toBeUndefined();
  });

  it("two instances are fully isolated from each other", async () => {
    const a = new MemoryObjectStorage();
    const b = new MemoryObjectStorage();
    await a.putObject("k", Buffer.from("only in a"), { contentType: "text/plain" });
    expect(await b.getObject("k")).toBeNull();
  });

  it("overwriting a key replaces the previous bytes", async () => {
    const storage = new MemoryObjectStorage();
    await storage.putObject("k", Buffer.from("first"), { contentType: "text/plain" });
    await storage.putObject("k", Buffer.from("second"), { contentType: "text/plain" });
    expect((await storage.getObject("k"))?.toString()).toBe("second");
  });
});
