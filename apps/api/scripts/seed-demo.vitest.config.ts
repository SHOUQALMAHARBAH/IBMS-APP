import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Standalone runner config for `scripts/seed-demo.script.ts`.
 *
 * Deliberately NOT `test/vitest-e2e.config.ts`: that config's `include`
 * (`test/**\/*.e2e-spec.ts`) is scoped to the real e2e suite, and this script
 * must never be picked up by `npm run test:e2e` (it targets the DEV database
 * via `npm run seed:demo`'s `dotenv -e ../../.env`, not `.env.test`, and it is
 * demo-data seeding, not a test). Mirrors vitest-e2e.config.ts's shape
 * (same SWC transform for Nest's decorator metadata, `fileParallelism: false`
 * since there is only one file and it must run start-to-finish, a long
 * timeout since this makes hundreds of real HTTP + Postgres round trips)
 * without touching its `include` glob.
 */
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['scripts/seed-demo.script.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
