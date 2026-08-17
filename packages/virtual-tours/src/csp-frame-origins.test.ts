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

async function frameSrcOriginsFromConfig(configUrl: URL): Promise<string[]> {
  const { default: config } = (await import(configUrl.href)) as NextConfigModule;
  if (!config.headers) throw new Error(`${configUrl.href} has no headers() function`);
  const groups = await config.headers();
  const csp = groups[0]?.headers.find((h) => h.key === "Content-Security-Policy");
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
