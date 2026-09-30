import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Standalone runner config for `scripts/release-demo-logins.script.ts`.
 *
 * A second config rather than widening `seed-demo.vitest.config.ts`'s `include`, for the same
 * reason that file gives for not reusing the e2e config: an `include` that matched both would make
 * `npm run seed:demo` also run the release, and the release deletes the very MFA credentials the
 * seed needs mid-run to call the API. Two one-file configs cannot do that to each other.
 *
 * Neither is reachable from `npm run test:e2e`, whose `include` is scoped to `test/**\/*.e2e-spec.ts`.
 */
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['scripts/release-demo-logins.script.ts'],
    testTimeout: 2 * 60_000,
    hookTimeout: 2 * 60_000,
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
