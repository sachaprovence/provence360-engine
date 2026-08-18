#!/usr/bin/env node
// v1.0 — brief §19: a lightweight, no-browser smoke test for a *deployed*
// environment — not a substitute for the full Playwright E2E suite, and
// deliberately mutates nothing. See docs/DEPLOYMENT.md, "Runbook".
//
// Usage:
//   node scripts/smoke-deployment.mjs --base-url=https://your-domain
// or:
//   BASE_URL=https://your-domain node scripts/smoke-deployment.mjs

const args = process.argv.slice(2);
const baseUrlArg = args.find((a) => a.startsWith("--base-url="))?.split("=")[1];
const baseUrl = baseUrlArg ?? process.env.BASE_URL;

if (!baseUrl) {
  console.error("Usage: node scripts/smoke-deployment.mjs --base-url=https://your-domain");
  console.error("   or: BASE_URL=https://your-domain node scripts/smoke-deployment.mjs");
  process.exit(2);
}

const checks = [
  { name: "liveness", path: "/health/live", expectStatus: 200 },
  { name: "readiness", path: "/health/ready", expectStatus: 200 },
];

let failures = 0;

for (const check of checks) {
  const url = new URL(check.path, baseUrl).toString();
  process.stdout.write(`  ${check.name} (${url}) ... `);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status !== check.expectStatus) {
      console.log(`FAILED (expected ${check.expectStatus}, got ${response.status})`);
      failures++;
      continue;
    }
    console.log("ok");
  } catch (error) {
    console.log(`FAILED (${error instanceof Error ? error.message : String(error)})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nDeployment smoke test: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nDeployment smoke test: PASSED");
