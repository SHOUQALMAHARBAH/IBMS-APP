// unplugin-swc is pinned to an exact 1.5.2 in package.json: 1.5.3+ depends on an
// ESM-only `unplugin` major that its own CJS build can't require() (ERR_REQUIRE_ESM).
// Don't loosen that pin to a caret range without re-checking this.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    /*
     * `scripts/` IS INCLUDED, AND ONLY ITS `.spec.ts` FILES ARE.
     *
     * The demo seeder's plan (`scripts/demo-chain-plan.ts`) needs a test that runs in CI, and
     * `scripts/seed-demo.vitest.config.ts` cannot host it: that config exists to run the SEEDER
     * against the dev database and includes exactly one file by name.
     *
     * ⛔ The `.spec.ts` suffix is what keeps the seeders out. Every script in that folder is
     * named `*.script.ts` and ends in a `test()` call that makes hundreds of real HTTP and
     * Postgres round trips against `.env` — picking one up here would run the demo seeder inside
     * the unit suite, against whatever database the developer happens to have.
     */
    include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
  },
  plugins: [swc.vite()],
});
