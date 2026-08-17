import { describe, expect, it } from "vitest";
import {
  buildOriginalStorageKey,
  buildUploadStorageKey,
  buildVariantStorageKey,
} from "./object-keys";

const TENANT_A = "01a00000-0000-7000-8000-00000000000a";
const TENANT_B = "01a00000-0000-7000-8000-00000000000b";

describe("buildUploadStorageKey", () => {
  it("is namespaced under the given tenant id", () => {
    expect(buildUploadStorageKey(TENANT_A)).toContain(`tenants/${TENANT_A}/`);
  });

  it("never produces the same key twice, even for the same tenant", () => {
    const a = buildUploadStorageKey(TENANT_A);
    const b = buildUploadStorageKey(TENANT_A);
    expect(a).not.toBe(b);
  });

  it("two different tenants can never collide on a key", () => {
    const a = buildUploadStorageKey(TENANT_A);
    const b = buildUploadStorageKey(TENANT_B);
    expect(a).not.toBe(b);
    expect(a.startsWith(`tenants/${TENANT_A}/`)).toBe(true);
    expect(b.startsWith(`tenants/${TENANT_B}/`)).toBe(true);
  });

  it("never depends on a filename or any other caller-supplied string", () => {
    // The function signature itself is the guarantee — it accepts only a
    // tenantId, nothing else could be threaded through even by mistake.
    expect(buildUploadStorageKey.length).toBe(1);
  });
});

describe("buildOriginalStorageKey / buildVariantStorageKey", () => {
  it("are namespaced under the tenant and the media asset id", () => {
    const original = buildOriginalStorageKey(TENANT_A, "asset-1");
    expect(original).toBe(`tenants/${TENANT_A}/media/asset-1/original`);
  });

  it("variant keys are distinct per variant token", () => {
    const thumb = buildVariantStorageKey(TENANT_A, "asset-1", "thumbnail");
    const large = buildVariantStorageKey(TENANT_A, "asset-1", "large");
    expect(thumb).not.toBe(large);
  });
});
