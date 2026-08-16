import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftSummary } from "@provence360/publishing";
import { getSite } from "@provence360/sites";
import { listThemes } from "@provence360/themes";
import { withTenantPage } from "@/lib/actor";
import { SiteSettingsForm } from "./site-settings-form";
import { SiteThemeForm } from "./site-theme-form";

export const dynamic = "force-dynamic";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string; siteId: string }>;
}) {
  const { tenantId, siteId } = await params;

  const {
    site,
    themeList,
    canUpdateSettings,
    canUpdateTheme,
    canReadReleases,
    hasUnpublishedChanges,
  } = await withTenantPage(tenantId, "site.read", async (tx, actor) => {
    const siteRow = await getSite(tx, siteId);
    const themeRows = await listThemes(tx);
    const canReadReleasesNow = actor.permissions.has("release.read");
    return {
      site: siteRow,
      themeList: themeRows,
      canUpdateSettings: actor.permissions.has("site.update"),
      canUpdateTheme: actor.permissions.has("theme.update"),
      canReadReleases: canReadReleasesNow,
      hasUnpublishedChanges:
        siteRow && canReadReleasesNow
          ? (await getDraftSummary(tx, siteId)).hasUnpublishedChanges
          : false,
    };
  });

  if (!site) notFound();

  const base = `/admin/tenants/${tenantId}/sites/${siteId}`;

  return (
    <div>
      <p style={{ fontSize: 13 }}>
        <Link href={`/admin/tenants/${tenantId}/sites`} style={{ color: "#6b7280" }}>
          ← Sites
        </Link>
      </p>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{site.name}</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>{site.slug}</p>

      <nav
        style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 14, alignItems: "center" }}
      >
        <Link href={`${base}/pages`}>Pages</Link>
        <Link href={`${base}/properties`}>Properties</Link>
        {canReadReleases ? (
          <Link href={`${base}/publishing`}>
            Publishing
            {hasUnpublishedChanges ? (
              <span
                title="Unpublished changes"
                style={{
                  marginLeft: 6,
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f59e0b",
                }}
              />
            ) : null}
          </Link>
        ) : null}
      </nav>

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Settings</h2>
      {canUpdateSettings ? (
        <SiteSettingsForm tenantId={tenantId} siteId={siteId} site={site} />
      ) : (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          {site.publicName ?? "—"} · {site.timezone} · {site.defaultLocale}
        </p>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Theme</h2>
      {canUpdateTheme ? (
        <SiteThemeForm
          tenantId={tenantId}
          siteId={siteId}
          currentThemeId={site.themeId}
          currentOverrides={site.themeOverrides}
          themes={themeList}
        />
      ) : (
        <p style={{ color: "#6b7280", fontSize: 14 }}>{site.themeId ?? "no theme selected"}</p>
      )}
    </div>
  );
}
