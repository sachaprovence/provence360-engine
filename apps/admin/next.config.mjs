// See the identical constant in apps/web/next.config.mjs for why this is a
// literal rather than a live import, and how it's kept in sync with
// `packages/virtual-tours`' provider registry.
const VIRTUAL_TOUR_FRAME_ORIGINS = ["https://my.matterport.com"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // v1.0: see the identical option in apps/web/next.config.mjs.
  output: "standalone",
  transpilePackages: [
    "@provence360/auth",
    "@provence360/content",
    "@provence360/database",
    "@provence360/domains",
    "@provence360/observability",
    "@provence360/rentals",
    "@provence360/sites",
    "@provence360/tenant",
    "@provence360/themes",
    "@provence360/validation",
    "@provence360/virtual-tours",
  ],
  async headers() {
    return [
      {
        // Covers the admin editor's own Draft preview rendering (which
        // uses the exact same `virtual-tour@1` renderer as the public
        // site) as well as any future dedicated Tour-picker preview. v1.0
        // (brief §23): see apps/web/next.config.mjs for the full rationale
        // on the headers added alongside `frame-src`. `frame-ancestors
        // 'none'` here (stricter than web's `'self'`) — a control-plane
        // application with real session cookies has an even sharper
        // clickjacking incentive against it than the public site does, and
        // no legitimate reason to ever be iframed, including by itself.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-src ${VIRTUAL_TOUR_FRAME_ORIGINS.join(" ")}; frame-ancestors 'none';`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
