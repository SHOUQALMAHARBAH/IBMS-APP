import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Standalone runner config for `scripts/release-sample-logins.script.ts`.
 *
 * A third one-file config, for the reason `release-demo-logins.vitest.config.ts` gives for being
 * the second: an `include` that matched more than one of these would let `npm run seed:demo` also
 * run a release, and a release deletes the very MFA credentials the seed needs mid-run to call the
 * API. One file each means none of them can do that to another.
 *
 * None is reachable from `npm run test:e2e`, whose `include` is scoped to `test/**\/*.e2e-spec.ts`.
 */
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['scripts/release-sample-logins.script.ts'],
    testTimeout: 2 * 60_000,
    hookTimeout: 2 * 60_000,
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
