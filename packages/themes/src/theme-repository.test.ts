import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTheme,
  ensureTestDatabaseReady,
  resetDatabase,
} from "@provence360/testkit";
import { withTenantContext } from "@provence360/tenant";
import { getTheme, listThemes } from "./theme-repository";

beforeAll(async () => {
  await ensureTestDatabaseReady();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("listThemes / getTheme", () => {
  it("returns the shared catalog to any tenant context — themes are not tenant-scoped", async () => {
    const tenant = await createTenant();
    await createTheme({ key: "provence" });
    await createTheme({ key: "luberon" });

    const list = await withTenantContext(tenant.id, (tx) => listThemes(tx));
    expect(list.map((t) => t.key).sort()).toEqual(["luberon", "provence"]);
  });

  it("excludes deprecated themes from listThemes", async () => {
    const tenant = await createTenant();
    await createTheme({ key: "active-theme", status: "active" });
    await createTheme({ key: "old-theme", status: "deprecated" });

    const list = await withTenantContext(tenant.id, (tx) => listThemes(tx));
    expect(list.map((t) => t.key)).toEqual(["active-theme"]);
  });

  it("getTheme resolves a single theme by id, visible to any tenant", async () => {
    const tenant = await createTenant();
    const theme = await createTheme({ key: "provence" });

    const found = await withTenantContext(tenant.id, (tx) => getTheme(tx, theme.id));
    expect(found?.key).toBe("provence");
  });
});
