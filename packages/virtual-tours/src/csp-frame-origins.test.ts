import { describe, expect, it } from "vitest";
import { listAllProviderFrameOrigins } from "./embed";
import "./providers";

interface NextHeaderEntry {
  key: string;
  value: string;
}
interface NextHeaderGroup {
  source: string;
  headers: NextHeaderEntry[];
}
interface NextConfigModule {
  default: { headers?: () => Promise<NextHeaderGroup[]> };
}

async function headerGroupFromConfig(configUrl: URL): Promise<NextHeaderEntry[]> {
  const { default: config } = (await import(configUrl.href)) as NextConfigModule;
  if (!config.headers) throw new Error(`${configUrl.href} has no headers() function`);
  const groups = await config.headers();
  const first = groups[0]?.headers;
  if (!first) throw new Error(`${configUrl.href} has no headers`);
  return first;
}

async function frameSrcOriginsFromConfig(configUrl: URL): Promise<string[]> {
  const headers = await headerGroupFromConfig(configUrl);
  const csp = headers.find((h) => h.key === "Content-Security-Policy");
  if (!csp) throw new Error(`${configUrl.href} has no Content-Security-Policy header`);
  const match = /frame-src\s+([^;]+);/.exec(csp.value);
  const origins = match?.[1];
  if (!origins) throw new Error(`${configUrl.href}'s CSP header has no frame-src directive`);
  return origins.trim().split(/\s+/);
}

// Both `next.config.mjs` files hardcode a literal frame-src origin list
// (see their own comments for why it can't be a live import of this
// package) — this test is the thing that actually keeps that literal in
// sync with the provider registry, per those comments' own claim. A
// provider added to the registry without updating both `next.config.mjs`
// files fails here, loudly, instead of silently under-restricting or
// over-restricting the CSP.
describe("CSP frame-src stays in sync with the VirtualTour provider registry", () => {
  it("apps/web/next.config.mjs matches the registry", async () => {
    const origins = await frameSrcOriginsFromConfig(
      new URL("../../../apps/web/next.config.mjs", import.meta.url),
    );
    expect(new Set(origins)).toEqual(new Set(listAllProviderFrameOrigins()));
  });

  it("apps/admin/next.config.mjs matches the registry", async () => {
    const origins = await frameSrcOriginsFromConfig(
      new URL("../../../apps/admin/next.config.mjs", import.meta.url),
    );
    expect(new Set(origins)).toEqual(new Set(listAllProviderFrameOrigins()));
  });
});

// v1.0 — brief §23: the general-purpose security headers added alongside
// `frame-src` in both apps. A regression test, not just a manual check —
// a future edit to either next.config.mjs that drops one of these
// silently (e.g. while adding a new header) fails here instead of only
// being caught by someone thinking to check with curl.
describe("general-purpose security headers (v1.0)", () => {
  it.each([
    ["apps/web", new URL("../../../apps/web/next.config.mjs", import.meta.url), "'self'"],
    ["apps/admin", new URL("../../../apps/admin/next.config.mjs", import.meta.url), "'none'"],
  ])(
    "%s sets X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors %s",
    async (_label, url, expectedFrameAncestors) => {
      const headers = await headerGroupFromConfig(url);
      const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));

      expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
      expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(byKey["Permissions-Policy"]).toMatch(/camera=\(\)/);
      expect(byKey["Content-Security-Policy"]).toContain(
        `frame-ancestors ${expectedFrameAncestors};`,
      );
    },
  );
});
