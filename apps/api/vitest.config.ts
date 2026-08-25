// unplugin-swc is pinned to an exact 1.5.2 in package.json: 1.5.3+ depends on an
// ESM-only `unplugin` major that its own CJS build can't require() (ERR_REQUIRE_ESM).
// Don't loosen that pin to a caret range without re-checking this.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [swc.vite()],
});
