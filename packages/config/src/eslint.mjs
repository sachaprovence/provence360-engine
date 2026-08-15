// Shared ESLint flat config for plain TypeScript packages (Node libraries).
// Consumed by each package's own eslint.config.mjs so `turbo run lint` can
// run per-workspace.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Type-aware rules require every linted file to belong to a tsconfig
// project (`projectService`). Only `src/**/*.ts` is included by each
// package's tsconfig.json — tooling config files at the package root
// (eslint.config.mjs, vitest.config.ts, drizzle.config.ts, ...)
// deliberately aren't, so they're excluded from linting rather than forced
// into a project they have no reason to belong to.
const CONFIG_FILE_IGNORES = ["*.config.*", "eslint.config.mjs"];

export function baseConfig(tsconfigRootDir) {
  return tseslint.config(
    js.configs.recommended,
    {
      ignores: [...CONFIG_FILE_IGNORES, "dist/**", ".next/**", "coverage/**", "node_modules/**"],
    },
    {
      files: ["src/**/*.ts"],
      extends: [...tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/consistent-type-imports": "error",
        // Callback-shaped APIs across this codebase (withTenantContext,
        // db.transaction, ...) require an `async` callback returning a
        // Promise even when a specific test/call site's body happens not to
        // await anything — a real type constraint, not a mistake.
        "@typescript-eslint/require-await": "off",
      },
    },
    prettier,
  );
}

export default baseConfig;
