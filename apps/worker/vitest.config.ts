import { defineConfig } from "vitest/config";

// v1.0.1 — brief §3 audit finding: apps/worker was the one package/app in
// this repo without its own vitest config scoping test discovery to
// `src/**/*.test.ts` (every `packages/*` already does this — see e.g.
// packages/media/vitest.config.ts). Vitest's default glob
// (`**/*.test.?(c|m)[jt]s?(x)`) would otherwise also pick up a stale
// compiled `dist/index.test.js` left behind by `apps/worker/build`'s
// `tsc -p tsconfig.json` (which emits to `dist/` by the tsconfig's own
// `outDir`) — running the compiled JS version of the real test alongside
// (or instead of) the source one, with no warning that anything is
// duplicated. This surfaced for real running `pnpm verify` twice in a row
// (`turbo run build` leaves `dist/` on disk; the next `pnpm test` picked
// it up) — not hypothetical.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
