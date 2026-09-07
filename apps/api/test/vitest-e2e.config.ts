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
    // Every e2e spec file shares one real Postgres test DB (db-test) — no
    // schema/tenant isolation between files. Vitest's default is to run
    // spec files in parallel worker processes, which was silently safe
    // only because no two files previously touched shared, order-sensitive
    // state at the same time. Backlog Part C #3-4's customer.e2e-spec.ts
    // (~14 signups across 8 tests) was heavy/large enough to expose two
    // real races when run alongside the others: extra COMPLIANCE_OFFICER
    // users shifted AccessRecertificationService's "first eligible
    // reviewer" pick (rbac.e2e-spec.ts — a known ordering-not-round-robin
    // gap, see README § Known gaps, A.2) out from under a concurrently
    // running assertion, and the added CPU load from parallel bcrypt/TOTP
    // work pushed a real-time-based MFA code past its 30-second window in
    // auth.e2e-spec.ts. Confirmed: `--no-file-parallelism` makes all 8
    // files/53 tests pass reliably; the default (parallel) run is flaky at
    // this file count. Slower, but a flaky e2e gate provides no real
    // evidence (ibms-brain/meta/lex/definition-of-done.md) — reliability
    // wins over the ~50s saved.
    //
    // Even serialized, `rbac.e2e-spec.ts`'s access-recertification tests
    // stayed slow-then-timeout by the time the shared test DB had
    // accumulated ~14 files' worth of `makeUser` rows: `startCycle` did 2
    // sequential writes per active subject, and `listItemsForReviewer` did
    // one role-lookup per item. Both are now batched into a single query
    // each (AuditService.recordMany, AccessRecertificationRepository.
    // createManyItems, UserRepository.getRoleNamesByIds), so the endpoints
    // are O(1) round-trips regardless of user count.
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
