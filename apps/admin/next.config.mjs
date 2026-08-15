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
  ],
};

export default nextConfig;
