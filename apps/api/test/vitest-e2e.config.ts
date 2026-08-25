import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// `root` resolves against the CWD the script is run from (apps/api, whether
// invoked directly or via turbo), not against this config file's own
// directory — so this stays './', matching apps/api/vitest.config.ts.
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
