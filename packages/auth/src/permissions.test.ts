import { describe, expect, it } from "vitest";
import {
  can,
  getPermissionsForRole,
  PERMISSIONS,
  PermissionDeniedError,
  requirePermission,
} from "./permissions";

describe("getPermissionsForRole", () => {
  it("owner has every permission in the catalog", () => {
    const granted = getPermissionsForRole("owner");
    for (const permission of PERMISSIONS) {
      expect(granted.has(permission)).toBe(true);
    }
  });

  it("admin lacks tenant.update and billing.*", () => {
    const granted = getPermissionsForRole("admin");
    expect(granted.has("tenant.update")).toBe(false);
    expect(granted.has("billing.read")).toBe(false);
    expect(granted.has("billing.manage")).toBe(false);
  });

  it("admin can still manage members and sites", () => {
    const granted = getPermissionsForRole("admin");
    expect(granted.has("member.invite")).toBe(true);
    expect(granted.has("member.update")).toBe(true);
    expect(granted.has("member.remove")).toBe(true);
    expect(granted.has("site.create")).toBe(true);
    expect(granted.has("domain.create")).toBe(true);
  });

  it("member is read-only and additionally lacks audit.read", () => {
    const granted = getPermissionsForRole("member");
    expect(granted.has("tenant.read")).toBe(true);
    expect(granted.has("site.read")).toBe(true);
    expect(granted.has("domain.read")).toBe(true);
    expect(granted.has("audit.read")).toBe(false);
    expect(granted.has("member.invite")).toBe(false);
    expect(granted.has("site.create")).toBe(false);
    expect(granted.has("tenant.update")).toBe(false);
  });
});

describe("can", () => {
  it("matches getPermissionsForRole for every role/permission pair", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const granted = getPermissionsForRole(role);
      for (const permission of PERMISSIONS) {
        expect(can(role, permission)).toBe(granted.has(permission));
      }
    }
  });
});

describe("requirePermission", () => {
  it("does not throw when the role holds the permission", () => {
    expect(() => requirePermission("owner", "billing.manage")).not.toThrow();
    expect(() => requirePermission("member", "site.read")).not.toThrow();
  });

  it("throws PermissionDeniedError when the role lacks the permission", () => {
    expect(() => requirePermission("member", "site.create")).toThrow(PermissionDeniedError);
    expect(() => requirePermission("admin", "tenant.update")).toThrow(PermissionDeniedError);
    expect(() => requirePermission("admin", "billing.manage")).toThrow(PermissionDeniedError);
  });

  it("the thrown error identifies the missing permission", () => {
    try {
      requirePermission("member", "member.invite");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).permission).toBe("member.invite");
    }
  });
});
