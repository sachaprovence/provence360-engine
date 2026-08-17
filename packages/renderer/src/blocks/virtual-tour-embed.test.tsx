import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FALLBACK_THEME_TOKENS } from "@provence360/themes";
import { VirtualTourEmbed } from "./virtual-tour-embed";

// `VirtualTourEmbed` is a `"use client"` component, but that directive has
// no effect outside Next's own RSC bundler — calling it as a plain
// function and rendering with `renderToStaticMarkup` executes exactly the
// JSX its initial (always-`idle`, since `useReducer`'s initial state is
// fixed) render produces. `useEffect` never runs under
// `renderToStaticMarkup`, so this captures precisely what a visitor's
// browser receives from the server before any client JS has hydrated —
// the click, timeout, retry, and focus-management behavior that only
// exists once real event/timer/DOM handling is involved is covered by
// `apps/web/e2e/virtual-tour.spec.ts` instead (this repo deliberately has
// no jsdom/RTL — see ADR 0020).
function renderIdle(props: Partial<Parameters<typeof VirtualTourEmbed>[0]> = {}) {
  return renderToStaticMarkup(
    <VirtualTourEmbed
      title="Visite virtuelle — Villa Panoramique"
      src="https://my.matterport.com/show/?m=abc12345678"
      allowFullscreen={true}
      posterUrl={null}
      aspectRatioPadding="56.25%"
      tokens={FALLBACK_THEME_TOKENS}
      locale="fr"
      {...props}
    />,
  );
}

describe("VirtualTourEmbed (idle / initial server render)", () => {
  it("never renders an <iframe> before interaction", () => {
    expect(renderIdle()).not.toContain("<iframe");
  });

  it("never leaks the provider src anywhere in the idle markup", () => {
    expect(renderIdle()).not.toContain("matterport.com");
  });

  it("renders the exact French CTA label required by the brief", () => {
    expect(renderIdle({ locale: "fr" })).toContain("Démarrer la visite virtuelle");
  });

  it("renders an English CTA label when locale is English", () => {
    const html = renderIdle({ locale: "en" });
    expect(html).toContain("Start the virtual tour");
    expect(html).not.toContain("Démarrer la visite virtuelle");
  });

  it('the trigger is a real, natively keyboard-operable <button type="button">', () => {
    const html = renderIdle();
    expect(html).toMatch(/<button type="button"[^>]*>/);
  });

  it('exposes a contextualized, non-generic accessible name on the region — never bare "iframe"/"Matterport"', () => {
    const html = renderIdle({ title: "Visite virtuelle — Villa Panoramique" });
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Visite virtuelle — Villa Panoramique"');
    expect(html.toLowerCase()).not.toContain('aria-label="iframe"');
    expect(html.toLowerCase()).not.toContain('aria-label="matterport"');
  });

  it("the region is programmatically focusable (tabIndex=-1) but not in the natural tab order", () => {
    const html = renderIdle();
    expect(html).toContain('tabindex="-1"');
  });

  it("renders no aria-live region and no alert while idle (nothing is loading or has failed yet)", () => {
    const html = renderIdle();
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="alert"');
  });

  it("uses the poster image as the surface background when one is resolved", () => {
    const html = renderIdle({ posterUrl: "tenants/acme/poster.jpg" });
    expect(html).toContain("tenants/acme/poster.jpg");
  });

  it("falls back to a plain theme-token surface color, with no remote image, when no poster is available", () => {
    const html = renderIdle({ posterUrl: null });
    expect(html).not.toContain("url(");
  });

  it("two independently-configured instances render independently (no shared/global state)", () => {
    const first = renderIdle({ title: "Visite virtuelle — Villa A", posterUrl: null });
    const second = renderIdle({
      title: "Visite virtuelle — Villa B",
      posterUrl: "tenants/acme/villa-b.jpg",
    });
    expect(first).toContain("Villa A");
    expect(first).not.toContain("Villa B");
    expect(second).toContain("Villa B");
    expect(second).toContain("tenants/acme/villa-b.jpg");
    expect(first).not.toContain("tenants/acme/villa-b.jpg");
  });
});
