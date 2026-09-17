import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    // src/ too: password-policy.ts is shared with apps/api AND apps/web, so a
    // change there can break login for everyone and must be testable here.
    include: ['prisma/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
});
