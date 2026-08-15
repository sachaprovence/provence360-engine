/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@provence360/auth",
    "@provence360/database",
    "@provence360/domains",
    "@provence360/observability",
    "@provence360/sites",
    "@provence360/tenant",
    "@provence360/validation",
  ],
};

export default nextConfig;
