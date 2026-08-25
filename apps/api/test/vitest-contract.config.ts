import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// `root` resolves against the CWD the script is run from (apps/api, whether
// invoked directly or via turbo), not against this config file's own
// directory — so this stays './', matching apps/api/vitest.config.ts.
//
// Separate from vitest-e2e.config.ts's `test/**/*.e2e-spec.ts` glob so
// `npm run test:e2e` (integration) and `npm run test:contract` (OpenAPI
// contract) stay independently runnable CI gates, not one file glob.
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['test/**/*.contract-spec.ts'],
    testTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
