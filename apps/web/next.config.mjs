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
  // v1.0: a trace-based, self-contained build output — the Docker runtime
  // image copies only `.next/standalone` + `.next/static`, not the full
  // `node_modules` tree. See docs/DEPLOYMENT.md, "Containerization".
  output: "standalone",
  // Workspace packages ship raw TypeScript (no build step of their own —
  // see docs/ARCHITECTURE.md on why), so Next has to transpile them itself.
  transpilePackages: [
    "@provence360/content",
    "@provence360/database",
    "@provence360/domains",
    // v1.0: pulled in directly by instrumentation.ts's startup logging.
    "@provence360/observability",
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
        // published Page (section 6/22 of the v0.7 brief). v1.0 (brief
        // §23) adds the general-purpose headers below `frame-src` — one
        // single CSP header with both directives, not two separate CSP
        // headers (browsers intersect/AND multiple CSP headers, which
        // would be confusing to reason about here, not additive the way a
        // second header might look). `frame-ancestors 'self'` is new: this
        // public site is never meant to be iframed by another origin — no
        // stated requirement for that, and it closes a real clickjacking
        // surface. Nothing about the pre-existing `frame-src` allowlist
        // changes.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-src ${VIRTUAL_TOUR_FRAME_ORIGINS.join(" ")}; frame-ancestors 'self';`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Only under NODE_ENV=production: local dev serves over plain
          // HTTP, and HSTS would otherwise tell the browser to force HTTPS
          // for a dev server that has none. A real production deployment
          // is assumed to be TLS-terminated (see docs/DEPLOYMENT.md,
          // "Domains & TLS") — this header is what tells returning
          // visitors' browsers to enforce that themselves.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
