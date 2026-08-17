// The exact set of origins every registered VirtualTour provider's embeds
// can be served from (`packages/virtual-tours/src/providers/*.ts`'s own
// `frameOrigins`). A literal, not a live import: `next.config.mjs` is
// loaded directly by Node before Next's own TypeScript pipeline exists, so
// it cannot import a raw-TypeScript workspace package the way application
// code does (see the `transpilePackages` comment below). Kept in sync with
// the registry by a dedicated test — see
// `packages/virtual-tours/src/csp-frame-origins.test.ts` — rather than by
// hand-auditing; a provider added without updating this list fails that
// test, not silently. No wildcards: exactly the origin(s) each provider's
// own official embed documentation specifies.
const VIRTUAL_TOUR_FRAME_ORIGINS = ["https://my.matterport.com"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TypeScript (no build step of their own —
  // see docs/ARCHITECTURE.md on why), so Next has to transpile them itself.
  transpilePackages: [
    "@provence360/content",
    "@provence360/database",
    "@provence360/domains",
    "@provence360/rentals",
    "@provence360/renderer",
    "@provence360/tenant",
    "@provence360/themes",
    "@provence360/validation",
    "@provence360/virtual-tours",
  ],
  async headers() {
    return [
      {
        // Every route — a `virtual-tour@1` block can appear on any
        // published Page (section 6/22 of the v0.7 brief). This directive
        // only ever restricts `frame-src`; no other directive is set here,
        // so nothing else about this app's existing behavior (inline
        // `style={{...}}`, etc.) is affected.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-src ${VIRTUAL_TOUR_FRAME_ORIGINS.join(" ")};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
