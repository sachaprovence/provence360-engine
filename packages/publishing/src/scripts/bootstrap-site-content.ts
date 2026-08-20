import { and, eq } from "drizzle-orm";
import { addBlock, createPage, generateBlockInstanceId, getPageBySlug, updatePageMeta } from "@provence360/content";
import { closeAdminPool, getAdminDb } from "@provence360/database/admin";
import { closeAppPool } from "@provence360/database/client-app";
import { loadDotEnv, sites, tenants } from "@provence360/database";
import { updateSiteNavigation, updateSiteSettings } from "@provence360/sites";
import { withTenantContext } from "@provence360/tenant";
import { publishSite } from "../publish";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

loadDotEnv();

function initialHomeContent(siteName: string) {
  return [
    {
      id: generateBlockInstanceId(),
      type: "hero",
      version: 1,
      props: {
        headline: { fr: siteName },
        subheadline: { fr: "Votre séjour en Provence commence ici." },
        ctaLabel: { fr: "Nous contacter" },
        ctaHref: "/contact",
      },
    },
    {
      id: generateBlockInstanceId(),
      type: "text",
      version: 1,
      props: {
        heading: { fr: "Bienvenue" },
        body: {
          fr: "Découvrez notre univers. Les informations détaillées sur les hébergements et les disponibilités seront publiées ici.",
        },
      },
    },
    {
      id: generateBlockInstanceId(),
      type: "feature-list",
      version: 1,
      props: {
        heading: { fr: "Préparez votre séjour" },
        items: [
          { title: { fr: "Hébergements" }, description: { fr: "Consultez les logements publiés." } },
          { title: { fr: "Expérience" }, description: { fr: "Découvrez les services et équipements disponibles." } },
          { title: { fr: "Contact" }, description: { fr: "Échangez directement avec notre équipe." } },
        ],
      },
    },
    {
      id: generateBlockInstanceId(),
      type: "cta",
      version: 1,
      props: {
        heading: { fr: "Une question sur votre séjour ?" },
        body: { fr: "Contactez-nous pour obtenir des informations fiables et personnalisées." },
        buttonLabel: { fr: "Nous contacter" },
        buttonHref: "/contact",
      },
    },
  ];
}

async function main(): Promise<void> {
  const tenantSlug = required("BOOTSTRAP_TENANT_SLUG");
  const siteSlug = required("BOOTSTRAP_SITE_SLUG");
  const siteName = required("BOOTSTRAP_SITE_NAME");
  const contactEmail = required("BOOTSTRAP_OWNER_EMAIL");
  const adminDb = getAdminDb();

  const [target] = await adminDb
    .select({ tenantId: tenants.id, siteId: sites.id })
    .from(sites)
    .innerJoin(tenants, eq(sites.tenantId, tenants.id))
    .where(and(eq(tenants.slug, tenantSlug), eq(sites.slug, siteSlug)));
  if (!target) throw new Error("The bootstrapped tenant/site could not be found.");

  await withTenantContext(target.tenantId, async (tx) => {
    let home = await getPageBySlug(tx, target.siteId, "");
    if (!home) {
      home = await createPage(tx, {
        siteId: target.siteId,
        slug: "",
        internalName: `Accueil — ${siteName}`,
        pageType: "home",
        status: "active",
        seo: {
          title: { fr: siteName },
          description: {
            fr: "Découvrez nos hébergements et préparez votre séjour en Provence.",
          },
          canonicalPath: "/",
        },
        content: initialHomeContent(siteName),
      });
    } else if ((home.content as unknown[]).length === 0) {
      for (const block of initialHomeContent(siteName)) {
        await addBlock(tx, {
          pageId: home.id,
          type: block.type,
          version: block.version,
          props: block.props,
        });
      }
      home = (await getPageBySlug(tx, target.siteId, "")) ?? home;
    }

    if (home.status !== "active") await updatePageMeta(tx, { id: home.id, status: "active" });

    let contact = await getPageBySlug(tx, target.siteId, "contact");
    if (!contact) {
      contact = await createPage(tx, {
        siteId: target.siteId,
        slug: "contact",
        internalName: `Contact — ${siteName}`,
        pageType: "contact",
        status: "active",
        seo: { title: { fr: `Contact — ${siteName}` }, canonicalPath: "/contact" },
        content: [
          {
            id: generateBlockInstanceId(),
            type: "text",
            version: 1,
            props: {
              heading: { fr: "Nous contacter" },
              body: { fr: `Écrivez-nous à ${contactEmail}.` },
            },
          },
        ],
      });
    }
    if (contact.status !== "active") await updatePageMeta(tx, { id: contact.id, status: "active" });

    await updateSiteSettings(tx, {
      id: target.siteId,
      publicName: siteName,
      contactEmail,
      defaultLocale: "fr",
      enabledLocales: ["fr"],
      timezone: "Europe/Paris",
    });
    await updateSiteNavigation(tx, {
      id: target.siteId,
      navigation: {
        version: 1,
        items: [
          { id: "nav_home", label: { fr: "Accueil" }, target: { kind: "page", pageId: home.id }, children: [] },
          { id: "nav_contact", label: { fr: "Contact" }, target: { kind: "page", pageId: contact.id }, children: [] },
        ],
      },
    });
    await publishSite(tx, { siteId: target.siteId });
  });

  console.log(`Initial content is ready and published for ${tenantSlug}/${siteSlug}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Content bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAdminPool();
    await closeAppPool();
  });
