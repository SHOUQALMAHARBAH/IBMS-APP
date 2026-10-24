import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Standalone runner config for `scripts/remove-custom-provider-role.script.ts`.
 *
 * A FOURTH one-file config, for the reason the second and third give: an `include` that matched
 * more than one of these would let one maintenance script run another, and these act on the DEV
 * database. One file each means none of them can do that to another.
 *
 * Not reachable from `npm run test:e2e`, whose `include` is scoped to `test/**\/*.e2e-spec.ts`.
 */
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['scripts/remove-custom-provider-role.script.ts'],
    testTimeout: 2 * 60_000,
    hookTimeout: 2 * 60_000,
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
