// Pure, unit-testable input parsing for
// packages/database/src/scripts/bootstrap-production.ts — split out the
// same way seed-safety.ts is split from scripts/seed.ts, so the validation
// rules (no defaults, minimum password length, a real-looking email) are
// covered by fast unit tests without needing a live database.

export const MIN_PASSWORD_LENGTH = 12;

export interface BootstrapInput {
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
  tenantSlug: string;
  tenantName: string;
  siteSlug: string;
  siteName: string;
  domainHostname: string;
}

function requireEnv(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function parseBootstrapInput(source: NodeJS.ProcessEnv = process.env): BootstrapInput {
  const ownerPassword = requireEnv(source, "BOOTSTRAP_OWNER_PASSWORD");
  if (ownerPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `BOOTSTRAP_OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters — got ${ownerPassword.length}.`,
    );
  }
  const ownerEmail = requireEnv(source, "BOOTSTRAP_OWNER_EMAIL");
  if (!ownerEmail.includes("@")) {
    throw new Error(`BOOTSTRAP_OWNER_EMAIL does not look like an email address: "${ownerEmail}"`);
  }
  return {
    ownerEmail,
    ownerName: requireEnv(source, "BOOTSTRAP_OWNER_NAME"),
    ownerPassword,
    tenantSlug: requireEnv(source, "BOOTSTRAP_TENANT_SLUG"),
    tenantName: requireEnv(source, "BOOTSTRAP_TENANT_NAME"),
    siteSlug: requireEnv(source, "BOOTSTRAP_SITE_SLUG"),
    siteName: requireEnv(source, "BOOTSTRAP_SITE_NAME"),
    domainHostname: requireEnv(source, "BOOTSTRAP_DOMAIN_HOSTNAME"),
  };
}
