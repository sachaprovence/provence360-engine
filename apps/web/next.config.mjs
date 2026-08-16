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
  ],
};

export default nextConfig;
