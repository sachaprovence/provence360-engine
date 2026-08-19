import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, parseBootstrapInput } from "./bootstrap-input";

const VALID_ENV = {
  BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
  BOOTSTRAP_OWNER_NAME: "Jane Owner",
  BOOTSTRAP_OWNER_PASSWORD: "a-real-strong-password-123",
  BOOTSTRAP_TENANT_SLUG: "my-tenant",
  BOOTSTRAP_TENANT_NAME: "My Tenant",
  BOOTSTRAP_SITE_SLUG: "my-site",
  BOOTSTRAP_SITE_NAME: "My Site",
  BOOTSTRAP_DOMAIN_HOSTNAME: "my-app.up.railway.app",
};

describe("parseBootstrapInput — SUJET H production bootstrap", () => {
  it("parses a fully-specified, valid environment", () => {
    expect(parseBootstrapInput(VALID_ENV)).toEqual({
      ownerEmail: "owner@example.com",
      ownerName: "Jane Owner",
      ownerPassword: "a-real-strong-password-123",
      tenantSlug: "my-tenant",
      tenantName: "My Tenant",
      siteSlug: "my-site",
      siteName: "My Site",
      domainHostname: "my-app.up.railway.app",
    });
  });

  it("refuses a password shorter than the minimum — never a weak default-strength secret", () => {
    expect(() =>
      parseBootstrapInput({ ...VALID_ENV, BOOTSTRAP_OWNER_PASSWORD: "short" }),
    ).toThrow(/at least 12 characters/);
  });

  it(`accepts a password of exactly the minimum length (${MIN_PASSWORD_LENGTH})`, () => {
    const exactLength = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(() =>
      parseBootstrapInput({ ...VALID_ENV, BOOTSTRAP_OWNER_PASSWORD: exactLength }),
    ).not.toThrow();
  });

  it("refuses an email with no @ sign", () => {
    expect(() =>
      parseBootstrapInput({ ...VALID_ENV, BOOTSTRAP_OWNER_EMAIL: "not-an-email" }),
    ).toThrow(/does not look like an email address/);
  });

  it.each([
    "BOOTSTRAP_OWNER_EMAIL",
    "BOOTSTRAP_OWNER_NAME",
    "BOOTSTRAP_OWNER_PASSWORD",
    "BOOTSTRAP_TENANT_SLUG",
    "BOOTSTRAP_TENANT_NAME",
    "BOOTSTRAP_SITE_SLUG",
    "BOOTSTRAP_SITE_NAME",
    "BOOTSTRAP_DOMAIN_HOSTNAME",
  ])("refuses when %s is missing — never assumes a default", (missingKey) => {
    const env = { ...VALID_ENV };
    delete (env as Record<string, string | undefined>)[missingKey];
    expect(() => parseBootstrapInput(env)).toThrow(
      new RegExp(`Missing required environment variable: ${missingKey}`),
    );
  });

  it("refuses when a required variable is present but blank", () => {
    expect(() => parseBootstrapInput({ ...VALID_ENV, BOOTSTRAP_TENANT_SLUG: "   " })).toThrow(
      /Missing required environment variable: BOOTSTRAP_TENANT_SLUG/,
    );
  });

  it("defaults to process.env when no source is given", () => {
    const previous = { ...process.env };
    try {
      for (const [key, value] of Object.entries(VALID_ENV)) {
        process.env[key] = value;
      }
      expect(() => parseBootstrapInput()).not.toThrow();
    } finally {
      process.env = previous;
    }
  });
});
