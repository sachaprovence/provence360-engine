// Shared ESLint flat config for Next.js apps. `eslint-config-next` ships a
// ready-made flat-config array at this subpath (no FlatCompat needed — an
// earlier version of this file went through FlatCompat("next/core-web-vitals")
// and hit a "Converting circular structure to JSON" crash from
// @eslint/eslintrc's legacy config validator choking on eslint-plugin-react's
// self-referential config object. Importing the flat array directly sidesteps
// that whole legacy code path).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Type-aware rules require every linted file to belong to the app's
// tsconfig project. `next.config.mjs`/`eslint.config.mjs` deliberately
// aren't part of it (see tsconfig.json's "include") — everything else
// (app/**, e2e/**, playwright.config.ts) is.
const CONFIG_FILE_IGNORES = ["*.config.mjs", "eslint.config.mjs"];

export function nextConfig(tsconfigRootDir) {
  return tseslint.config(
    js.configs.recommended,
    ...nextCoreWebVitals,
    {
      ignores: [...CONFIG_FILE_IGNORES, "dist/**", ".next/**", "coverage/**", "node_modules/**"],
    },
    {
      files: ["**/*.ts", "**/*.tsx"],
      extends: [...tseslint.configs.recommended],
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
        "@typescript-eslint/consistent-type-imports": "error",
      },
    },
    prettier,
  );
}

export default nextConfig;
