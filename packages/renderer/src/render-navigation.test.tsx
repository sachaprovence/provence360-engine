import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "@provence360/themes";
import { renderNavigation, type RenderableNavigation } from "./render-navigation";

const tokens = resolveTheme(undefined, {});
const context = { locale: "fr", defaultLocale: "fr", tokens };

describe("renderNavigation", () => {
  it("renders nothing for an empty navigation", () => {
    const nav: RenderableNavigation = { items: [] };
    expect(renderNavigation(nav, context)).toBeNull();
  });

  it("renders an internal page link as a site-relative href, home mapping to /", () => {
    const nav: RenderableNavigation = {
      items: [
        { id: "n1", label: { fr: "Accueil" }, target: { kind: "page", slug: "" }, children: [] },
        {
          id: "n2",
          label: { fr: "Contact" },
          target: { kind: "page", slug: "contact" },
          children: [],
        },
      ],
    };
    const html = renderToStaticMarkup(renderNavigation(nav, context)!);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/contact"');
    expect(html).toContain("Accueil");
    expect(html).toContain("Contact");
  });

  it("renders an external link with target=_blank only when newTab is set", () => {
    const nav: RenderableNavigation = {
      items: [
        {
          id: "n1",
          label: { fr: "Blog" },
          target: { kind: "external", href: "https://blog.example.com", newTab: true },
          children: [],
        },
        {
          id: "n2",
          label: { fr: "Docs" },
          target: { kind: "external", href: "/docs" },
          children: [],
        },
      ],
    };
    const html = renderToStaticMarkup(renderNavigation(nav, context)!);
    expect(html).toContain('href="https://blog.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="/docs"');
  });

  it("renders nested children", () => {
    const nav: RenderableNavigation = {
      items: [
        {
          id: "parent",
          label: { fr: "Parent" },
          target: { kind: "page", slug: "parent" },
          children: [
            {
              id: "child",
              label: { fr: "Enfant" },
              target: { kind: "page", slug: "parent/child" },
              children: [],
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(renderNavigation(nav, context)!);
    expect(html).toContain("Parent");
    expect(html).toContain("Enfant");
    expect(html).toContain('href="/parent/child"');
  });

  it("resolves a label to the requested locale, falling back to the site default", () => {
    const nav: RenderableNavigation = {
      items: [
        { id: "n1", label: { en: "Home" }, target: { kind: "page", slug: "" }, children: [] },
      ],
    };
    const html = renderToStaticMarkup(
      renderNavigation(nav, { locale: "fr", defaultLocale: "en", tokens })!,
    );
    expect(html).toContain("Home");
  });
});
