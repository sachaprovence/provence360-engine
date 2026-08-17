// See the identical constant in apps/web/next.config.mjs for why this is a
// literal rather than a live import, and how it's kept in sync with
// `packages/virtual-tours`' provider registry.
const VIRTUAL_TOUR_FRAME_ORIGINS = ["https://my.matterport.com"];

/** @type {import('next').NextConfig} */
const nextConfig = {
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
        // site) as well as any future dedicated Tour-picker preview.
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
