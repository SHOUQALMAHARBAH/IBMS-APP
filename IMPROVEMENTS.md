# IMPROVEMENTS.md

## The principle these entries are instances of

> **Prefer the form that cannot express the mistake over the form that requires you to notice
> it.**

Nearly every fix in this file is that one move, applied somewhere new. It is worth absorbing as
a sentence, because a reader who has it will make the right call in a situation none of the
numbered entries covers — which is the only kind of documentation that scales.

| The form that requires noticing | The form that cannot express the mistake |
|---|---|
| A comment asserting an invariant (§ 1.23) | A test asserting it |
| "These are the only columns this view exposes" | A key allow-list asserted as a whole set (§ 1.19) |
| Remembering that a child row must agree with its parent's office | A composite FK making a disagreeing row fail to INSERT |
| Remembering to write `canonicalName` correctly | A `GENERATED ALWAYS … STORED` column the application cannot write |
| Remembering not to select a relationship column | A `SECURITY DEFINER` view where it is unreachable |
| Remembering that a migration changed a stored key | A `DO` block that refuses to deploy if it did not recompute |
| Reading `setting \|\| unit` and spotting `"5242888kB"` (§ 1.32) | `SHOW`, or separate columns, which cannot concatenate |
| Reading a character class to check its ranges (§ 1.34) | Decoding it and diffing against the intended set |
| Remembering that a guard covers only one directory (§ 1.34) | A sanity test that fails when a root moves |

The tell that you are on the wrong side of the table: the correct and incorrect versions LOOK
THE SAME, and only care separates them. Care is not a control — it is the thing that was
already being applied when the defect got in.

---

Consolidated backlog of **things to fix** — bugs, CI/test failures, missing
wiring, unsourced values, security & compliance gaps, and tech debt — gathered
while building Part C (Domains A–D). This is the **cross-cutting action list**;
the per-backlog-item deferred edges live in `README.md` § "Known gaps (per
completed backlog item)" and are not repeated here except where they compound
into a system-wide problem.

**Status:** first compiled at parent `17e52b4` / `ibms-brain` `ed9ad56` (Domain
D complete); topped up through Part C #46 (**Domain E — Customer Service is
now complete**: #41 Customer Requests, #42 Complaints Management, #43 SLA
Management, #44 Customer Communication, #45 Customer Feedback, #46 Customer
Retention). This file is the plan for the "solve every gap / threat / bug"
pass the user asked for **after** the backlog build finished; the pass has
now **begun**, starting with **§5.1 (PDPL foundations)** — M03 Consent
Management landed 2026-09-04, the first of the pass's items to be actioned
(partially — §5.1 covers nine Part D systems, one is built).

**2026-09-07 note:** this file was NOT kept current across the many sessions
since it was last topped up here — §5.1 (Part D/PDPL), §7.1 (Part F/bilingual
UI), §7.2 (Part E/dashboards), and §8 (not-yet-started backlog) all still
read as if those Parts were unbuilt or barely begun. They are not: Part D's
full 9-system checklist is complete, Part E's six dashboards are complete,
Part F items #1-2 of 8 are complete, and Domains F/G/H (#47-74) are all
complete — see `CLAUDE.md` § What's New and `README.md` § Scope status for
the real current state. A full-codebase code-review audit this session (§10
below) found this exact "a context file's claim survives past the session
that made it true" pattern independently in `meta/context/consent-
management.md` and in stale code comments — this file has the same disease
and needs the same cure: a dedicated pass re-reading §5.1/§7.1/§7.2/§8
against current reality and updating or striking each stale claim, the way
"Resolved since this file was first compiled" already does for individual
items above. Not attempted in this session (out of scope for a "review the
code, then ship Part F #2" request) — flagging it here rather than silently
leaving a misleading document in place.

**Priority key:** `P0` blocks correctness, security, or a real "definition of
done" · `P1` must be fixed before the system goes near production · `P2` tech
debt / quality-of-life.

**2026-09-09 — a "fix the gaps" pass ran against this file.** What it closed,
what it found that was NOT in this file, and what it deliberately left:

*Closed:* §3.1 (commission source of truth — and the DI bug that fix shipped
with, below), §3.2 (refund disbursement, with the approval gate and the
client-funds `out` movement the first attempt omitted), §3.4 (partial
payments, application logic included), §10.2 (both `P2002` handlers), §3.6
(the renewal module — see below), §1.6/§5.8 partially (the rate limiter is
real, gated and no longer bypassable).

*Retracted:* an earlier version of this note claimed a `@nestjs/swagger` /
`@nestjs/schedule` upgrade. There was none to make — the versions were already
correct in both `package.json` and the lockfile, and `npm ls` reporting
`invalid` was a stale local `node_modules`. Regenerating `package-lock.json`
on that mis-diagnosis broke CI (dropped Linux `@rollup/*` binaries; de-hoisted
`vitest`/`next` away from `@testing-library/jest-dom` and `eslint-config-next`).
The lockfile is restored verbatim — see `SECURITY_FIXES.md` § 2. **Treat this
lockfile's hoisting as load-bearing.**

*Found during that pass, not previously tracked, now fixed:*

- `P0` **The API could not boot.** `InvoiceService` injected
  `CommissionRepository` (added by the §3.1 fix) but `FinanceModule` never
  provided it. Unit tests construct the service by hand with mocks, so they
  passed; the failure only appears at module instantiation. Fixed by importing
  `CommissionModule` (which exports the repository). Caught by a new e2e —
  nothing else in the suite would have.
- `P0` **`Receipt.invoiceId @unique` was dropped in the schema with no
  application logic** — so the §2-recorded P0 ("two receipts per invoice
  possible") was reinstated and `CollectionService.finishReceipt`'s `P2002`
  branch became unreachable dead code. Fixed properly (see §3.4).
- `P0` **…and the migration that dropped it never actually ran.** Migration
  `20260909120000` used `ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS
  "Receipt_invoiceId_key"`. Prisma materialises a scalar `@unique` as a unique
  **INDEX**, not a table CONSTRAINT, and `DROP CONSTRAINT IF EXISTS` silently
  no-ops on an index name — so the index survived on every already-migrated
  database (confirmed with `\d "Receipt"` on db-test).
  The effect was a **schema/database divergence**, which is worse than either
  state alone: `schema.prisma` had dropped the `@unique`, so a database
  created FRESH from the schema had no protection at all, while every migrated
  database still did. The same application code was therefore correct on one
  and wrong on the other, and `db:migrate:status` reports "up to date" either
  way because it compares migration HISTORY, not actual schema.
  Caught by an e2e writing a second instalment (`P2002` on `invoiceId`), not
  by reading the migration. Migration `20260909160000` now issues the
  `DROP INDEX`. **Lesson for any future constraint removal here: assert the
  post-state (`pg_indexes` / `\d`), never trust that the DDL matched the
  object type Prisma created.**
- `P0` **The rate limiter made the whole api e2e suite unrunnable.** All 63
  `*.e2e-spec.ts` files sign up and log in repeatedly from 127.0.0.1 against
  one static store with a 5-per-15-minutes budget. Now enforced in production
  only (`RATE_LIMIT_ENABLED=true` forces it on), the same `NODE_ENV` gate the
  rest of the security middleware uses.
- `P1` **The rate limiter was trivially bypassable.** It trusted
  `X-Forwarded-For` unconditionally — a client-supplied header — so rotating
  it minted a fresh bucket per request. Now gated on `TRUST_PROXY_HEADERS`.
- `P1` **`refund.disburse` was the one `@RequirePermissions` code not in the
  seed grid**, so its endpoint returned 403 to every role. And had it been
  reachable it checked no approval at all — an at/above-threshold refund could
  be paid with nobody having approved it, a maker/checker bypass on real money
  out. Both fixed; a cross-check of all 154 used codes against all 157 seeded
  now shows zero unreachable endpoints.
- `P1` **`user.manage` and `dashboard.executive.view` were seeded with no
  endpoint.** The first meant a production-seeded database had the full role
  catalogue, the full permission grid and no way to give anyone a role — see
  §5.9. Both now have one.
- `P2` `common/sanitization.util.ts` was dead code duplicating
  `document-html.util.ts`'s `escapeHtml`. Deleted.
- `P2` `SECURITY_FIXES.md` asserted fixes that did not exist in the tree.
  Rewritten against verified evidence.
- `P0` **Found in this pass's own self-review, before commit:** the first cut
  of the partial-payments change moved the "is this invoice settled?" test out
  of the SQL `where` and into a JS filter — which silently relocates `LIMIT` to
  the wrong side of it. On a book with 5,900 settled and 100 outstanding
  invoices, `orderBy createdAt asc` + `take 5000` would have returned 5,000
  mostly-settled rows, discarded nearly all of them, and understated
  receivables just as badly as the bug being fixed. `loadOutstandingReceivables`
  and `loadInsurerObligations` are now raw SQL with a `HAVING` clause (see
  §6.1), verified against real Postgres by cross-checking both against an
  independent uncapped JS recomputation over db-test — exact match on both.

*Deliberately left:* the drafted/unsourced values in §4 (they need a business
decision, not a code change), real screening (§5.2), the remaining PDPL
systems (§5.1), reporting SQL aggregation (§6.1). None of these are one-line
changes and none should be guessed at.

**Resolved since this file was first compiled** (kept here so the gap isn't
rediscovered — see § 2 for the same convention applied to in-session bugs):

- ~~§5.4 "No consent check before marketing sends (#44)"~~ — **built at #44**
  (`ibms-app` `0ec7fad`/`142df0a`). `POST /communications` derives channel +
  language from the `Customer` record (a disagreeing explicit value is a 422)
  and blocks a marketing send (422, no row, a `REJECT` audit row) unless the
  customer's latest MARKETING `ConsentRecord` is granted and not withdrawn.
  Two new gaps this introduces, not previously tracked, now recorded in
  §5.4's slot in place of the old (now-resolved) entry: no real delivery
  integration (`CommunicationLog` is a *log*, nothing actually sends an
  email/SMS), and the consent-gate is a read-then-write with no DB constraint
  tying the two — a withdrawal landing between the check and the write would
  leave a row citing consent that no longer holds, tolerable only because
  there is no real dispatch yet to make that window matter.

---

## 1. CI & test-infrastructure failures

### 1.1 `P0` — Two e2e specs time out in the full `apps/api` suite

- **Symptom:** `rbac.e2e-spec.ts` (access-recertification "reviewer never
  reviews their own item") and `up-sell.e2e-spec.ts:343` (nightly under-insurance
  sweep) fail with `Test timed out in 30000ms` when the whole e2e suite runs.
  Both pass 100% in isolation.
- **Root cause:** the 22 `*.e2e-spec.ts` files share **one** real Postgres test
  DB with **no per-file isolation and no teardown** (`fileParallelism: false` in
  `apps/api/test/vitest-e2e.config.ts`). Every prior file's rows accumulate, so
  any test that does per-row work (a `findMany` + JS loop, a per-subject write)
  degrades toward O(n) as the shared DB grows. Two earlier rounds of this were
  patched by batching queries (`AccessRecertificationRepository.createManyItems`,
  `AuditService.recordMany`, `UserRepository.getRoleNamesByIds`) — at ~22 files
  the next two heaviest tests crossed the 30 s line, especially under machine
  load.
- **Fix options (pick one, ideally the first):**
  1. **Per-file DB isolation** — a template DB + `CREATE DATABASE … TEMPLATE`
     (or `pg` schema-per-file, or transactional rollback via
     `@databases/pg-test`) so each spec starts clean. Removes the whole class of
     "cumulative-DB" flakes (also see 1.4).
  2. Truncate all tables in a global `beforeAll` per file (fast, but every spec
     must then create its own fixtures — some already assume prior state).
  3. Raise the per-test timeout for those two specs and keep batching hot paths
     — a band-aid, not a fix.

**2026-09-09 update — measured, and partly mitigated.** At 64 spec files
db-test held **36,470 users** (it is never reset, and nothing truncates
between runs). `rbac.e2e-spec.ts` took **557 seconds** for 6 tests and still
failed 3 of them at a 180s timeout; the full suite ran 44 minutes and reported
12 failures — every one a timeout, none an assertion. Verified by re-running
the same specs with a longer timeout and watching them pass: the code is
correct, the data volume is not.

Two things were done, and only one of them is a fix:

- `testTimeout` in `vitest-e2e.config.ts` raised 30s → 180s, with the
  reasoning written into the file. A **mitigation**: a gate that goes red for
  elapsed time rather than for a defect trains people to ignore it.
- **db-test was reset and re-seeded** (36,470 → 12 users, with the user's
  explicit consent — `prisma migrate reset` refuses without it). This is
  operational hygiene, not a code fix, and the accumulation simply starts
  again on the next run.

**The reset is worth far more than the timeout bump — measured on the same
suite, same machine, same commit:**

| | accumulated db-test (36,470 users) | reset db-test (134 users) |
|---|---|---|
| Full suite | 311/323, **12 failed** | **322/323, 1 failed** |
| Wall clock | 2,670 s (44 min) | **922 s (15 min)** |
| `rbac.e2e-spec.ts` | 557 s, 3 failed | **10.4 s, 1 failed** |

Every one of the 12 original failures was a timeout, none an assertion. The
single remaining failure is the §1.2 TOTP flake, not a timeout — `rbac`
passes 6/6 in isolation. So the suite's health was almost entirely a function
of accumulated fixture data, which is exactly what §1.1 predicts.

**2026-09-22 update — the accumulation has now passed the point where a test
timeout is the binding limit, and `testTimeout` can no longer mitigate it.**

Measured on db-test today: **46,153 users, 45,939 of them ACTIVE, and 5,938,213
`AuditLogEntry` rows** — more users than the 36,470 that produced the 12
failures above. `rbac.e2e-spec.ts` alone (not concurrent, one command,
`fileParallelism: false`): **4 failed, 6 passed**, and the four failures are no
longer vitest timeouts:

```
PrismaClientKnownRequestError:
Invalid `prisma.auditLogEntry.createManyAndReturn()` invocation:
Transaction API error: Transaction already closed: A query cannot be executed
on an expired transaction. The timeout for this transaction was 120000 ms,
however 128300 ms passed since the start of the transaction.
```

**That is a 500 from the application, not a red test.** `startCycle` opens one
interactive transaction and writes an item plus an audit row per active subject;
at 45,939 active subjects it exceeds Prisma's 120 s interactive-transaction cap.
Three consequences worth separating:

1. **Raising `testTimeout` is now useless.** The cap is inside the application's
   own transaction, so the request fails at 120 s regardless of how long the test
   is willing to wait. The mitigation this entry chose in September has been
   exhausted.
2. **It is still not a product defect.** No real brokerage office has 45,939
   active users; the transaction is O(active subjects) by design and that design
   is fine at real scale. The data volume is the defect, exactly as this entry
   has said since it was written.
3. **CI is unaffected and is therefore the authority for this file** — and the
   comparison is as clean as this class of finding ever gets, because it is the
   SAME COMMIT:

   | | `rbac.e2e-spec.ts` on `a17d5b8` |
   |---|---|
   | CI (database built from nothing) | **10/10 passed, 14,696 ms** |
   | This laptop (45,939 active users) | 4/10 failed; individual tests 143,624–260,831 ms |

   Read from the CI log directly (`backend / Integration tests`:
   `✓ test/rbac.e2e-spec.ts (10 tests) 14696ms`, in a run reporting
   `Test Files 92 passed (92)`), not inferred from the run being green. **14.7
   seconds against 260 seconds for a single test** is the accumulated data and
   nothing else — same code, same spec, same Postgres version. This is the
   concrete case the verification-contract rule was written for: *keep CI for
   being the only environment that starts from NOTHING.*

**What to do, in order.** Reset db-test again (`prisma migrate reset` + seed) —
it is operational hygiene, it needs explicit consent because the command refuses
without it, and the table above shows it is worth far more than any timeout
change. Then do fix option 1, per-file isolation, because a reset buys months
and not more: the accumulation restarts on the next run, and this is now the
SECOND time it has crossed a hard limit, each time at a higher one.

The root cause is unchanged and option 1 above is still the answer: per-file
DB isolation. Until then, **reset db-test before relying on a full-suite
number** — otherwise the suite measures months of accumulated fixtures rather
than the change under test. Worth automating as a `pretest:e2e` step, which
would remove the human judgement entirely.
- **Also:** `rbac.e2e-spec.ts` still depends on
  `AccessRecertificationService`'s "first eligible reviewer" being a **stable
  ordering, not round-robin** (documented in README § Known gaps A.2). Fixing
  the reviewer-pool selection to be deterministic-and-fair would also stop this
  test being load-sensitive.

### 1.2 `P1` — MFA/TOTP timing flake in shared `makeUser` helpers

- **Symptom:** intermittent `expected 200 "OK", got 400 "Bad Request"` at the
  `POST /auth/mfa/totp/enroll/verify` step inside `makeUser()` (seen in
  `invoice.e2e-spec.ts`, `auth.e2e-spec.ts`, `rbac.e2e-spec.ts`). The generated
  `authenticator.generate(secret)` code lands in a different 30 s window than
  the server's check when the suite is slow.
- **Fix:** in tests, freeze time around enroll+verify (`vi.setSystemTime`), or
  have the test helper accept the server's `otplib` window/step and generate the
  code for the same tick, or use a longer `window` tolerance on the *test*
  verify call only. Do **not** widen the production TOTP window.
- **2026-09-09 — still live, and now the ONLY full-suite failure.** On a reset
  db-test the suite is 322/323; the one failure is this flake, in
  `rbac.e2e-spec.ts`'s `enrollMfa` (`expected 200, got 400`), and that file
  passes 6/6 in isolation immediately afterwards. Not fixed this pass for one
  concrete reason: `enrollMfa` is **hand-duplicated in 62 of the 64 spec
  files**, so any test-side fix is a 62-file mechanical change, and the
  one-file alternative — widening the server's `otplib` window — is a change
  to a production MFA control that this entry explicitly rules out. Extracting
  the helper into `test/utils/` first (and having every spec import it) is the
  prerequisite; do that, and the fix becomes a one-line change in one place.

### 1.3 `P1` — `read ECONNRESET` under load

- **Symptom:** occasional `Error: read ECONNRESET` from `supertest` mid-suite
  when several heavy background jobs run alongside the e2e run.
- **Root cause:** the single shared Nest app instance (`sharedApp` /
  `createTestApp`) + Postgres pool saturates under CPU contention; a socket gets
  reset before the response is read.
- **Fix:** bump the test DB pool size / statement timeout for the e2e env; add a
  small `supertest` retry-on-ECONNRESET wrapper in `test/utils/`; or (better)
  isolation per 1.1 so fewer connections are live at once.

### 1.4 `P1` — "db-test is cumulative" is a footgun for every new e2e

- Any `prisma.X.findMany({})` + hard-count assertion in an e2e is wrong the
  moment a second spec file exists — book-wide read endpoints return **all**
  prior tests' rows. Every finance/claims analytics e2e already has to scope
  queries by the test's own ids and use lower-bound assertions.
- **Fix:** the isolation work in 1.1 removes the trap. Until then, add a lint
  rule / review-checklist item: "no un-scoped `findMany` count in an e2e".

### 1.5 `P2` — Prisma `migrate dev` checksum drift on local `db` / `db-test`

- Local `_prisma_migrations` rows carry a stale checksum for one or more early
  migrations, so `prisma migrate dev` wants to reset. Worked around
  per-migration by editing `_prisma_migrations` directly / `migrate deploy` +
  `migrate resolve` instead of `migrate dev` (see memory
  `project_prisma_migrate_dev_checksum_drift`). CI is unaffected (fresh DB each
  run) but local onboarding hits it.
- **Fix:** re-baseline the migration history once (squash to a single init on a
  throwaway branch, or `migrate diff`-regenerate the checksums), or document the
  `migrate resolve --applied` recovery in `README.md` § "Dev DB vs test DB".

### 1.6 `P2` — CI DAST (ZAP baseline) is informational-only

- `ci.yml` backend job runs an OWASP ZAP baseline scan with `fail_action:
  false` — findings never block. `codeql.yml` (SAST) and `test:security` (SCA)
  do gate.
- **Fix:** once the app has auth wired for the scanner (a seeded scan user) and
  the passive findings are triaged, flip `fail_action: true` with an allow-list.

### 1.7 `P2` — `.claude/` enforcement hooks not wired in this repo

- Only `mirror-brain-agents.sh` is present. The `git push` evidence-gate hook
  (`enforce-evidence.sh`) and the domain-code path-scoped hooks from
  `ibms-brain/.claude/hooks/` are **not** installed here, so
  `definition-of-done.md` is enforced by CI + discipline, not by a local
  pre-push gate.
- **Fix:** port `enforce-evidence.sh` + the `.claude/rules/` path scopes once
  the domain code they guard is stable.

---

### 1.8 `P1` — Three assertions that pass whether or not the thing they check exists

Found 2026-09-19 by auditing the whole suite for assertions that depend on an
unordered sample, after CI caught one of exactly that shape in
`office-administrator.e2e-spec.ts` (a migration outcome asserted over
`findMany(...).slice(0, 25)` — it passed on the cumulative database because those
25 rows happened to predate the migration, and failed on a from-zero one).

The sweep covered every `findMany`/`groupBy` without an `orderBy` in
`apps/api/test` and `apps/api/src/**/*.spec.ts`, following each assigned variable
to an order-sensitive use (index, `.slice`, `.at`, `pop/shift`, order-sensitive
`toEqual`). 17 sites; 14 are safe because they assert `toHaveLength(1)` before
indexing, which makes `[0]` deterministic. Three are not:

| Site | Problem |
|---|---|
| `incident.e2e-spec.ts:181` | `expect(containmentAfter[0]?.resolvedAt).not.toBeNull()` — no length check, and `?.` on an empty array yields `undefined`, which **passes** `.not.toBeNull()` |
| `incident.e2e-spec.ts:262` | same shape, senior-management notification timer |
| `sla-policy.e2e-spec.ts:217` | `expect(audits.length).toBeGreaterThan(0)` then asserts on `audits[0]` — tolerates many rows, then generalises from an arbitrary one |

The two `incident` ones were **proved** vacuous rather than reasoned about: both
queries were pointed at a nonexistent workflow name so they returned zero rows,
and the file still passed 4/4. Those assertions would hold if the SLA timer were
never created, never resolved, or deleted outright.

- **Fix:** assert the count the test actually causes (`toHaveLength(1)`) and drop
  the `?.`, so an empty result fails. The `sla-policy` one becomes
  `toHaveLength(1)`, which also makes a second UPDATE on that policy a visible
  failure rather than a coin flip.
- **The pattern to ban is not "unordered query"** — it is `?.` on an indexed
  result, and `length > 0` followed by `[0]`. Both make an assertion
  unfalsifiable, and neither looks wrong on the page.
- **Scheduled:** its own short branch, after the insurer feature ships and before
  RBAC Phase 4. All three predate the RBAC rework and sit on `main`, so they are
  independent of both. Not urgent — but a test that passes whether or not the
  thing exists will eventually be cited as coverage by someone who did not read
  it.

---

### 1.9 `P2` — A test FILE can be red with every test in it green

Seen 2026-09-19 building `insurer-deactivation.e2e-spec.ts`: all six tests passed
and the file failed, because `afterAll` threw on
`Quotation_insurerId_fkey` while tearing fixtures down. Vitest reports
`Test Files 1 failed | Tests 6 passed`.

- **Why it matters:** the per-test count is what a person reads, and it said
  6/6. Only the file line disagreed. A CI log skimmed for "failed tests" shows
  nothing wrong.
- **How to apply:** read the `Test Files` line, not just `Tests`. A green test
  count with a red file means a hook failed — `beforeAll`, `afterAll`, or module
  setup — and the cause is usually teardown hitting a constraint the tests
  themselves never touch.
- **Related:** `Insurer`'s FKs are all RESTRICT, so a fixture sweep has to delete
  children in order. `Quotation` additionally has an immutability TRIGGER
  ("a negotiation round is a new version, not a replacement"), so its rows need
  the `SET LOCAL session_replication_role = replica` bypass on the owner
  connection — the same pattern `last-administrator-lock.e2e-spec.ts` uses for
  the immutable audit trail, scoped to the file's own fixture rows.

---

**Seen twice more on 2026-09-20, and the second one is the reason this entry is
`P2` rather than a note.** Both were hook failures with every test green, and both
poisoned OTHER files:

1. `last-administrator-lock.e2e-spec.ts` reported `Hook timed out in 10000ms` —
   vitest's DEFAULT hook budget, which its `afterAll` had never been given an
   explicit replacement for. Its fixture Organization therefore survived, and
   `signup` then failed in two later files with a bare 500 (see § 1.11). A hook
   that retries needs an explicit timeout; the default is 10s no matter how long
   the work legitimately takes.
2. `insurer-master.e2e-spec.ts`'s teardown ran
   `deleteMany({ where: { insurerMasterId: masterId } })` with `masterId` still
   `undefined`, because `beforeAll` had failed (from cause 1) before assigning it.
   **Prisma treats an `undefined` where-value as NO FILTER**, so that teardown
   attempted to delete every insurer in the office; it failed only because an
   unrelated fixture held a RESTRICT reference. On a database where nothing did, it
   would have quietly deleted the entire insurer book and reported a teardown error
   about a foreign key.

- **How to apply:** never feed a destructive `where` from a variable that is
  assigned inside `beforeAll` without guarding it (`if (!id) return;`). The whole
  suite was scanned for this shape — an uninitialised module-level `let` reaching a
  `delete`/`deleteMany`/`update`/`updateMany` where-clause — and this was the only
  instance with a widening filter; the two others found are singular `update`s,
  which throw rather than widen.

---

### 1.10 `P3` — Two office-local insurer fixtures are left in `db-test` on purpose

`invoice.e2e-spec.ts`'s office-local payables test creates an insurer that ends up
under a policy, an invoice and a receipt. It is **not** torn down, and that is a
decision rather than an oversight:

- `Policy_insurerId_fkey` is RESTRICT, so the insurer cannot be deleted alone.
- That file deliberately leaves its whole fixture chain behind — customers,
  programmes, policies — like every other test in it. Tearing down the chain for
  this one insurer would be inconsistent with the file, and changing that file's
  teardown behaviour as a side effect of the insurer feature is the kind of
  unrelated change every phase has kept out.
- **Consequence to know:** `db-test` can no longer be rolled back past migration
  `20261009100000` (the one that made the master link nullable), because
  restoring `NOT NULL` would require destroying those chains. Build a fresh
  database instead — the `.env`-copy recipe in § api e2e run mechanics.
- Insurers created purely to be LISTED are swept, in
  `insurer-permissions.e2e-spec.ts` and `insurer-deactivation.e2e-spec.ts`. Only
  the ones under a retained policy chain persist.

---

### 1.11 `P1` — `POST /auth/signup` answers a known, expected state with a 500

Once more than one `Organization` exists, signup throws a bare `Error` — so the
HTTP answer is a 500 with a generic body, and the real message only appears in the
server log.

This is not theoretical noise: it is the single most expensive diagnostic in this
suite. Every time a spec leaks a fixture Organization, unrelated files report
`expected 201 "Created", got 500` from whatever they were doing, and nothing in the
test output says why. **THREE** separate debugging sessions have now started from that
symptom — the third on 2026-09-22, when two concurrent e2e commands each leaked an
Organization into the other's view and `office-administrator` and `rbac` both reported
unrelated 500s (§ 1.41). The status code is what made that expensive: the message the
repository writes says exactly what is wrong, and nobody running tests ever sees it.

**The message itself was separately WRONG until 2026-09-22 and is now fixed.** It
advised provisioning "through `POST /admin/users`, which names the Organization
explicitly" — and `ProvisionUserDto` has no `organizationId` field, so that route
creates a user in the CALLER's office and can never create the first user in a new
one. The advice was circular for the only person who would ever read it. It now says
plainly that a second office cannot currently be onboarded through the application,
names Phase 4 as where that lands, and names the only two writers of `Organization`
(`packages/db/prisma/seed.ts`, `apps/api/scripts/seed-demo.script.ts`, neither
reachable over HTTP). `organization.repository.spec.ts` pins it, including an
assertion that the message does NOT mention `/admin/users` — planted by putting the
sentence back and watching it fail.

It is a `ConflictException` (or 422) with the message it already writes to the log.
Deliberately **not** changed as a side effect of insurer management, because the
status code is part of the auth contract and several specs assert on it — it wants
its own commit and a check of every `signup` assertion in the suite.

---

### 1.12 `P2` — `GET /insurers` cannot order alphabetically

The list is paged (`{items,total,page,pageSize}`) and ordered `createdAt desc`, like
every other paged list here. Alphabetical would be the useful default for a
management list of companies, and it is not available:

- an insurer's name lives EITHER on the joined `InsurerMaster` or on the office's
  own row, so a single SQL ordering over "the name" needs a raw
  `COALESCE(im."legalName", i."legalName")` query — there is currently exactly one
  raw-SQL site touching `Insurer` (`invoice.repository.ts`), and adding a second
  for ordering was not worth it in the CRUD commit;
- Arabic-aware ordering needs either an in-memory sort of the whole set (what the
  two unpaginated pickers do, via `localeCompare(name, 'ar')`) or a DB-level ICU
  collation, which is its own migration.

`?search=` is what makes finding a company work meanwhile, and it is a query filter
so the page bounds matching rows. Worth revisiting when the directory lands, since
name normalisation across both scripts is that commit's problem anyway — and note
that under the amendment every NEW registration is office-local, so the two-source
split shrinks over time rather than growing.

---

### 1.13 `P3` — An insurer contact field cannot be cleared

`PATCH /insurers/:id` keys on PRESENCE, so an absent field is left alone — which is
what a one-field PATCH has to mean. There is consequently no way to say "this
insurer no longer has a claims contact": the DTOs refuse an empty string and JSON
null.

Left open deliberately rather than inventing a per-field convention (`""` means
clear? a `clearFields: []` array?) in the CRUD commit. It wants ONE answer for the
whole contact set, and the contact-fields commit is where that set is decided.

---

### 1.14 `P1` — An `undefined` value in a Prisma `where` WIDENS the filter

The trap, stated on its own because it generalises far past the case that found it:

```ts
// `id` is undefined — this does NOT match nothing. It matches EVERYTHING.
await prisma.insurer.deleteMany({ where: { insurerMasterId: id } });
```

Prisma omits an `undefined` value from the generated SQL rather than comparing against
it. A filter assembled from a variable therefore **loses a condition** when that
variable is unset, and the operation applies to every row the caller can see. On a
`findMany` that is a confusing result; on a `deleteMany` or `updateMany` it is data
loss, and it **succeeds silently** — there is no error, no empty result, nothing to
notice. `null` behaves correctly (it compares against NULL); only `undefined` widens.

**The case that found it (2026-09-20).** `insurer-master.e2e-spec.ts`'s teardown ran
`deleteMany({ where: { insurerMasterId: masterId } })` where `masterId` is assigned at
the END of `beforeAll`. An unrelated leaked fixture Organization made `signup` return
500, `beforeAll` failed before the assignment, and the teardown then attempted to
delete **every insurer in the office** — 5,354 rows on `db-test`. It failed only
because `RFQInsurer_insurerId_fkey` is RESTRICT and some other fixture happened to
hold a reference. Nothing about the resulting error mentioned a missing filter; it
named a foreign key.

**How to apply.**

- Never build a destructive `where` from a variable that is assigned conditionally, or
  inside a hook that can fail, without guarding it first: `if (!id) return;`.
- Prefer a filter that cannot widen. `{ id: { in: ids } }` with an empty array matches
  nothing, which is the safe direction; `{ id: undefined }` matches everything.
- Treat a fixed name PREFIX as the filter of choice in test teardown
  (`{ legalName: { startsWith: FIXTURE_PREFIX } }`) — it is a literal, so it cannot
  become undefined, and it sweeps what a crashed run left behind as a side effect.
- The same applies in application code, where the blast radius is a real office's
  data rather than a test database. A repository method taking an optional filter
  should spread it conditionally (`...(x === undefined ? {} : { field: x })`) — the
  pattern `insurer.repository.ts#whereFor` uses — rather than passing the value
  straight through.

**Scan result.** The whole `apps/api/test` tree was scanned for the shape (a
module-level `let` with no initialiser reaching a `delete`/`deleteMany`/`update`/
`updateMany` where-clause). One instance with a widening filter — the one above, now
guarded. Two others are singular `update`s, which throw on an undefined unique
where rather than widening. Application code was not scanned exhaustively; that is
worth a pass of its own.

---

### 1.15 `P1` — SIX models still name an insurance line in FREE TEXT

The managed vocabulary (`InsuranceLine` + `OfficeInsuranceLine`) governs exactly one
thing today: what a company OFFERS, via `InsurerOfferedLine`. Everything else that
names an insurance type still stores a string:

`InsuranceProgramLine`, `RFQ`, `Policy`, `InsurerProduct`, `InsurerFormTemplate` and
`CommissionAgreement` — each with its own `insuranceLine String`. Counted from the
schema rather than from memory, with:

```bash
grep -nE '^\s+insuranceLine\s+String' packages/db/prisma/schema.prisma   # 6 matches
```

 an earlier draft of this entry said seven and named
`Quotation` and `InsurerSlaAgreement`, neither of which carries the field, and missed
`InsuranceProgramLine`, which does. `Quotation` inherits its line from the RFQ it
answers, which is why it has none of its own.

So the fragmentation the vocabulary exists to remove is only removed at the insurer
end. A policy whose line reads `"مركبات"` still cannot be matched against an insurer
that offers `MOTOR_COMPREHENSIVE`, which means:

- portfolio/profitability reports that group by line still fragment along spellings;
- "which of our insurers writes this policy's line" is still unanswerable;
- the directory can search companies by line, but nothing can search POLICIES by the
  same vocabulary.

**Why it was not done here.** Converting those six means a data migration per model
over rows that already exist, with no mapping for a value nobody standardised —
`"MOTOR"`, `"Motor"`, `"motor comprehensive"` and `"تأمين شامل"` all have to become an
id or be parked somewhere reviewable. That is its own piece of work with its own
backfill and its own decision about what to do with a string that matches nothing. It
is not a side effect of adding the vocabulary.

**What makes it safe to defer:** the new tables add a referent rather than changing a
meaning, so nothing regressed. What it costs to defer: every additional row written
into those seven columns is another row a future migration has to classify.

---

### 1.16 `P2` — The vocabulary has no synonym detection, and additions cannot be retired

Two bounded gaps in the managed-list design, both deliberate, both recorded so nobody
mistakes them for oversights.

**Synonyms are not caught.** An addition is refused if its canonical name key matches a
standard line or an existing addition — which folds orthography (alef forms,
diacritics, tatweel, ة/ه, ى/ي), the definite article and word order. It cannot fold
MEANING: `"سيارات شامل"` and `"تأمين المركبات الشامل"` are the same cover and share no
word, so an office can still add the second while the first exists.

**This is an open WINDOW, not a permanent design limit, and it exists because of the
commit order.** The vocabulary shipped before the similarity layer, so between those
two commits an office can create a synonym pair that the directory will later have to
reconcile. Accepted deliberately: the 32 standard lines cover nearly everything, which
makes additions rare; and nobody is using the system yet, so the population of rows
created inside the window is expected to be zero. Recorded here so that if the
directory lands and finds a synonym pair, it is a known consequence of sequencing
rather than a surprise — and so that whoever builds the matching layer knows to check
for existing pairs rather than assuming a clean start. Closing that needs
the similarity layer the insurer directory's matching commit brings (trigram /
`pg_trgm`), applied to BOTH vocabularies — as a non-blocking "did you mean …?" on top
of the exact guarantee, never instead of it. The exact key is what can be a unique
index; a similarity score never can.

**An addition can be renamed but not removed.** `PATCH /insurance-lines/:id` fixes a
typo — which is why it exists, since without it a mistake is permanent in a vocabulary
the whole office picks from. There is no retire/delete: an addition that turns out to
be a duplicate of a standard line under a different name stays in the picker forever.
The shape it wants is `status` (the `Role` precedent — retire, never delete, because
the `InsurerOfferedLine` rows pointing at it ARE the record of which companies were
said to offer it), plus a decision about what happens to insurers already offering a
retired line. Not built because nothing can retire a line yet either way.

---

### 1.17 `P1` — A number that arrived by being repeated is not a measurement

Three figures on this project have been carried from document to document, used in
reasoning, and turned out to be wrong the first time somebody counted. The third one
is the useful one, because it was produced by trying to write this entry.

**1. Six models name an insurance line in free text, not seven.** § 1.15 originally
said seven and named `Quotation` and `InsurerSlaAgreement`, neither of which carries the
field, while missing `InsuranceProgramLine`, which does. Measured with a script over
`schema.prisma` that prints every model with an `insuranceLine String` field — the
command is in that entry.

**2 and 3. The maker/checker figures are still unresolved, and that is the finding.**
`maker-checker.util.ts` was documented as having "62 call sites ... backed by 17 DB
CHECK constraints". A later pass corrected that to 19 and 15. Measuring again while
writing this entry:

```bash
# references to the segregation helper, excluding its own definition and its specs
grep -rn 'assertDifferentActors' apps/api/src --include='*.ts' | grep -vE '\.spec\.ts|export function' | wc -l   # 63
# and the files they sit in
grep -rl 'assertDifferentActors' apps/api/src --include='*.ts' | grep -v '\.spec\.ts' | wc -l                    # 29
```

```sql
-- CHECK constraints whose NAME suggests a maker/checker rule (a name match, not an audit)
SELECT count(*) FROM pg_constraint WHERE contype = 'c'
  AND (conname ILIKE '%different%' OR conname ILIKE '%_ne_%'
    OR conname ILIKE '%not_self%' OR conname ILIKE '%self_approval%'
    OR conname ILIKE '%maker%' OR conname ILIKE '%checker%');   -- 27
```

**63 / 27 agrees with neither 62 / 17 nor 19 / 15.** Almost certainly because the three
counts count different things — references versus routes versus files, and a
name-pattern match versus a hand-audited list of constraints that genuinely enforce
segregation. Which is the point: nobody can tell, because no version of the figure
recorded what it counted or how. The claim "19 call sites" is not recoverable, so it is
not checkable, so it is not a measurement either — a correction repeated is still a
rumour.

**How to apply.**

- Either measure a count at the moment you state it, or do not state it.
- State the COMMAND beside the number. A figure whose derivation is reproducible can be
  re-measured by the next reader instead of re-copied; one that cannot is a rumour with
  a digit in it.
- Say what you counted. "63 references across 29 files" and "19 routes" can both be true
  of the same helper and mean entirely different things.
- A number that is load-bearing — in a test name, an assertion, a security argument —
  needs a test that fails when the real count moves, not a reader trust. `office-administrator.e2e-spec.ts`
  asserting the 24 codes and `insurance-lines.e2e-spec.ts` asserting all 32 lines are
  the right shape; a comment saying "all 32" is not.

**Not fixed here:** the maker/checker figures still need a real audit — what the 63
references actually are, and which CHECK constraints genuinely back segregation as
opposed to merely having a suggestive name. Until then no number for them should be
repeated, including the ones above, which are a name-pattern match and nothing more.

---

### 1.18 ~~`P2` — "In force" is `ACTIVE` alone, so a deactivation impact count understates~~ — RESOLVED (2026-09-20)

The impact count reported one policy figure using `IN_FORCE_POLICY_STATUSES` (`ACTIVE`
alone), so an audit row could read `policiesInForce: 0` while six policies sat at
`PLACEMENT_CONFIRMED`, `ISSUED`, `CHECKING_IN_PROGRESS`, `DISCREPANCY`, `VERIFIED` or
`DELIVERED`. A confident wrong answer, in the one record whose purpose is to stop an
administrator believing they have made a clean break.

**Fixed by a second NAME, not a wider one** — option (2) of the two this entry laid out.
`policy.repository.ts` now owns three sets side by side: `IN_FORCE_POLICY_STATUSES`
(cover running, `ACTIVE`), `OPEN_OBLIGATION_POLICY_STATUSES` (the insurer still owes an
action — the six above), and `CLOSED_POLICY_STATUSES` (`CANCELLED`, `EXPIRED`). Widening
the shared constant would have changed the cross-sell gap scan's meaning without anyone
deciding to; its comment argues for the narrow reading there, and that argument still
holds.

The impact reports **two numbers**, not one, because they are different questions: cover
that runs to its own expiry needs nothing from the insurer, while a policy at
`DISCREPANCY` is an open matter with that specific company. Collapsing them hides the
half that should give somebody pause. Both figures go into the audit `afterValue` and
both are readable before the act via `GET /insurers/:id/status-impact`, from the same
count method — one meaning, two call sites.

`policy-status-sets.spec.ts` asserts the three sets partition `PolicyStatus` exactly, so
a tenth status cannot be added without somebody classifying it. Without that, a new
status would be in none of the sets and would vanish from both figures with nothing
failing.

**Still open from this entry:** `IN_FORCE_POLICY_STATUSES`' doc comment claimed "the
Policy module (Domain B, Processes 18-22) is not built, so the `Policy` table is empty in
every environment today". Domain B has since been built; the comment was rewritten during
the promotion.

---

### 1.19 — HOUSE PATTERN: assert the whole SET, not the members you thought of

Three guards on this project are the same move, and it is worth having one name for it.

| Guard | Asserts | Breaks when |
|---|---|---|
| `insurer-schema-constraints.e2e-spec.ts` | the complete list of UNIQUE indexes on `Insurer` | a fourth index appears — which it did, and the test caught its own author's migration days later |
| `insurer.config.spec.ts` | the complete key set of `InsurerView`, split into a company half and a relationship half | a field is added to the view without anybody saying which half it is in |
| `policy-status-sets.spec.ts` | that three status sets partition `PolicyStatus`, read from the generated client | a tenth status is added and lands in none of them |

**What it defends against is invisible by construction.** In each case the failure is a
NEW member falling through a gap while every existing test stays green: a fifth unique
index producing a 409 about the wrong constraint, a relationship column appearing in a
view the directory reads, a policy status vanishing from both halves of an impact count.
Nothing is broken — something is merely absent, and absence is what per-member tests
cannot see. A test per member only ever covers the members somebody thought of.

**How to write one.**

- Enumerate from the AUTHORITY, not from a hand-written list: `Object.values(SomeEnum)`
  from the generated client, `pg_indexes` from the live database, `Object.keys()` of the
  object actually returned. A test that restates the list it is checking passes whatever
  that list says.
- Assert the whole thing with `toEqual`, not membership with `toContain`. Containment is
  satisfied by a set that has grown.
- Make the failure NAME the new member. `expect(unclassified).toEqual([])` prints
  `[ 'DISCREPANCY' ]`; `expect(isPartition).toBe(true)` prints `false`. The first tells
  the next person what to do.
- Say in the message what goes wrong if the set is incomplete, because whoever hits it
  will be adding a legitimate member and wondering why a test cares.

Deliberately annoying is the design: adding a member should not be possible without a
decision, and the test is where that decision gets recorded.

**Where this should eventually live:** `ibms-brain/meta/context/verification-contract.md`,
the canonical home for verification practice across the workspace. That is a submodule
commit plus a pointer bump in this repo, so it is flagged here rather than done unasked.

---

### 1.20 `P1` — A check that LOOKS like verification but is not

A family of mistakes worth recognising as one shape: a step that produces a confident
answer without actually checking the thing.

**A grep of the schema is not a read of the schema.** Building a two-policy fixture, a
grep for a unique on `riskProfileId` came back empty, so the fixture reused one risk
profile — and the database refused it, because `InsuranceProgram.riskProfileId` IS unique.
The correction then reused one programme across two opportunities, and the database
refused that too (`Opportunity.insuranceProgramId` is unique as well). Two wrong answers
from a search that felt like verification. That path is one-to-one at every step; reading
the model block would have said so, and the grep's scope quietly decided the answer.

**Its relatives, all already documented here:**

- **§ 1.14** — an `undefined` in a Prisma `where` widens the filter. The query runs, it
  returns rows, nothing errors; it simply answered a different question.
- **§ 1.17** — a count carried between documents. It looks like a measurement because it
  is a number.
- **Untyped fixture payloads.** A supertest `.send({...})` object is not typechecked
  against the DTO, so a fixture can keep sending a field that no longer exists, or omit
  one that became required, with the compiler silent. This is exactly why a response- or
  request-shape change needs the full e2e sweep and not a typecheck plus a targeted run.
- **A write that quietly rewrote every line it was not asked to touch.** Inserting two sections
  into this file with a Python text-mode write converted the whole file from LF to CRLF: 137 new
  lines arrived as a **1917-line diff**, and `package.json` as a 50-line one. Nothing errored, the
  content was correct, and the change would have reached review as a whole-file rewrite with the
  real edit buried inside it — and `git blame` for the file reset to one commit. Caught by reading
  `git diff --stat` and disbelieving the number, then hexdumping both versions; the first check
  (`grep -c` for a CR) gave a confidently WRONG answer, which is this section's own shape one level
  down. On Windows, text-mode `open(p,'w')` translates `
` to `os.linesep` on the way out, so a
  read-modify-write round trip is not a round trip. Use binary mode, or `newline=''`, and check the
  diffstat against the size of the edit you meant to make.
- **A test whose assertions cannot fail** — the `isSystem` bypass, the reviewer tiering,
  the concurrent-revoke race. Planting is the answer, and a plant that does not fire (the
  ordering plant that left the real comparator in place) is the same mistake one level up.

**How to apply.** When a step's output would change a decision, ask what it would look
like if the step were wrong — and whether you would notice. A grep that finds nothing and
a grep scoped wrongly are indistinguishable from the output. So prefer the authority (read
the model, query the database, run the code) over a search ABOUT the authority; and when a
search is the practical option, confirm the negative a second way. A database refusing an
insert is verification. A grep finding nothing is a hint.

---

### 1.21 `P3` — The directory view re-aggregates every insurer on every query

`InsurerDirectory` groups every office's `Insurer` rows on each read. Measured on db-test,
which holds 6,059 directory entries over ~5,400 insurer rows:

```sql
EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM "InsurerDirectory"
  WHERE "name" ILIKE '%Yarmouk%' ORDER BY "name" LIMIT 50;
-- Planning 54.8 ms, Execution 144.1 ms
```

Fine now, and the number is here so a future decision has data rather than a hunch: the
cost scales with the PLATFORM-wide insurer count, not with one office's, because the whole
point of the view is that it spans offices. A `LIMIT 50` does not save it — the aggregate
is computed before the filter can apply.

At an order of magnitude more rows this becomes a visible page load. The fixes, in
increasing order of commitment: an index supporting the group key (the `canonicalName`
index exists; `insurerMasterId` is already indexed); a MATERIALIZED view refreshed when an
insurer is written; or the honest end state, a real `Company` table that registrations
write to, with the per-office `Insurer` row pointing at it — which is roughly the
`InsurerMaster` idea done properly, and a much larger decision than a performance fix.

**A CONDITION ON WHICHEVER SUCCESSOR IS CHOSEN, recorded now while the reasoning is
here.** The directory is read-only by ACCIDENT, not by design: an aggregating view is not
auto-updatable in Postgres, and this database's default privileges grant
INSERT/UPDATE/DELETE on new relations — so the `GRANT SELECT` is not what protects it. A
materialized view would keep the property by accident again. **A real table would lose it
silently**, on the exact day somebody is thinking about query plans rather than about
tenancy. So:

- whichever successor is built, the read-only guarantee is re-established EXPLICITLY —
  revoked writes, or a trigger, or an RLS policy with no permissive WITH CHECK — and the
  choice is stated in the migration;
- the measured `DELETE FROM "InsurerDirectory"` test STAYS, pointed at whatever replaces
  the view. A test that currently passes for an incidental reason is a test that will keep
  passing right up until it should have failed.

**And the sideways question, checked rather than assumed:** something DOES already assert
that a new tenant-scoped table arrives governed. `tenant-isolation.e2e-spec.ts` enumerates
every `relkind = 'r'` table carrying `organizationId` and fails if any has
`relrowsecurity = false` or no policy — the whole-set pattern (§ 1.19), and the two tables
this feature added passed it. What that guard does NOT cover is a non-table relation, which
is exactly where the incidental property above lives: `relkind = 'r'` excludes views. That
gap is the reason the condition above is written down rather than left to be noticed.

Not acted on otherwise, deliberately: 144 ms against a database holding more insurer rows
than any real deployment will have for a long time is not a problem, and the shape of the
fix depends on whether the `Company` question gets reopened.

---

### 1.22 — RESOLVED (2026-09-20): eleven tests failing together was not a flake

`kyc-screening-hold.e2e-spec.ts` failed all eleven of its tests in one batch run and passed
70/70 on the next. The shape was wrong for a flake — a flake is one test, or a scattering,
not a whole file in lockstep — so it was not closed as one.

**The mechanism.** Four spec files create a second `Organization` in `beforeAll` and remove
it in `afterAll`: `tenant-isolation`, `insurer-schema-constraints`, `insurer-directory`,
`last-administrator-lock`. A run KILLED mid-flight never reaches `afterAll`. The batch
immediately before the failing one had been killed at a ten-minute tool timeout (exit 143)
— so the office survived into the next run, `POST /auth/signup` refuses once more than one
Organization exists, and every test in the first file that provisions a user died together.
Not a property of the suite; a property of how the suite was being RUN.

**Candidates eliminated, with the evidence, because an eliminated hypothesis is worth more
to the next person than an unexplained pass:**

1. **`app.current_org_id` leaking across a pooled connection — eliminated by reading the
   code, not by reasoning about it.** There are exactly three writers, all in
   `tenant-scope.extension.ts`, and all three are
   `set_config('app.current_org_id', $1, true)` — `is_local = true`, inside a transaction,
   so Postgres reverts it at commit. Had this been the shape it would not have been a test
   problem at all but the cross-office read the whole architecture exists to prevent, which
   is why it was checked first.
2. **Advisory-lock contention — eliminated.** `pg_advisory_xact_lock` is transaction-scoped
   (`_xact_`), so it cannot be held across a batch boundary, and the KYC path takes no
   capability lock.
3. **A time-dependent fixture — not the cause.** Re-running batch 5 then batch 6 cleanly
   reproduced neither the failure nor any leftover office; the failing run's distinguishing
   feature was the killed predecessor, not the clock.

**Fixed so the next occurrence diagnoses itself.** `createTestApp()` — which every spec
calls — now refuses to boot when more than one Organization exists, naming the leftover
office by legal name, subdomain and id, and saying to re-run the spec that owns that id
(each sweeps in `beforeAll`). Proven by planting the exact row a killed run leaves behind:
eleven `expected 201, got 500` became one sentence that names the cause. Safe for the four
legitimate creators, all of which call `createTestApp()` before standing their second
office up — verified by running all four plus the victim together, 46/46.

**Still the underlying defect: § 1.11.** If `signup` refused with a 409 and its real
message instead of a bare `Error`, none of this investigation would have been needed. The
guard makes the symptom legible; it does not make the endpoint honest.

**A SECOND mechanism with the same symptom, found the next day.** `audit.e2e-spec.ts`'s single
test failed inside a batch and passed alone and on re-run. Measured: it needs **99.5 seconds in
isolation** against the suite's 180 s default — 55% of its budget before any other file has
touched the database — because it boots the app, signs a user up, logs them in (two bcrypt
hashes) and then attacks a row. Eight preceding files are enough to push it over. Fixed with an
explicit 600 s and the measurement in a comment.

So &ldquo;fails in a batch, passes alone&rdquo; has at least two causes worth separating before
either is called a flake:

| Symptom | Mechanism | How to tell |
|---|---|---|
| MANY tests in one file fail together | shared state — a leaked Organization, a truncated cache | they fail at the same call (`signup`, a fixture helper), and the file passes once the state is cleaned |
| ONE slow test fails | no timeout headroom under load | time it in isolation; if it uses a large fraction of its budget alone, it has none in company |

The general rule: **time a test alone before believing it is flaky.** A runtime that is a large
fraction of the budget is a prediction of failure, not bad luck.

---

### 1.23 `P1` — A comment that states an invariant is a test that does not run

Met three times, and each meeting was later than the last.

**Late (F4, and the `IN_FORCE_POLICY_STATUSES` header).** A comment asserted a property,
the property changed, and the comment became a confident lie that outlived it — "ANALYZE
makes this exact" when `ANALYZE` samples; "the Policy module is not built, so the table is
empty" years after Domain B shipped. Each was found by someone who happened to be editing
nearby, which is the only way a comment ever gets corrected.

**Early (2026-09-20).** `tenant-isolation.e2e-spec.ts` said the insurer-form-mapping case
was "the one Part V item where the correct answer is that a row IS visible across offices".
The insurer directory made that false, and the comment was corrected in the SAME commit
that falsified it — now naming the directory as the second case and pointing at the file
that proves it, rather than duplicating those tests into a tenancy matrix.

**Later still, and not in a comment at all (2026-09-21).** `turbo.json` declared
`outputs: ["dist/**", ".next/**", "!.next/cache/**"]`. That exclusion was CORRECT when it was
written: it kept Next's incremental cache out of the build artifact. Next then moved the dev
server's cache to `.next/dev/cache`, which `.next/**` matches and `!.next/cache/**` does not —
and the config went on looking correct while sweeping **826 MB of stale dev-server artifacts into
every cache entry**, four days out of date at the point of measuring. Nothing failed. It was found
only because the cache reached 36 GB and filled the disk (§ 1.32).

So the class is wider than comments: **a config exclusion encodes an assumption about another
tool's directory layout, and when that tool moves, the config becomes a lie that fails silently.**
A comment at least sits beside the code it describes, where someone editing nearby may notice. A
path glob describes a directory tree the repo does not own and no reviewer inspects, so it has no
reader at all — which makes it the worst-case version of this failure and the reason the first two
meetings were found in years and this one in gigabytes.

Not worth a hunt, but worth knowing: **other exclusions in this repo make the same kind of
assumption** — the remaining globs in `turbo.json`, `.gitignore`, `.dockerignore`, the
`include`/`exclude` sets in the `tsconfig.json` files, and Playwright's `testIgnore`. Each is a
bet on where another tool puts its files. A dependency major-version bump is the moment to
re-check the ones belonging to that dependency.

**How to apply.** When a change makes a comment's claim false, the comment is part of the
change. Three habits carry it:

- Grep for the claim, not just the code. A commit that makes "the only", "always", "never"
  or a count false somewhere else has to fix that sentence too — `grep -rn "the one\|the
  only\|always\|never" ` over the touched area costs seconds.
- Treat a path glob as an assertion about someone else's layout, and give it a witness where
  one is cheap. The `!.next/dev/**` fix is still just a glob; what makes it noticeable next time
  is `prune-turbo-cache.mjs` printing the largest cache entry and flagging it when it exceeds
  what a build output should be. The glob can still go stale — the size check is what says so.
- Prefer a claim that CANNOT rot: an assertion instead of a sentence. "Exactly these nine
  columns" as a test beats "this view exposes only public data" as a comment, and § 1.19 is
  the pattern for turning one into the other. Where a comment is genuinely the right home —
  reasoning, history, a rejected alternative — it should state WHY rather than WHAT IS, and
  a why does not go stale when a count moves.

---

### 1.24 — ACCEPTANCE PATTERN: a read surface must be checked against its WRITERS, not only against what it reveals

The insurer directory was accepted on conditions that were all satisfied: a security-definer
view, an `information_schema` allow-list, planted leaks, a proven-refused write, measured
cross-office invisibility. Every one of those asks **what does this surface expose**.

None of them asked **does this surface agree with the write path that feeds it** — and it did
not. The directory grouped two spellings as one company; registration's unique index accepted
them as two rows. Two insurer records, two sets of credit terms, one line on the screen, no
error anywhere. Live inside an accepted commit for two days (F13, fixed by migration
`20261013100000`).

**The general form, for every read surface from here:** a derived read — a view, a
materialised projection, a cached aggregate, a report — has at least two properties to check,
and exposure is only the first.

| Ask | Catches |
|---|---|
| What does it expose? | leakage — the allow-list, the planted sentinel |
| **Does it agree with its writers?** | **a surface whose grouping, filtering or dedupe rule differs from the constraint the write path enforces** |
| What does it do when its inputs are absent? | an unkeyed row, a NULL join, an empty aggregate silently reading as "none" |

The second failure has no symptom. Nothing errors, nothing is missing, and the screen is
confidently wrong — which is why it needs an explicit question rather than a reviewer's
instinct.

**How to apply.** For any derived surface, name the rule it applies (group by X, dedupe on Y,
filter on Z) and then find the WRITE-side constraint that is supposed to make that rule
correct. If the two are different expressions, they are two definitions and they will diverge;
if you cannot find a write-side constraint at all, the surface is asserting something nothing
enforces. The fix in both cases is one definition — and § 1.19's whole-set pattern is how you
keep it one: `canonical_name_key()` is a single database function, used by the view's
`GROUP BY` and by the unique index, with the TypeScript mirror pinned to it by a table of
names asserted against both.

---

### 1.25 — RESOLVED (2026-09-22): the commission variant, and the NULL-uniqueness defect in the obvious key

#### What the data said when it was finally measured

The variant was designed as a prediction — "the 32 cannot express fleet-vs-individual … and
`Property All Risks (Fire)` carries its own commission rate today". It is now an observation:

```
 code               | the two strings                                | open rows
 PROPERTY_ALL_RISKS | Property All Risks ++ Property All Risks (Fire)|     2      (x6 insurers)
```

**Six insurers each carry TWO simultaneously-open commission agreements**, every one of them that
same pair. Not duplicates — a fire-only property rate is a different commercial term — and the
pre-existing partial unique index permitted them only because it keys on the **string**, where the
two differ.

**So moving that index onto the line id WITHOUT a variant would have collapsed six legitimately
distinct rates, and the index could not have been created.** The variant is load-bearing, and the
evidence arrived from the conversion rather than from argument.

**And a correction I owe, of the § 1.20 kind.** I first reported "CommissionAgreement has no unique
constraint today — only an index". Wrong: `CommissionAgreement_one_open_per_insurer_line`
(`UNIQUE (insurerId, insuranceLine) WHERE effectiveTo IS NULL`) has existed since
`20260903120000`, and the repository comment claiming to "mirror the partial UNIQUE index" was
accurate. I read the Prisma schema — which cannot express a partial index — and concluded none
existed instead of reading the database. **A grep of the schema is not a read of the schema**, in
the same file that records that lesson.

#### What was built

`variant` (free text, stored for display) plus **`variantKey`, a `STORED GENERATED` column over the
same `canonical_name_key()` that backs `Insurer.canonicalName`** — reused rather than reinvented, so
"Fleet"/"fleet"/" FLEET " are one variant and the Arabic folding comes free. Free text on a
*matching* path is the defect this whole line of work removes, one level down.

The derivation promoted the distinction out of the retained string — `Property All Risks (Fire)` →
`Fire`, `Motor Fleet` and `Group Medical` → **`Collective`**, `Individual Medical` → `Individual`.
Two axes, not four cases: collective is fleet AND group (one contract covering many insureds,
expressed in two lines of business); `Fire` is a named sub-peril. Named that way so the next person
asks which AXIS a new variant is, rather than appending to a list of observed spellings. This only
worked because `20261019100000` retained `insuranceLine` — which is what rule 3 of § 1.26 is for.

#### The NULL defect, proven by three plants rather than by reading the DDL

`UNIQUE (insurerId, insuranceLineId, variantKey)` does not constrain two rows that both have a NULL
variant, because Postgres treats NULLs as distinct — so **the plain-line case, the common case, is
exactly the one a naive constraint misses**, on the table that decides what the broker is paid.
`NULLS NOT DISTINCT` is the fix, and all three plants were read:

1. **Two NULL-variant agreements, same line id, DIFFERENT strings** — so the old string-keyed index
   could not refuse either and only the new one could:
   ```
   ERROR:  duplicate key value violates unique constraint
           "CommissionAgreement_one_open_per_line_variant"
   DETAIL:  Key ("insurerId","insuranceLineId","variantKey")=(…, …, null) already exists.
   ```
   `null` in the DETAIL is the whole point. My FIRST attempt used the same string twice and was
   refused by the OLD index — **a plant that proved the wrong constraint**, which is § 1.37's rule
   arriving on its author: the test went red without exercising the thing under test.
2. **Plain + a variant on one line: BOTH allowed** — the six real pairs survive, so the index is not
   merely too strict.
3. **`'  fIrE  '` refused against `'Fire'`**, key shown as `fire` — the canonical key folds case and
   whitespace, so a sloppily typed variant cannot open a near-duplicate rate.

A pre-check refuses the migration if any (insurer, line, variant) still has two open agreements,
naming the insurer and **both rates** — because a migration must not choose what the broker is paid.

#### A BLIND SPOT this found in `db:divergence`

`migrate diff` **does not report partial indexes**. Two live UNIQUE partial indexes on this table —
the old string-keyed one and the new one — have never appeared in the divergence set, so a future
migration could drop either and the gate would stay green. CHECK constraints are invisible to it
too. Recorded in the script's own header, with the rule: where a partial index carries a real
invariant, assert it in its migration's `DO` block (as `20261020100000` does for
`indnullsnotdistinct`, read from `pg_index`) or in a test — do not rely on that gate for it.

#### The original decisions, unchanged

Decided (and NOW built):

- A `variant` beside the managed line id on the models that sit on a crossing, because the 32
  cannot express fleet-vs-individual, group-vs-individual medical, or a named sub-peril, and
  `Property All Risks (Fire)` carries its own commission rate today.
- **Stored for display, matched on a CANONICAL KEY** — the same generated-column treatment as
  the company name. Free text on a matching path is the defect being removed, one level down.
- **Not** a managed catalogue. A second vocabulary and a second add-flow, invented before the
  shape is known, is the closed-list mistake again.
- The entry control offers the variants already used for that line **in this office**, so
  consistency is the default path rather than a discipline somebody maintains.

**Why that is sufficient here and insufficient for lines — the load-bearing reason.** Variant
matching happens WITHIN ONE OFFICE on both sides (a policy and a commission agreement belong
to the same office). A LINE crosses offices, through the directory. A key only has to be shared
as widely as the comparison it serves.

**The graduation condition, as a trigger rather than a judgement call:** the moment a variant
must be compared ACROSS offices, or appear on the directory, it becomes a managed list.

**A defect in the obvious key, which touches money.** `UNIQUE (insurerId, insuranceLineId,
variant)` does **not** constrain two agreements that both have a NULL variant — Postgres treats
NULLs as distinct in a unique index, so the plain-line case, which is the common case, is
exactly the one the constraint misses. A unique that does not unique, on the commission table.
Use `NULLS NOT DISTINCT`, or index over `COALESCE(variant_key, '')`. **Settle it in the same
commit and prove it by planting two NULL-variant agreements and watching the insert be
refused — not by reading the DDL.**

**Two axes, not three things** (recorded while the evidence is in front of us): fleet and group
are the SAME axis — one contract covering many insureds, expressed in two lines of business. A
named sub-peril is a different axis. Whoever eventually builds a managed variant list should
start from two axes rather than an enumeration of the cases we happened to observe.

---

### 1.26 `P1` — TO BUILD: the line migration is TOTAL, and the old column drops on a MEASUREMENT

> **Amended 2026-09-22 — read § 1.40 first.** The migration below IS total over the rows that
> existed when it ran, and the numbers it reports are accurate. What it does NOT do is change
> any writer: nothing in the application sets `insuranceLineId` or `officeInsuranceLineId` on
> these four models, so every row written since is unmapped (measured: 6 on
> `InsuranceProgramLine`, 4 on `RFQ`, both models the migration mapped 100%). The word
> "converted" therefore overstates the state, and the drop-the-string gate below cannot go
> green until the writers land.

The rule for converting the six free-text `insuranceLine` columns, decided before any of it is
written, because it is the part that goes wrong quietly:

- **Every row either maps to a line id, or is explicitly PARKED** — its original string
  retained and reported. Nothing is silently dropped.
- **Nothing is funnelled into an "Unclassified" line.** An unclassified line is a line nobody
  writes, and it would poison the directory that the whole conversion exists to serve.
- **The old string column is dropped only when a test MEASURES zero unmapped rows** — not when
  we believe there are none. The drop becomes conditional on a measurement, the same move as
  the unique-index inventory and the status partition.

Two values need a human decision and get one in the seed rather than a mapping table, since
every row in every database is synthetic: `General/Product Liability` (spans two of the 32) and
`Fire & Property` (ambiguous between Fire & Allied Perils and Property All Risks). Building
machinery to interpret fiction is the tidiness being avoided.

The general case is not those two. `db-test` holds **178 distinct Policy values and 4,213 RFQ
rows** — fixture noise, but it is what an unconstrained column attracts, and the conversion has
to tolerate values no mapping table anticipates. That is why the rule is totality plus a
measured gate, rather than a mapping table plus confidence.

#### FIVE of the six are DONE (2026-09-22): the four MUST models

`InsuranceProgramLine`, `RFQ`, `Policy`, `CommissionAgreement` — the four where a line must MATCH
another model's for the system to work: a programme line becomes an RFQ, an RFQ becomes a Policy,
and a CommissionAgreement is applied to a Policy by line. Four independently-typed strings cannot
be matched; four FKs to one catalogue can.

All four are OFFICE-SCOPED, so all four take **both** FKs with a CHECK that at most one is set —
the opposite of `InsurerFormTemplate` below, and by the rule rather than by taste.

**The mapping was derived from the data, not imagined.** Measured first, then written:

| | outcome |
|---|---|
| `InsuranceProgramLine` | **962 / 962 mapped**, 0 parked |
| `RFQ` | **4,449 / 4,449 mapped**, 0 parked |
| `Policy` | **4,994 mapped, 632 parked** |
| `CommissionAgreement` | **287 / 287** on db-test; on dev **42 / 43**, the parked one being `'any thing'` |

The 632 is exactly the 393 bare `motor`/`Motor` rows plus the 239 `portfolio-e2e-line-<timestamp>`
fixture rows predicted from the vocabulary survey — the measurement confirming the analysis rather
than a number that happened to appear.

**`motor` parks deliberately, and this is the judgement worth recording.** Unqualified "motor" is
ambiguous between `MOTOR_TPL_COMPULSORY` and `MOTOR_COMPREHENSIVE` — compulsory third-party cover
and comprehensive cover are different products at different premiums. A mapping that guessed would
silently reprice business. Parking 393 rows is the cheap outcome; guessing is the expensive one.

**Four values map to the right LINE with their variant pending**: `Motor Fleet`, `Group Medical`,
`Individual Medical`, `Property All Risks (Fire)`. The 32 cannot express fleet-vs-individual or a
named sub-peril. That is not information loss **because the original string is retained** — which is
the whole reason rule 3 exists — and § 1.25's variant axis derives them next.

Note the catalogue's own asymmetry, which decided two of those: `LIFE_GROUP` and `LIFE_INDIVIDUAL`
are separate lines, so `Group Life` maps to a real line, while there is only one `MEDICAL_HEALTH`,
so `Group Medical` needs a variant. Recorded as SEEN and left alone when the 32 were seeded.

**The tenancy guarantee is proven, not asserted.** Each model got a composite
`(officeInsuranceLineId, organizationId) -> OfficeInsuranceLine(id, organizationId)` FK. Planted a
cross-office reference inside a rolled-back transaction — a second office, its own line, then a
Policy from the first office pointed at it:

```
ERROR:  insert or update on table "Policy" violates foreign key constraint
        "Policy_office_line_same_org_fkey"
DETAIL:  Key (officeInsuranceLineId, organizationId)=(plant-line-x, 00000000-…-000000000001)
         is not present in table "OfficeInsuranceLine".
```

The simple FK was satisfied — the line exists — so only the composite could refuse it. Rolled back,
Organization count still 1, so the two-Organization guard was never exposed to a leak.

**And `db:divergence` caught my own migration TWICE**, which is the week's investment paying for
itself again. First the four `@@index([insuranceLineId])` declarations (expressible, so declared
rather than allow-listed). Then the one that mattered: I had added only the COMPOSITE FK, while
`schema.prisma` declares an ordinary relation — so the next generated migration would have added
the simple FK as an unreviewed change. `InsurerOfferedLine` has had **both** since it was built
(measured), and they do different jobs: the simple one is what Prisma's client and referential
actions are built against; the composite one is the tenancy guarantee. Fixed forward in
`20261019110000` rather than by editing an applied file, with an assertion that BOTH survive —
because "tidying away the duplicate FK" reads as cleanup and removes tenant isolation.

#### One of the six is DONE (2026-10-16): `InsurerFormTemplate.insuranceLine`

The easy one, and worth recording precisely because its ease does not transfer. It held **zero
rows on both databases**, so the migration needs no mapping at all — and rather than assume that
stays true, it **REFUSES on any database that has rows**, naming the distinct strings it found:

```
ERROR:  2 InsurerFormTemplate row(s) exist, carrying these free-text lines:
  'Motor Comprehensive', 'vehicle'
... There is no automatic mapping from free text to the managed vocabulary — "Motor",
"motor comprehensive" and "Vehicle" are all plausible strings for one line, and choosing for you
would attach a form to the wrong line that every office then submits against.
```

Planted two rows on dev and watched it refuse before applying for real. That refusal IS the
totality rule for the zero-row case: nothing silently dropped, nothing invented.

#### THE RULE, not this commit's reasoning

> **A row every office READS may only point at things every office may SEE.**

Ask it at every one of the remaining conversions, and at any new model: **is this row read by one
office, or by all of them?** Global-only FKs for the shared ones; both FKs for the office-scoped
ones.

**The asymmetry is the part to keep.** Getting it backwards on an office-scoped model
OVER-RESTRICTS — an annoyance, visible immediately, fixed in an afternoon. Getting it backwards on
a global model DISCLOSES — invisible, and exactly what this architecture exists to prevent. When
unsure which side a model is on, the safe default is global-only, because the failure mode is the
recoverable one.

This is the mirror image of the rule `insurer.form.map` produced: *a permission whose effect
crosses offices is a symptom of cross-office DATA.* Same law read from the other end — that one
starts at the permission and finds the data; this one starts at the data and constrains the
reference.

**The design decision the other five do not share.** This model references the GLOBAL
`InsuranceLine` **only**, never `OfficeInsuranceLine` — the opposite of `InsurerOfferedLine`,
which carries both. The reason is tenancy, not taste: `InsurerFormTemplate` has no
`organizationId`, it hangs off `InsurerMaster`, so one mapping is read by EVERY office. A row
pointing at an office's own line would put office A's private vocabulary on a row office B reads.
The composite-FK guard used elsewhere is unavailable, because a global child has no
`organizationId` to agree with — so the constraint is the FK pointing at one table, plus a 422
that explains it, plus a deploy-time assertion that no FK to `OfficeInsuranceLine` exists (a
future migration adding one "for symmetry with InsurerOfferedLine" is the plausible mistake).

**Each remaining column needs that question asked separately:** is this row read by one office or
by all of them? Global-only for the shared ones, both FKs for the office-scoped ones. Getting it
backwards on an office-scoped model merely over-restricts; getting it backwards on a global one is
a disclosure.

**Also retired with it:** a `mode: 'insensitive'` filter on the old string column, which existed
only so `"motor"` would find `"MOTOR"`. Leniency was a symptom of free text; with a managed
vocabulary the question has one answer, and the e2e test that asserted case-insensitivity was
replaced by tests for what the id is NOT — unknown id 422, office line 422, non-uuid 400.

#### AND THE INTERACTION THAT INVERTS IT: Q9 — RE-DERIVED (2026-09-22), AND THE PREDICTION WAS WRONG

This entry said: **Q9 makes `InsurerFormTemplate` OFFICE-SCOPED** — add `organizationId`, make
`insurerMasterId` nullable, take both line FKs, delete `assertGlobalLine` — and it said the commit
must **re-derive** rather than patch around. Re-deriving is exactly what produced a different
answer, which is the best argument for that instruction surviving.

**What was wrong.** `InsurerFormTemplate` is global ON PURPOSE. It hangs off `InsurerMaster`, so a
mapping made once is readable by every office — Part I §5's promise and a Part V multi-tenancy
checklist item. Adding `organizationId` would have withdrawn that **silently**: `applyTenantScope`
adds `where: { organizationId }` to every query on any model carrying the column, the scoped set is
DERIVED from the DMMF, and there is no third state. A row visible to every office and a table the
extension scopes are mutually exclusive, and the only way to have both is to special-case the one
mechanism protecting ~100 other tables.

So the prediction would have traded a stated requirement for a table shape, and the trade would not
have shown up as a failing test — it would have shown up as a new office inheriting no mappings,
months later.

**What was built instead**: `OfficeInsurerFormTemplate`, hanging off the office-scoped `Insurer`.
The same split that already exists one level up, for the same reason:

    InsurerMaster (global)  -> InsurerFormTemplate        shared, catalogue lines only
    Insurer       (office)  -> OfficeInsurerFormTemplate  one office, either catalogue

**How the three re-derivations actually resolved** — two inverted, one dissolved:

1. **BOTH nullable line FKs — CORRECT, on the new model.** And for the predicted reason: once the
   child carries an `organizationId`, an office's own added line is a legitimate referent, and the
   composite-FK guard `(officeInsuranceLineId, organizationId)` becomes available.
2. **`assertGlobalLine` deleted — WRONG. It stays.** Its stated precondition ("the model is
   GLOBAL") is still true of the model it guards. The two endpoints now differ deliberately, and
   `office-insurer-forms.e2e-spec.ts` asserts both halves in ONE test, because either alone would
   pass against a system that had stopped checking.
3. **`insurerMasterId` nullable — DISSOLVED.** The new model hangs off `Insurer`, whose
   `insurerMasterId` is already nullable, so it needs none of its own. The gap Q9 existed to close
   — "for a locally registered company a form template is unrepresentable" — disappears rather than
   being patched.

**Measured before choosing**: `InsurerFormTemplate` held 0 rows on dev and 0 on db-test, so neither
shape had a data-migration cost. That is precisely why the decision was worth making now — both
were free before any office had mapped a form, and only one stays free afterwards.

**A generated column written, measured, and removed.** The new table first had a `GENERATED`
`lineKey` (COALESCE of the two line columns), on the argument that `InsurerOfferedLine`'s
two-nullable-uniques shape becomes unsafe once a `version` joins the key. A temp table with exactly
those two indexes refused the duplicate, so the argument was false: the `exactly_one_line` CHECK
means every row is constrained by the index whose column is NOT null. Dropped — it bought nothing
and cost a database feature `schema.prisma` cannot express plus another `db:divergence` entry.

**On the deploy-time assertion in `20261016100000` forbidding an FK to `OfficeInsuranceLine`:** it
never needed retiring, and now never will — it guards the GLOBAL table, which did not change.

**The durable lesson, which is why this correction is kept rather than edited away:** a prediction
about a future commit is written with the information available then, and the thing it most often
gets wrong is not the mechanism but WHICH OBJECT changes identity. This one assumed one table would
become office-scoped; the codebase's own established answer to "a global thing plus an office's own
thing" is two models, and it was already visible one level up in the same file. **An entry that
says "re-derive" survives being wrong. One that says "do these three things" would have been
followed.**

---

### 1.27 `P1` — The test database cannot exercise a class of TEXT behaviour, and this system is Arabic-primary

Found by planting a missing `COLLATE "C"` and watching parity stay green. The test was correct;
**the database it ran against could not disagree with it** — the §1.8 class in its most
dangerous form, because nothing is wrong with the assertion.

**Cause, measured.** Every Postgres in this project is `postgres:18-alpine` — dev, test, uat
and CI (`docker-compose.yml` ×3, `.github/workflows/ci.yml`). Alpine is musl, which ships no
locale data, so a database created as `en_US.utf8` silently behaves as `C` for collation.

```sql
-- on this database, right now
SELECT array_to_string(ARRAY(SELECT t FROM unnest(ARRAY['f','é']) t ORDER BY t), ',')              -- f,é
     , array_to_string(ARRAY(SELECT t FROM unnest(ARRAY['f','é']) t ORDER BY t COLLATE "C"), ','); -- f,é
-- identical. On glibc/ICU the first is 'é,f'.
```

**What that makes untestable here — the class:**

| Behaviour | Status on this image | Consequence if production differs |
|---|---|---|
| `ORDER BY text` without explicit `COLLATE` | indistinguishable from byte order | a sort the tests certify is not the sort users see |
| `lower()` / `upper()` on non-ASCII | works (folds `É`→`é`) | breaks only on a `C` **CTYPE** build, not on glibc |
| POSIX classes (`[[:alnum:]]`, `[[:space:]]`, `\w`) on non-ASCII | works (Arabic is alnum) | on a `C` CTYPE, **every Arabic letter is punctuation** |
| `ILIKE` / pattern matching on non-ASCII | case-folding is CTYPE-dependent; Arabic is caseless so unaffected, Latin accents are not | the directory's `ILIKE` search behaves differently on accented names |
| ICU collations (`COLLATE "…-x-icu"`) | none used anywhere | — |

The two CTYPE rows were not hypothetical for `canonical_name_key`, whose whole job is folding
Arabic: under a `C` CTYPE the key of every Arabic name was the EMPTY STRING, so every
Arabic-named local insurer in one office collided on one key, the unique index refused the
second, and the directory merged them into a single entry.

**RESOLVED for that function (2026-09-21) by REMOVING the dependency, not by asserting it.**
Recording a precondition leaves the hazard in place and trusts a future reader to honour it —
and the hazard here is one a reasonable person would walk into while tidying up, since adding
`COLLATE "C"` or creating the database with `LC_CTYPE=C` both look like reproducibility wins.
Migration `20261014100000_canonical_key_ctype_free` makes every step fold over an ENUMERATED
character set or a literal Unicode range: `lower()` became a `translate()` over A–Z and the
Latin-1 capitals (Arabic is caseless, so nothing is lost), and `[^[:alnum:][:space:]]` became
`[^a-z0-9ß-öø-þ؀-ۿ]`. `IMMUTABLE` is now true by construction rather than by declaration, and
the TypeScript mirror was brought to the identical rule in the same commit.

Measured before and after, on the same database:
`canonical_name_key('تأمين المركبات الشامل' COLLATE "C")` returned the EMPTY STRING under the
old definition and now returns the identical key to the un-collated call. So the parity spec's
CTYPE assertion inverted: it used to assert the database HAS a UTF-8 ctype (a precondition), and
now asserts the function does not care (a property). Keeping the old test would have blocked a
C-locale deploy the function handles correctly.

**And the assertion moved to where the property matters.** No test of ours can run on the
production database, so the check lives in the migration itself — a `DO` block that refuses to
deploy if the Arabic key comes back empty, if the Latin-1 fold is not applied, or if the token
sort is not byte-ordered. It earned itself immediately: its first version expected `'etoile'`,
the function returned `'étoile'`, and the deploy failed — I had decided the accent rule two
different ways inside one commit. Accents are preserved and only case is folded, deliberately:
"Zürich" and "Zurich" are plausibly two different companies to a broker.

The remaining rows of the table above still stand for `ORDER BY` and `ILIKE` elsewhere.

**The alignment status, which is better than feared.** Dev, test, UAT and CI all run the same
image, so they agree with each other, and **there is no production build to disagree with** —
no deploy target exists (README § Known gaps: the remaining infrastructure items "mostly wait
on a deployment-target decision"). So this is not a live test-versus-production gap; it is a
condition on a decision not yet made.

**THE CONDITION, to be met before the first real deployment.** The deployment-target decision
must name the Postgres build, and then one of:

1. **Match it** — run the same build in test and CI as in production, which is the outcome to
   prefer: it retires the whole class rather than documenting it; or
2. **Re-measure the class on the chosen build** — every row of the table above — and keep the
   structural assertions only where the behavioural one still cannot run.

The **UTF-8 CTYPE** requirement no longer applies to the canonical key, which is CTYPE-free by
construction; it remains the safe choice for everything else in the table.

**Why this matters beyond one function.** An unmeasured difference between test and production
is the same shape as a mock asserting a hand-written API shape: a second description of reality
that cannot disagree with the first. It was found by accident here. The rest of the class has
not been probed.

---

### 1.28 `P2` — A 99-second e2e test that nobody has looked inside

`audit.e2e-spec.ts` runs one test in **99.5 seconds** measured in isolation (2026-09-21), and
its budget was raised from the suite's 180 s default to 600 s after it failed under batch load.
Raising the budget was right; it is not the whole answer.

Nobody has asked WHERE the hundred seconds goes. It boots the Nest app, signs a user up, logs
them in (two bcrypt hashes at the configured cost) and then attacks a row at the database
layer — which could legitimately account for it, or could be hiding something quadratic in
fixtures: a loop that re-queries, an N+1 in a seeding helper, or a wait implemented as a sleep.

**The rule this exists to prevent:** raising a timeout without asking is how a 100-second test
becomes a 400-second test and then becomes "the suite takes an hour, run it less often".

So the measured duration is recorded beside the raised budget in the spec itself, making growth
visible rather than absorbed. **Next time that file is touched, spend ten minutes finding out
where the time goes.** If the answer is "it covers a lot", that is a fine answer — recorded
once, and then it stops being an open question.

**A second instance, 2026-09-21 — and this one was FAILING, not merely slow.**
`status-writes.inventory.spec.ts` guards a real rule (Part G item 3: no status write bypasses
`transition()`). Its raw-SQL scan took **7056ms against vitest's 5s default**, so it failed as a
TIMEOUT — which is the worst way for a guard to fail, because the report then says nothing about
the property. It surfaced in a full-suite run as 2 failures in 1 file, alongside 2 more that
varied run to run under this host's memory pressure; the timeout was the reproducible one, and it
is not caused by the branch it was found on — the scan covers `apps/api/src/**/*.ts` and its
duration varied 7s to 18s purely with load.

Ten minutes found the cost exactly where this section says to look, and none of it was the
property:

| Change | This test, measured in isolation |
|---|---|
| as found | **7056ms — timed out** |
| skip the regex on files with no `$executeRaw` at all | 1837ms |
| read the tree ONCE and share it with the sibling scan | **5.9ms** |

Both scans had been walking `apps/api/src` and reading every one of ~800 files separately — two
full passes — and the regex nests two bounded lazy quantifiers
(`[\s\S]{0,200}?UPDATE[\s\S]{0,200}?status`), which backtracks hard on a long file. Neither fix
can change an outcome: a file containing no `$executeRaw` cannot match a pattern that requires
one. Verified by planting a `$executeRaw ... UPDATE "Policy" SET status` and watching the faster
scan catch it in 37ms.

The remaining cost (2810ms, the shared read) moved to the sibling test, which now carries an
explicit **20s** budget with that measurement written beside it — because the same work has been
observed at roughly 3x under a full-suite batch, which is how the timeout happened at all.

**And a note on my own numbers, which is § 1.17 arriving again.** The first two versions of that
comment claimed "7.0s -> 0.2s", then "-> 97ms". Both were invented — plausible figures written
before measuring, inside a comment whose entire purpose is to make a cost visible. The real
number was 5.9ms, from `--reporter=json`. A number in a comment is a measurement or it is
decoration; there is no third thing.

---


### 1.29 — RESOLVED (2026-09-21): the gate named "drift check" checked no drift, and there were five

`scripts/verify.sh` carried a gate labelled **"Database Migrations (drift check)"** whose
command was `prisma migrate status`. That command reports whether every migration has been
APPLIED. It does not compare an applied migration's stored checksum against its file.

Measured, not assumed — with a drifted file deliberately planted:

```
$ npm run db:test:migrate:status
92 migrations found in prisma/migrations
Database schema is up to date!          # exit 0
```

`migrate dev` is the command that complains, and this project cannot use it at all (it wants
to reset the dev database over a pre-existing drift, which is why the migrations README
records the non-destructive apply-then-`migrate resolve` route). So for the life of this
repo, nothing checked.

**The whole-set check (§ 1.19) is what made the scale visible.** `packages/db/scripts/check-migration-checksums.mjs`
compares EVERY applied migration's stored hash against its file, on whatever database
`DATABASE_URL` names — `npm run db:checksums` / `db:test:checksums`, both wired into
`verify.sh` beside the now-honestly-named "all applied" gate. First run: **one drift on
db-test, FIVE on dev.** Only one was known about. A check written for the instance we knew
would have found exactly that instance.

**Establishing what drifted, before normalising it.** Re-aligning a hash erases the evidence
of what changed, so each was settled first by hashing every committed version of the file:

| Migration | Stored hash is… | Verdict |
|---|---|---|
| `20261008100000_office_administrator_role` | exactly the file at `31ba45e` | `8c300b8` changed **one comment line**, no SQL |
| the other four | **no committed version of the file** | applied to dev mid-authoring, file edited before commit |

The four are the interesting ones: their stored hashes match nothing in git, because the
content that produced them was a draft that only ever existed on one machine. Two independent
measurements closed them:

1. **db-test carries the COMMITTED hashes for all four.** It was created later, from the
   committed files, and every migration ran. The committed SQL provably builds a working
   database.
2. **`prisma migrate diff --from-migrations ./prisma/migrations --to-url <dev>` is EMPTY** —
   dev's live schema is identical to what the committed set produces from empty.

And measurement 2 is COMPLETE coverage here rather than partial, which had to be checked
rather than hoped: `migrate diff` introspects tables, columns, indexes, constraints and
enums, and is blind to functions, triggers, views, policies, grants and data migrations.
Every statement in those four is of a kind it does see — `ALTER TABLE`, `CREATE INDEX`,
`CREATE UNIQUE INDEX`, `CREATE TYPE`, `DROP INDEX`, and one CHECK constraint added inside a
`DO` block. Had any of them created a function or a policy, the empty diff would have proven
much less.

All five then normalised, on both databases, each named explicitly.

**`migrate resolve` is itself a drift source.** That migration's db-test row carries
`applied_steps_count = 0` — the signature of `migrate resolve --applied`, which records the
hash of the file AS IT IS AT RESOLVE TIME. The documented non-destructive route therefore
stamps a hash mid-session, and any later edit to that file — a comment, a clearer error
message — drifts it. Expect this to recur; the check is what makes it cheap.

**There is deliberately no `--fix` flag.** Re-aligning a hash is a one-keystroke way to
destroy the evidence of what drifted, and the two cases need opposite responses:

- **comments only** → the SQL that ran IS the SQL written down; re-align the stored hash;
- **SQL changed** → the databases were built from something the file no longer says.
  Re-aligning makes that permanent and invisible. Write a NEW migration bringing the schema
  to what the edited file describes, and leave the original alone.

So the script prints the `git log -p` to run and refuses to decide. Guard proven by planting
all three branches and watching each fire: a comment-only edit to an applied migration, an
applied migration whose file is gone, and the `migrate status` non-detection above.

**A filter that ate the evidence, worth its own line (§ 1.20's family).** Reading that
comment-only diff, `git diff … | grep -vE '^[-+][-+]'` — "strip the `---`/`+++` headers" —
printed NOTHING, which reads as "the file did not change". A SQL comment begins with `--`,
so `+-- a new comment` matches that pattern and was stripped. The filter silently removed
exactly the class of line being investigated. Same shape as an `undefined` in a `where`
(§ 1.14): the command succeeded and answered a different question.

---

### 1.30 — RESOLVED (2026-09-21): `schema.prisma` described a weaker database than the one we run

Found while establishing § 1.29's drift. To prove the dev database still agreed with its
migrations I ran `prisma migrate diff`, and then ran it in the other direction — migrations
versus `schema.prisma` — because a CI step had been *claiming* that comparison for months:

```yaml
- name: Verify schema — migration history matches schema.prisma (no drift)
  run: npm run db:migrate:status          # reads neither schema.prisma nor any checksum
```

**Six real divergences, none of them theoretical.** Every one of them was the database being
STRICTER than the declaration — which is why nothing had broken, and why it would have broken
on the next `prisma migrate dev`, whose generated migration is exactly this diff:

| Divergence | What the next generated migration would have done |
|---|---|
| `Insurer.insurerMaster` — DB enforces `ON DELETE RESTRICT`; an **optional** Prisma relation defaults to `SetNull` | dropped the FK and recreated it as `SET NULL` |
| `ScreeningMatch(listType, status)` | `DROP INDEX` |
| `ScreeningMatch(screeningRequestId)` | `DROP INDEX` |
| `ScreeningRequest(subjectFingerprint)` | `DROP INDEX` |
| `WatchlistSyncRun(status, completedAt DESC)` | `DROP INDEX` |
| `Insurer(canonicalName)` + GIN `WatchlistEntry(canonicalTokens)` | `DROP INDEX` |

All six were closed by **declaring** them — `onDelete: Restrict`, six `@@index` lines — with no
migration, because the database already had exactly those objects. `relationMode` is unset
(`foreignKeys`), so Prisma emulates no referential action and the `onDelete` declaration changes
DDL generation only, never runtime behaviour.

**Why the obvious gate cannot exist, and what replaced it.** "The diff is empty" is not a
property this repo can assert: the schema deliberately holds LESS than the migrations do, because
Prisma's language cannot express a STORED generated column, a GIN index on an
`Unsupported("tsvector")` field, or a composite tenant FK. Asserting emptiness would be red
forever, which is presumably why nobody ever tried.

So the gate is the whole-set shape (§ 1.19): `packages/db/scripts/check-schema-divergence.mjs`
asserts the diff is EXACTLY 12 named statements, each carrying the reason it is allowed —
5 generated columns, 3 GIN-on-tsvector, 3 composite tenant FKs, 1 identifier-truncation rename.
**Both directions fail**: a new divergence, and an entry that no longer diverges, so the table
cannot rot into a list of things that used to be true. Both branches planted and observed.
Measured identical on dev and db-test, and measured equivalent to the `--from-migrations` form,
so it compares the live database and needs no shadow database or CREATEDB in CI.

**The residual, stated rather than implied.** The three composite FKs *are* expressible — their
targets carry the `@@unique([id, organizationId])` a composite reference needs. They stay raw
SQL because declaring them pulls `organizationId` into the relation and changes the generated
client's relation shape across models the whole codebase reads. That is a deliberate deferral,
not an impossibility, and it is the one entry in the table that could be retired by a decision
rather than by a Prisma feature.

**The rule.** A divergence is closed by making the schema tell the truth, never by adding an
entry to the allow-list. An entry means every future `migrate dev` generates that statement and
someone eventually commits it.

---

### 1.31 — RESOLVED (2026-09-21): a teardown that ran out of budget corrupted every spec after it

`tenant-isolation.e2e-spec.ts` stands up a second Organization and removes it in `afterAll`.
That teardown issues 16 sequential `deleteMany` calls plus a trigger-suspending transaction
against `db-test`, which is CUMULATIVE — 6,291 `Insurer` rows at the time of writing. Measured
across three runs on this host: **15180ms, 21669ms, 50517ms**, against vitest's **10s default
hook budget**.

So the hook was aborted PARTWAY, every run, and office B survived. And a surviving office B is
not a local failure: `AuthService.signup` refuses while two Organizations exist, so every spec
file that runs afterwards fails at `makeUser` with no visible reason. Measured: **36 failures
across three unrelated spec files**, every one of them the two-Organization guard refusing to
boot, from a single teardown that went 5 seconds over.

**A timeout is usually a nuisance. This one had a persistent side effect**, which is the
distinction worth carrying: when a hook's job is to clean up shared state, its budget is a
correctness parameter, not a performance one. Fixed with an explicit **120s** budget — generous
on purpose, given a 15s-to-50s measured spread — plus a `console.log` of the actual duration on
every run, so growth is visible before it becomes another cliff.

**Two more things fell out of it.**

**The self-heal was ordered so it could never heal.** The suite calls `removeOfficeB()` in
`beforeAll` specifically to recover from a leftover, and its comment says so — but the call sat
AFTER `createTestApp()`, which is where the two-Organization guard lives. The guard therefore
fired before the recovery could run, so the one spec able to clean up after itself was the one
spec blocked from doing it. The sweep now runs first. Proven by planting a leftover office B
directly in the database and watching the suite boot through it.

**The guard's diagnosis was confidently wrong, and I repeated it.** Its message read "almost
certainly a run killed before its afterAll" — a plausible hypothesis written when the guard was
built, stated as near-fact. The first time it fired for real the cause was the budget, not a
kill, and I reported the kill to the user because the message said so. A diagnostic that names
one cause gets believed over the evidence; it now names both routes and tells the reader to
check the owning spec's teardown budget first. **The § 1.20 shape again**: the message produced a
confident answer without checking the thing, and it was mine.

---

### 1.32 `P2` — The Turborepo cache is unbounded, and it had eaten 35 GB

Measured 2026-09-21 while establishing why the api e2e sweep could not complete. `.turbo/cache`
held **36 GB in 2742 entries** spanning ten days — verified twice (PowerShell recursive sum and
`du -sh`) before anything was deleted, because a number that large is exactly the kind worth
disbelieving once.

| | |
|---|---|
| repo total | 37.46 GB |
| `.turbo/cache` | **35.3 GB** |
| `apps/web/.next` | 1.03 GB |
| everything else (all `node_modules`, `dist`, …) | ~1.1 GB |

**One `web#build` cache entry is 1.2 GB** (four of the five largest entries were, at ~50-170s
recorded duration each), and `npm run build` writes a new one on every distinct input hash. Turbo
does not prune its local cache — there is no TTL and no size cap — so the growth rate here was
about **3.6 GB/day** of active work. C: went 20.51 GB free -> 55.82 GB on `rm -rf .turbo/cache`,
matching the measurement exactly.

Also removed: four orphaned Playwright browser revisions (1.21 GB). The installed
`playwright-core` 1.62.1 wants chromium **1234**, firefox **1538**, webkit **2336**; on disk were
chromium 1234 AND 1243, firefox 1543, webkit 2359. Playwright resolves a browser by revision
directory, so 1243/1543/2359 could never be used by this install. The config declares a single
`chromium` project, so firefox and webkit were never used at all — worth knowing before someone
re-downloads 500 MB of them.

**CLOSED WITH A CAP, not a cleanup** — deleting it fixes one day and at 3.6 GB/day the space
returns in ten.

**First, most of the entry should never have been cached.** `turbo.json` declared
`outputs: ["dist/**", ".next/**", "!.next/cache/**"]`. The exclusion was written for Next's old
layout; Next now writes the DEV server's incremental cache to `.next/dev/cache`, which `.next/**`
matches happily. Measured: `apps/web/.next/dev` was **826 MB of the 1.2 GB entry**, with an mtime
four days stale — written by `next dev`, untouched by the build that cached it, while the actual
build outputs (`server`, `static`, `standalone`) totalled ~70 MB. Fixed by adding
`!.next/dev/**`, which should take a `web#build` entry from ~1.2 GB to ~370 MB and the growth
rate to roughly a third.

**Then a cap, because nothing bounded the total.** `scripts/prune-turbo-cache.mjs` enforces
`TURBO_CACHE_MAX_GB` (default **5 GB**), removing oldest entries by mtime, deleting the three
files Turbo writes per hash together so a half-entry can never be served. It runs as
HOUSEKEEPING at the end of `scripts/verify.sh` — never a gate, because a full cache must not fail
a verification run — and the measured growth rate is printed beside the cap so whoever changes
the number sees the trade: a smaller cap costs one cold rebuild, never a wrong result, since a
cache miss is indistinguishable from a first run. Proven against a synthetic five-entry cache:
oldest-first, cap respected, `--report` changes nothing.

`.turbo/` is gitignored (`.gitignore:13`), so nothing here was ever committed.

**The Playwright orphans got the witness they never had.** Four revisions (1.21 GB) were
unusable by the installed playwright-core, and the only reason anyone noticed was a full disk.
`scripts/check-playwright-browsers.mjs` is now a GATE in `verify.sh`: every browser ON DISK must
be a revision the installed `playwright-core` resolves, since that is the failure a version bump
creates silently — it downloads the new revision, the tests pass, and the old directory becomes
unreachable weight. It deliberately does NOT require every default browser to be present: this
repo declares a single `chromium` project and CI installs only chromium, so demanding firefox and
webkit would fail a correct install and invite someone to download 500 MB to silence it. Planted
an orphaned `chromium-1243` and watched it fire with the exact `rm -rf` to run.

**A rule that requires vigilance is not a fix — amended after it failed on its own author.**
This section's first version also reported `effective_cache_size = 5 GB` and claimed "something
set it". Both wrong: `SELECT setting || unit` concatenates `"524288"` with `"8kB"` into
`"5242888kB"`, which reads as 5 GB. It is 524288 x 8kB = **4 GB**, `source = default`.

The lesson taken at the time was "name the units and source beside a number". That rule was
written down and then broken **one day later, by the person who wrote it**, because the
concatenation produces a string that READS CORRECTLY. Remembering is not the fix when the wrong
output is indistinguishable from the right one.

**So the rule is a method, not a discipline: read a Postgres setting through a call that formats
it, because a call cannot produce the wrong string.**

```sql
-- NO:  the output is plausible and wrong
SELECT name, setting || unit FROM pg_settings WHERE name = 'effective_cache_size';
--            -> "5242888kB"

-- YES: either of these
SHOW effective_cache_size;                                    -- -> "4GB"
SELECT name, setting, unit, source FROM pg_settings ...;       -- separate columns, no concatenation
SELECT pg_size_pretty(setting::bigint * 8192) FROM pg_settings ...;
```

The same shape applies beyond Postgres: prefer the form of a query that cannot express the
mistake over the form that requires you to notice it.

**And the thing this measurement DISPROVED, which is the point of taking it.** The sweep's failures
were attributed to "the machine being full" — and the disk was indeed nearly full, which made that
story fit. It was the wrong story. Disk was never the binding constraint: the suite failed on
COMMIT exhaustion (30.89 GB committed against a 31.66 GB limit, 98%) and CPU saturation (100%
across 8 cores), and freeing 36.49 GB changed neither. A small 6-test spec file still took 210s
afterwards. Two constraints that both look like "full" are not one constraint, and fixing the
visible one would have let the next red run be blamed on something already fixed.

---

### 1.33 `P2` — "Response from the Engine was empty" was NOT an OOM, and the mechanism is a 120s transaction

The one failure in the full 91-file sweep (2026-09-21): `rbac.e2e-spec.ts` -> "closes the
double-decide race" reported
`PrismaClientUnknownRequestError: Response from the Engine was empty`, then timed out at 180s.
On a memory-starved machine, in the longest batch (1167s), an OOM kill of the query engine was
the obvious candidate. **It is not what happened**, and checking beat assuming:

| Check | Result |
|---|---|
| WSL kernel log (`dmesg`, 494 lines readable) | **no OOM kill of anything** |
| db-test container | `RestartCount=0`, `OOMKilled=false`, up since Sep 18 |
| Postgres log, 19:10-19:25 window | no crash, no recovery, no fatal |
| Prisma engine type | default `library` — **in-process**, so there is no separate engine process to kill |

That last row invalidates the hypothesis by construction: the thing presumed killed does not
exist as a process.

**The actual mechanism, from the stack.** `LibraryEngine.transaction` ->
`_transactionWithCallback` (an INTERACTIVE transaction) -> `Promise.all (index 0)` ->
`AccessRecertificationService.listItemsForReviewer:198`. That method opens no transaction of its
own; the transaction comes from `apps/api/src/prisma/tenant-scope.extension.ts:493`, which wraps
**every tenant-scoped query** in an interactive transaction — necessary, because RLS needs
`set_config('app.current_org_id', ..., true)` to be transaction-local — and gives it
`timeout: 120_000`.

So: under load the 120s budget expires, the engine's response channel closes, `transaction()`
parses an empty response, Nest maps it to a 500, and the test awaiting that HTTP call hits its
own 180s vitest budget. Corroborated by a separate sighting in the abandoned sweep, same service
and same model, where Prisma said it outright: *"Transaction already closed: A query cannot be
executed on an expired transaction. The timeout for this transaction was 120000 ms."*

The failing test is the concurrency test — it runs two decisions simultaneously by design, so it
is the heaviest thing in the suite and the first thing pressure reaches. That fits, which is
exactly why the kernel log was checked instead of the fit.

**Still open, deliberately.** It passes in isolation 10/10 (670s) and passed in-sweep on other
runs; one green run does not retire a flake, so it stays named.

---

#### The three numbers, measured 2026-09-21 — and they correct the premise

Taken by instrumenting the extension's two transaction call sites to append
`label,duration_ms,in_flight_at_entry`, running 11 spec files (130 tests, 1491s), then reverting
the probe. **n = 11,006 tenant-scoped transactions.**

**1 — Connection pool: 9.** Nothing sets `connection_limit` in any `DATABASE_URL` or in code, so
Prisma's default applies: `num_physical_cpus * 2 + 1`, and this machine has 4 physical cores.
Postgres `max_connections` is 100 on both databases, so the pool is the binding limit, not the
server.

**2 — `maxWait: 30_000`, and this is the bad branch.** Set alongside the timeout in
`tenant-scope.extension.ts`, raised from Prisma's 2 s default. So pool exhaustion does NOT
surface as "Unable to start a transaction in the given time" within two seconds; a request waits
up to **thirty** seconds for a connection first. The legible signal is gone, and what replaces it
is a request that simply takes half a minute.

**3 — The duration distribution, which is the surprise:**

| | |
|---|---|
| p50 | **15 ms** |
| p90 | 26 ms |
| p95 | 36 ms |
| p99 | **127 ms** |
| p99.9 | **34,984 ms** |
| max | **84,661 ms** — 71% of the 120 s ceiling |

≥5 s: 15 transactions (0.14%). ≥30 s: 12.

**The tail is not reads. Every one of the slowest eight is a bulk WRITE** —
`AuditLogEntry.createManyAndReturn` (84.7 s, 78.7 s, 77.6 s, 77.5 s) and
`AccessRecertificationItem.createManyAndReturn` (49.1 s, 46.1 s, 43.0 s, 40.8 s) — all with
`in_flight = 1`, so not contention. That is exactly what the code comment beside
`RLS_SESSION_TRANSACTION_OPTIONS` says motivated raising the ceiling in the first place: a bulk
`createManyAndReturn` that took 5837 ms and died under the 5 s default.

**So "is 120 s the right envelope for a read?" was the wrong question, and it was mine.** Reads
are three orders of magnitude clear of the ceiling — a p99 of 127 ms against 120,000 ms is a
**945× margin**. The ceiling is not masking slow reads because there are none.

**The real defect is that ONE envelope covers both.** The extension wraps every tenant-scoped
operation identically, so a 15 ms read inherits a bound sized for a 40-second bulk insert. That
is what makes a genuinely stuck read illegible: it has no deadline anyone would notice until
120 s, by which point Prisma reports an empty engine response rather than a slow query. A
differentiated envelope — a few seconds for the ordinary case, the long one for bulk writes that
have earned it — costs nothing in tenant isolation, because **the transaction is what protects
RLS; the budget protects nothing.** `set_config(..., true)` stays transaction-local at any
timeout.

**And concurrency reached the pool.** In-flight at entry was 1 for 98.1% of transactions, but the
observed maximum was **9 — exactly the pool size**, twice, in a suite whose files run serially.
Nothing in this measurement is a production load test, and that is the point: if a serial test
suite can touch pool saturation, the concurrent case deserves its own measurement rather than an
assumption. With `maxWait: 30_000`, saturation there looks like thirty-second requests, not an
error.

#### The tail, chased rather than cited (2026-10-15)

The first version of this section filed the 84.7 s write under "which is exactly what the comment
beside `RLS_SESSION_TRANSACTION_OPTIONS` says motivated raising the ceiling". That comment explains
why somebody raised the ceiling. It does not establish that an 85-second audit write is acceptable —
**it is § 1.23 again, the justification beside the workaround accepted as the finding.** So:

**How many rows?** `AccessRecertificationService.startCycle` emits one audit row per ACTIVE USER.
On db-test that is **45,649** in a single batch. 84,661 ms / 45,649 rows = **1.86 ms per row**.

**Is the return value used?** Yes — `recordMany` loops the persisted rows through
`anomalyDetection.evaluate(entry)`, which keys off the persisted `id`/`occurredAt`. So
`createManyAndReturn` is not gratuitous and the "delete six characters" fix does not apply.

**What makes each insert expensive?** `AuditLogEntry` on db-test holds **5,934,528 rows in
3,529 MB** with FOUR secondary indexes plus the primary key, against `shared_buffers = 128 MB`.
Every insert updates five B-trees whose pages cannot be cached. Its two triggers are
`no_update`/`no_delete` (immutability), so they never fire on INSERT and are ruled out.

**And the comparison that reframes it.** Dev has **30 active users and a 3,680 kB audit table**;
db-test has 45,649 and 3.5 GB. db-test is CUMULATIVE — that user count is test accumulation, not
an office. So the 85 seconds is substantially an artifact of the test database's size.

**A correction to the risk statement, mine and the reviewer's.** "Audit entries are written by real
user actions" is true of `record()` — ONE row, 134 call sites, covered by the p50 of 15 ms. It is
NOT true of the slow path: `recordMany` has exactly **two** callers, `access-recertification` and
`internal-controls`, both periodic administrative operations. The 85-second write is a quarterly
batch, not something a user waits on.

**What survives as a real characteristic — now with a number, so it is a closed question rather
than a worry.** `startCycle` writes one audit row per active user **inside one transaction**, so
its duration is O(office size) by construction. At the measured **1.86 ms/row** (which is the
PESSIMISTIC figure — it came from a 3.5 GB table on a starved machine):

| Office size (active users) | One `startCycle` batch | Against the 120 s ceiling |
|---|---|---|
| 50 — a small brokerage | 0.09 s | 0.1% |
| 200 — a large Jordanian brokerage | 0.37 s | 0.3% |
| 1,000 | 1.9 s | 1.6% |
| 5,000 | 9.3 s | 8% |
| **64,500** | **120 s** | **the ceiling** |
| 45,649 — db-test's fixture accumulation | 85 s | 71% |

**So the ceiling is reached at roughly 64,500 users in one office.** The target market is
Jordanian insurance brokerages; the largest plausibly has low hundreds of staff. The margin is
therefore about **300×** on the realistic upper bound, and the only observation near the ceiling
came from cumulative test fixtures, not an office.

**The condition, so this does not have to be rediscovered:** if a single Organization ever passes
about **5,000 active users** — a tenth of the ceiling, and the point where a quarterly admin
action starts taking ten seconds — `startCycle` should batch its audit writes instead of holding
one transaction. Below that it is correct as written, and the arithmetic above is why. Note the
figure degrades as `AuditLogEntry` grows, which is the retention gap recorded immediately
below — the two interact, and the retention decision is the one that moves 1.86 ms/row.

#### AND THE QUESTION NOBODY HAD ASKED: `AuditLogEntry` has no retention plan

**Awaiting a business decision. Recorded here so it is a named gap rather than a discovery.**

`AuditLogEntry` on db-test is **5,934,528 rows / 3,529 MB with four secondary indexes** — on a
TEST database. In production it only grows: every one of the 134 `record()` call sites appends,
nothing removes, and there is no partitioning, no archival and no stated period.

Two consequences, and the second matters more:

**Performance, which is not static.** The measured 1.86 ms/row is a function of that table's size
against `shared_buffers`. It does not stay 1.86 — every month of real use makes every audit write
slower, and an audit write sits INSIDE the transaction of the action that caused it. So this
silently taxes every user action, and the `startCycle` arithmetic above degrades with it.

**Compliance, which is the real problem.** This is a PDPL system with a privacy module, a RoPA
register and retention schedules for other entities (`seed-data/retention-schedule.ts` seeds a
row for `AuditLogEntry`, and `AuditService.getRetentionCutoffDate()` reads it — but nothing
DELETES, deliberately: the table is immutable by trigger and disposal is the dual-control M06
workflow). Data protection law does not permit indefinite retention without a stated basis and
period. **An audit log with no retention decision is not just a growing table — it is a
processing activity the system cannot describe, in a product whose selling point is that it
can.**

**What the owner has to decide**, and it is far cheaper at zero production rows than retrofitted
onto the largest table in the database:

1. **The period**, with its basis — CBJ record-keeping obligations and PDPL minimisation pull in
   opposite directions and the answer is a sourced number, not a guess. The seeded figure in
   `retention-schedule.ts` is explicitly a draft, per its own header.
2. **The mechanism** — monthly `PARTITION BY RANGE (occurredAt)` so old partitions detach in O(1)
   and never need the immutability trigger bypassed, versus archive-then-dispose through the
   existing M06 dual-control path. Partitioning is a schema decision that is nearly free now and
   a migration of millions of rows later.

Belongs in the register of things awaiting a business decision, alongside the four commercial
surfaces.

#### Verdict, revised

**The pool was the urgent part, and it is now fixed.** Nothing set `connection_limit`, so the pool
was `num_physical_cpus * 2 + 1`, evaluated wherever the process happens to run: 9 on a 4-core
laptop, **3 or 5 in an API container limited to one or two cores** — a property the whole
application depends on, decided silently by the environment. And there are TWO pools per API
process (`APP_DATABASE_URL` for ordinary work, the owner connection for identity/bootstrap), each
inheriting that default independently. Now set explicitly — 15 app + 5 owner = 20 per process,
against 97 usable connections, i.e. four instances — in every env template, the local env files and
`docker-compose.yml`, with the arithmetic and the "raise `max_connections` or lower these" note
beside it.

Note what the measurement could NOT establish: observed concurrency peaked at **9, which was the
pool size**, so demand is at least 9 and otherwise unknown. The new figure has headroom for that
reason, not because 15 was measured.

**Still scheduled, on their own branch with the § 1.8 assertions:** (a) split the timeout envelope
so an ordinary operation carries an ordinary deadline instead of one sized for a 45,000-row insert,
and (b) return `maxWait` near its 2 s default so pool exhaustion says "Unable to start a
transaction in the given time" instead of a request that waits half a minute and fails as something
else. Two masks stacked: the slow write hides behind a raised ceiling, and the exhaustion it causes
hides behind a raised wait. Neither weakens RLS — the TRANSACTION protects RLS, the budget protects
nothing.

**A caveat on the sample, since it decides how much the numbers are worth.** 11 of 91 spec files,
chosen for read-heavy and RBAC paths (`rbac`, `tenant-isolation`, `insurer-directory`, `policy`,
`claim`, `commission`, `access-recertification`, `customer`, `kyc`). It is a sample, not the
suite, and it was taken on a machine under load — which biases durations UP, so the healthy-case
percentiles are if anything better than shown. The tail is the part to trust least and it is
still the part that matters.

---

### 1.34 `P1` — When correctness depends on the IDENTITY of characters, do not read them — decode them

Visual identity is not identity. Two strings can render indistinguishably and denote different
sets, and **reading is exactly the operation that fails** — no amount of reviewer care helps,
because the reviewer's eyes are the broken instrument.

**How it was found (2026-10-15).** `canonical_name_key` and its TypeScript mirror both got a new
Arabic combining-mark class, written as literal characters in each file. They looked the same. The
`canonical-name-key-parity` spec disagreed, on `شركة ١٢٣`. Decoded:

| | decoded ranges |
|---|---|
| SQL literal | U+064B..U+065F, U+0670, U+06D6..U+06ED, U+0640 — **correct** |
| TypeScript literal | **U+064B..U+0670**, U+065F, U+06D6..U+06ED, U+0640 |

The TypeScript range ran to U+0670 instead of U+065F, which swallows **U+0660..U+0669, the
Arabic-Indic digits** — so the digit fold never saw them and they were deleted instead of folded.
Every Arabic company name containing a number would have keyed wrongly, in the suggestion layer
only, and nothing but the parity table could have said so.

**The fix, in two parts, and the second matters more than the first:**

1. **Escapes, not literals**, wherever a class or set is authored — `ً-ٟ` is ASCII
   source and cannot carry the mistake. (Postgres regex could not be authored that way through
   this toolchain — the escapes arrived as literal characters — so the SQL side keeps literals
   and asserts its boundaries at deploy time instead. Where you cannot remove the hazard, assert
   against it.)
2. **DECODE BOTH SIDES PROGRAMMATICALLY AND DIFF AGAINST THE INTENDED SET.** Not "read it
   carefully" — parse the class, expand its ranges, and compare to an explicit list of code
   points with their Unicode names. That is what caught the off-by-one above and what verified
   the seven Arabic letter subranges and the mark strip afterwards:

   ```
   kept but NOT intended: none
   intended but NOT kept: none
   ```

**The same failure from the human side, twice in one commit.** The deploy-time assertions in
`20261015100000` caught me classing U+066E/U+066F as punctuation when they are dotless beh and
dotless qaf — **letters** — and using U+FEF3 as a presentation form when it is a yeh. Both were
me misreading a Unicode chart, caught by something that cannot misread. A person reading a code
chart and a person reading a glyph fail the same way.

**Where else this repo makes the bet.** Any literal that encodes a **SET rather than a word** —
these are the places a reviewer is structurally unable to help:

- **Regex character classes** over non-ASCII: `company-name.util.ts` (now escapes),
  `canonical_name_key` (literals + deploy assertions), `apps/web/lib/i18n/fold.ts` (folds Arabic
  for the sidebar filter — same orthography rules, a second copy by design).
- **The Arabic halves of bilingual data** compared across files: `seed-data/insurance-lines.ts`'s
  32 `nameAr` values, the `DocumentTemplate` rows, `translations/ar.ts` keys, and the
  `role-permissions.ts` fixture the web e2e keeps as a third copy of the permission grid. An
  invisible difference there is a lookup that silently misses.
- **Anything compared for equality across two files at all**, which is the general form: a
  constant duplicated between api and web, a fixture mirroring a seed.

**The rule.** If a literal defines a SET, or is compared across a boundary, it needs a mechanism
that decodes rather than a reader who squints: escapes where the language allows them, a
programmatic diff against the intended members, or an assertion at the boundary. Not a hunt —
but when one of those files is next edited, decode it rather than reading it.

**And a second blind spot, found by the same question.** The `status-writes.inventory` guard read
only `apps/api/src`, while its test names claimed "no raw SQL updates a status column"
unqualified — so a status write in `packages/db` or an operational script was outside it forever.
Widened to all three application roots, with migrations named as a DELIBERATE exclusion (a
reviewed one-off backfill is not a runtime bypass, and treating it as one would teach people to
weaken the guard) and a new sanity test that fails if a root moves or the scan shrinks below 500
files — because a scan that quietly covers less is the same failure as one that times out: it
reports success about files it never opened. That test caught an off-by-one in the very paths it
was added to protect, on its first run.

---

### 1.35 `P2` — MEASUREMENT PATTERN: a measurement taken at a limit is a lower bound, not a value

**A limit that binds makes the demand behind it unobservable.** The queue is invisible because the
limit *is* the queue.

Found 2026-09-21 while sizing the connection pool. The instrumented run reported "maximum
concurrency observed: **9**" — and the pool was **9**. That number does not say demand was 9; it
says demand was *at least* 9 and the measurement could not see past the ceiling. Every request
beyond the ninth was waiting, and waiting leaves no mark in a counter of things in flight.

The same shape, elsewhere in this file:

- **§ 1.28** — a test's duration measured against a timeout it was hitting tells you the timeout,
  not the duration. `status-writes.inventory` "took 5 s" because 5 s was the budget; the real
  figure was 7056 ms, and only visible once the budget moved.
- **§ 1.33** — the p99.9 of 35 s and max of 84.7 s were measured under a 120 s ceiling. Had the
  ceiling been 30 s, the same workload would have reported a max of 30 s and a crop of errors.
- **The backup drill (2026-09-17)** — `n_live_tup` after `ANALYZE` reported 4,142,466 rows because
  sampling is what it does. The true count was 4,141,630. An estimator asked for a value returns
  the estimator's answer.

**How to apply.** Before recording a measurement, ask: *is there a limit near this number, and is
it the same number?* If so, say "≥ n" and name the limit — then raise it and measure again if the
value matters. Two honest forms:

- "max concurrency **9**, which WAS the pool size — a lower bound"
- "max concurrency **11** against a pool of 15 — a value"

The first justifies headroom; the second justifies a size. Reporting the first as though it were
the second is how a ceiling becomes a specification by accident.

**Outstanding for this instance:** the pool ceiling moved to 15, so the run should be repeated. If
concurrency peaks at 15, demand is still censored and 15 is also a guess; if it peaks at 11, the
headroom is measured rather than assumed. Rides along with the next instrumented run of those
specs.

---

### 1.36 — RESOLVED (2026-10-16): the status-write guard was blind to the most compact form of the violation

`status-writes.inventory.spec.ts` enforces a MANDATORY rule
(`ibms-brain/meta/lex/workflow-state-transitions.md`: never assign a workflow `status` directly).
Its scan matched a Prisma write with:

```
/\.(\w+)\.(create|update|updateMany|upsert)\(\s*\{([\s\S]{0,900}?)
\s*\}\s*\)/g
```

That `
\s*\}` requires a NEWLINE before the closing brace, and the body was capped at 900
characters. So **a one-line write was invisible to the guard entirely**:

```ts
await p.policy.update({ where: { id: 1 }, data: { status: 'CANCELLED' } });   // NOT CAUGHT
await p.policy.update({                                                       // caught
  where: { id: 1 },
  data: { status: 'CANCELLED' },
});
```

Proven by planting both shapes: multi-line failed the test, single-line passed green.

**The part worth reading is how it got there.** The spec's own comment says the `braceBody` helper
was added *because* a single-line `data: { … }` defeated the payload extraction, and that "a
deliberately planted bypass went undetected until it was tested for". That fix was real — but it
addressed the INNER payload parse and left the OUTER match still demanding a newline. Half the
hole was closed, and the comment recorded the whole thing as solved. **A comment describing a fix
is not a test of the fix's completeness**, which is § 1.23 arriving in the one place that should
have been immune: inside a guard, next to the guard's own history.

Fixed by brace-matching the argument object too, so neither line breaks nor length matter. Three
plants now hold it: a single-line status write is CAUGHT; `status` in a `where` clause is NOT
flagged (that is the race-safe pattern `race-safe-invariants.md` requires); an ungoverned model's
`status` is NOT flagged.

**And a second defect in the same file, caught by typecheck rather than by the test.** Widening the
scan's roots left a stale `SRC` reference inside the branch that only executes when a violation is
FOUND. The test passed green while its FAILURE PATH was broken: a real bypass would have thrown
`ReferenceError: SRC is not defined` instead of naming the offender. **Exercise a guard's failure
path, not only its success path** — planting is what does that, and the plant I ran first
(single-line) did not reach this branch because it was not being matched at all. Two defects
hiding each other.

---

### 1.37 `P1` — A guard has two halves, and the REPORTING half only runs when something is wrong

**Planting is not done when the test goes red. It is done when you have read the failure message
and it names the right thing.**

A guard detects, and then it reports. The reporting half executes only when something is broken —
in a healthy repo, never. So it is code that rots in the dark, and every green run is evidence
about the first half only. § 1.36 is the extreme case: a guard whose reporting branch would have
thrown `ReferenceError` instead of naming the offender, passing green for as long as nothing was
wrong.

And the plant that found § 1.36's detection bug did NOT reach its reporting bug, for a reason worth
stating precisely: **the shape planted was not being matched at all**, so the test went red without
ever entering the branch that names the offender. A plant that makes a test fail is not the same as
a plant that exercises the failure path.

#### The inventory, 2026-09-22

Every guard built during this month's work, planted and the message READ. Verdicts are
`message verified` (failure observed and the text names the offending thing), `fires but says
little`, or `cannot fire`.

| Guard | Verdict | Evidence |
|---|---|---|
| Migration checksum gate | **verified** | Planted a comment-only edit and a missing file; both messages name the migration and print stored-vs-file hashes. Also measured `migrate status` staying silent on the same drift. |
| Schema divergence gate | **verified** | Planted an un-declared index and a stale allow-list entry; both directions name the exact SQL statement. |
| Playwright browser gate | **verified** | Planted an orphaned `chromium-1243`; message names it, its size, the wanted revision and the `rm -rf`. |
| `createTestApp` Organization guard | **verified** | Fired for real (36 failures in 3 files); names the leftover office by legal name, subdomain and id. Its *diagnosis* was wrong — see § 1.31 — and was corrected. |
| Canonical-key parity table | **verified** | Fired for real on `شركة ١٢٣`; names the input and both keys. |
| Deploy-time Arabic assertions | **verified** | Fired twice for real, on their author: named the code point (`U+66e`) and the returned value. |
| Status-write inventory | **verified** (§ 1.36) | Three plants: single-line caught and named `file:line`; `where`-clause status and ungoverned model correctly NOT flagged. |
| Security-definer view registry | **verified — best message of the set** | Planted an unregistered `security_invoker=false` view; names it and explains the whole hazard and the fix. |
| Directory view key allow-list | **verified** | Planted an extra allow-list column; three tests fire, naming the risk ("readable by every office") and the criterion ("only if genuinely public company data"). |
| Permission subset assertion | **verified** | Planted `OFFICE_ADMIN` on `claim.settle.approve`; names the code and both branches — declare it, or the `20261008100000` empty diff is no longer reproducible. Two sibling guards fired too. |
| Policy-status partition | **verified** | Planted `ACTIVE` out of the in-force set; names the status and the consequence ("disappears from the deactivation impact count"). |
| Unique-index inventory | **fires but says little** | Planted an extra unique index on `Insurer`. It fails — `expected [ …(5) ] to deeply equal [ …(4) ]`. Counts only: no index name, no reason. The test NAME carries the stakes ("is the inventory the 409 messages depend on"); the message carries nothing. |
| **RLS coverage enumeration** | **CANNOT FIRE** | See below. |

#### The one that cannot fire, and it guards against a total outage

`tenant-scope.extension.spec.ts` has a test named *"a model with an RLS policy must be in the
scoped set, or the policy is unsatisfiable"*. Its body:

```ts
for (const rlsProtected of ['Role', 'RolePermission', 'UserRoleAssignment']) {
  expect(TENANT_SCOPED_MODELS.has(rlsProtected)).toBe(true);
}
```

It checks three hard-coded names. It never enumerates RLS-protected tables, so it cannot detect a
policy added to a model outside the set — **which is the exact defect it was written after.** Phase
1 shipped an RLS policy on `RolePermission` without the column the extension keys on; every
permission read returned empty and every user authenticated and then 403'd everywhere.

Proven: enabled RLS on `InsurerFormTemplate` (not in the set) in db-test and ran the spec — **23
passed**. The guard saw nothing.

Its own comment even says *"If a future migration adds `tenant_isolation` to another table, that
table's model belongs here too"* — **§ 1.23 inside the guard, a comment standing in for the check
the test's name promises.**

**The fix it needs** (queued, not done here): enumerate from `pg_class.relrowsecurity` and diff
against `TENANT_SCOPED_MODELS`, which makes it an e2e rather than a unit spec because it needs a
database. Until then the test's name overstates what it does, and a reader who trusts the name has
no guard at all.

#### The rule

- **Read the failure output.** A test that can go red is not a test that fails usefully, and a
  guard that fails uselessly delivers its next real catch as a stack trace nobody can act on.
- **Plant the shape the guard is supposed to catch**, then check the message names it. If the
  message is a bare `expected [ …(5) ] to deeply equal [ …(4) ]`, the guard will be diagnosed by
  whoever is on call, from counts.
- **A test whose NAME claims a universal property and whose BODY checks named instances is not a
  guard**, it is a comment with an `expect` in it. Check which one you have by planting a case the
  name covers and the body does not.
- This completes the pair with § 1.28 and § 1.31 — those were guards that could not SPEAK (timed
  out, aborted). This is guards that may speak NONSENSE. Same failure, different half.

---

### 1.38 — RESOLVED (2026-09-22): the four audit findings that could not wait, and two corrections to the audit itself

The compliance audit (§ 2 of this file's companion report) found 12 requirements' worth of gaps.
Four were actioned; the rest are version two by decision. These four, and what measuring them
corrected about the audit's own claims.

#### 1. The actor's role, which is the ONLY unrecoverable one

`AuditLogEntry` stored `userId` and nothing about that user's authority, so "what role were they
acting under" had to be answered from their CURRENT assignments. A promotion, a revocation, a
retirement or a **rename** therefore rewrote what every historical entry appears to say about that
person — silently, on an append-only table.

Every other gap the audit found (source IP, device, evidence ids, SLA context, hash-chaining) can
be added later and will simply be empty for older rows. **This one cannot: a role held in the past
that was never written down is not recoverable from anything.** Each day it stayed unstored was a
day of history that can never be reconstructed.

Now `actorRoleIds` + `actorRoleNames` on every entry. **Both**, because neither substitutes: ids
survive a rename and thread back to the grant history; names capture the label as it stood, since
an office can rename its own roles and "approved by Claims Triage Desk" must not silently become
something else.

**Where the values come from, and why not the call sites.** There are 134 `audit.record()` call
sites; threading an actor through all of them is 134 chances to omit it, each omission silent.
Instead the request-scoped `OrgContextService` store — which already carries per-request identity
for exactly this reason — gained `actorRoles`, set once from
`SessionService.validateAndTouch`, which **already fetches ids and names in one query** for the
`AuthenticatedUser` it returns. Zero extra queries, zero call-site changes. `runUnscoped` carries
it through rather than resetting it, because several bypass blocks write audit rows and those are
the privileged ones.

**Empty is an answer, not a hole:** a scheduled sweep, a seed, or a session-rejection path that
audits its own refusal genuinely held no role.

**And the guard, because there are THREE writers and a fourth is plausible.** `record`,
`recordMany` and `recordInTransaction` — the last added later for
`WorkflowTransitionService.transition()`, so every workflow status change goes through it. A
writer that forgets the actor produces entries that look complete and are not, and nothing would
notice: the column defaults to `{}`. So a test reads the service's own source and asserts EVERY
`auditLogEntry.create`/`createManyAndReturn` spreads the actor. Planted a fourth forgetful writer;
it named `audit.service.ts:160` and the consequence. The bulk-path test earned itself immediately —
the first implementation put the spread on the outer object instead of inside the per-row map, so
45,000 rows would have carried the default.

**Was anything else resolved from present state?** Measured: **no.** The read path performs no
joins at all (`select: AUDIT_LOG_ENTRY_SELECT`, flat columns), so every view field is stored. Worth
knowing for next time: the actor's display name is not resolved live either — the screen shows the
raw `userId` — which is a readability gap, but anyone who "fixes" it by joining `User` reintroduces
exactly this class of bug, because `fullName` is mutable.

#### 2. PEP — the naming claimed a capability that does not exist

`WatchlistSource` is `{ OFAC_SDN, UN_CONSOLIDATED }`. No PEP list is synced, while "Sanctions &
PEP" appeared throughout. **Three different kinds of occurrence, and only one of them was a
false claim:**

| Kind | Example | Action |
|---|---|---|
| Declared attribute | `Customer.isPep`, the wizard checkbox "Politically exposed person (PEP)" | **Kept.** Collecting a self-declaration works and is not a screening claim |
| Capability claim | "Sanctions & PEP watchlist sync", "Run sanctions/PEP/AML screening", the role description | **Renamed** to drop PEP |
| Existing disclaimer | "PEP screening is NOT operational. No customer may be represented as clear of PEP status." | **Kept** — the system already says this, in both languages |

**The answer to "is PEP visible to a compliance officer or regulator": YES** — a screen heading, a
permission description read in the roles matrix, a role description, and the customer wizard.
**And also yes to the honest half:** the screening-health screen already carried an explicit
"NOT operational" disclaimer in both languages. So the gap was *partly* disclosed already, which
the audit did not say.

The permission CODE `sanctions-pep.screen` is deliberately **not** renamed: it is an identifier,
renaming it is a data migration touching `RolePermission` grants across every office plus the web
e2e's third copy of the grid, and that is disproportionate to a naming fix. Recorded rather than
done.

#### 3. Retention — one half was missing, and the other half I mis-reported

**Added:** a period whose `confirmedByLegalCounselAt` is null may no longer be nominated for
disposal. Every period in this schedule is a draft until a lawyer signs it — `retentionPeriodMonths`
is a number somebody typed until then — and destroying records against a draft is the one step in
this workflow that cannot be undone. The dual control governs WHO approves, not whether the period
is real. The refusal names the category.

The editing guard already keyed on this field the *other* way round (once confirmed, no longer
editable). The half that blocked acting on an UNconfirmed one did not exist.

**A CORRECTION to the audit.** It said "defaults ARE shipped — contradicting 'no placeholder values
in production'". Measured: the seeded `AuditLogEntry` row already has
`confirmedByLegalCounselAt = NULL` on both databases, and its `legalBasis` reads "DRAFT,
UNCONFIRMED — no specific figure is cited anywhere…". So a period *number* is shipped, explicitly
labelled a draft, with the confirmation field null. The audit's framing was harsher than the facts.
What was true is that the null **did nothing** — which is what the block above fixes.

**Two existing tests had to change, and that is the finding.** Both nominated against an
unconfirmed period and expected success. They were asserting the defect.

#### Recorded, not acted on

**`sanctions-pep.screen` is naming debt, with a condition.** The permission CODE still says PEP
while no PEP list is synced. Not renamed because a permission-code rename is a data migration
across every office's `RolePermission` grants, plus the web e2e's copy of the grid — disproportionate
to a naming fix on its own. **The condition: it renames the next time permission grants are migrated
for another reason**, where the cost is already being paid. Until then the code is an identifier and
every piece of PROSE around it says "sanctions".

**Three descriptions of one permission grid.** `packages/db/prisma/seed-data/permissions.ts` is the
source; `apps/web/e2e/fixtures/role-permissions.ts` is a second copy the web e2e asserts against
(its own header says regenerate rather than hand-edit, and a stale copy has already broken four
Playwright tests in three files); and the seeded database is the third. Three descriptions of one
thing is the pattern this month has been spent removing — § 1.19's whole-set assertions exist
because of exactly this shape. **Not now, and not in a feature commit.** Recorded so it is a known
duplication with an owner rather than a surprise.

#### 4. NOSUPERUSER — already asserted, and a REAL gap next to it

**Correction:** the audit cited "`ibms_app` is NOSUPERUSER and cannot" as reasoning and implied it
was unverified. It was already asserted — `tenant-isolation.e2e-spec.ts`, "has no SUPERUSER, no
BYPASSRLS, and owns no tables". I did not find it when writing the audit and reported an assertion
as an assumption.

**But the attribute checks leave a hole that matters more than the one asked about.** `rolsuper`
is what a reader checks, and it is not the only route:

```sql
GRANT ibms TO ibms_app;   -- rolsuper stays FALSE
```

The runtime role then inherits the owner's privileges — and **Postgres exempts a table's owner from
its own RLS policies.** Planted exactly that: `rolsuper` remained `false`, and the unfiltered
cross-office read returned **13,774 rows where 1 was expected**, across two offices instead of one.
Every attribute assertion kept passing.

So the test now also asserts REPLICATION (reads the WAL — every row, regardless of RLS), CREATEROLE
(can grant itself membership in anything), CREATEDB, and **membership in NO role at all** — the
whole set, so a genuinely needed grant has to be argued for in that assertion. And the test was
renamed, because "has no SUPERUSER, no BYPASSRLS, and owns no tables" no longer described what it
checks.

**And then moved to where it can actually fire, because a test never runs against the database we
deploy to.** A `GRANT` is an act performed ON a database — by a DBA, a provisioning script, a
migration — which is precisely the class of change no test can see. So the assertion now exists
twice, deliberately:

- **Migration `20261018100000`** executes on whatever database the schema lands on and REFUSES TO
  DEPLOY. That is the half that runs on production.
- **`npm run db:privileges`** (`check-app-role-privileges.mjs`), wired into `verify.sh` and CI
  beside the checksum and divergence gates, is the RECURRING half — because a migration runs once
  and catches only a grant that already existed, never one made afterwards.

Both planted and read: the script names the membership (`MEMBERSHIP in ibms — it inherits those
roles' privileges while rolsuper stays FALSE…`) and separately an attribute
(`ROLREPLICATION — it can read the write-ahead log…`); the migration refuses with the same
reasoning and the measured 13,774-row figure in the message. A missing `ibms_app` role is a NOTICE
and a skip in both, not a failure — that condition is "RLS is inert", which `PrismaService` already
reports loudly at boot, and it is a different problem from privilege escalation.

---

### 1.39 `P2` — The catalogue can grow INTO a collision that both write paths refuse

`InsuranceLineService` refuses an office-added line whose canonical name means the same as a
catalogue line, on `add` **and** on the rename — `standardLineColliding`, checked both places.
That guard runs when the OFFICE line is written. **Nothing runs when the catalogue grows.**

Seed a 33rd `InsuranceLine` whose name canonicalises to a line some office added two years ago
and the collision exists retroactively, having passed every check that was ever written. It is
not hypothetical: the 32 arrived by seed and a 33rd arrives the same way.

Why it matters beyond tidiness — `InsurerDirectory.lines` carries `code: null` for an
office-added line, and the directory's `lineCode` filter is an exact match on the code. So every
company recorded against the colliding office line is **invisible** to a search for the catalogue
code that means the same thing, and the empty page reads as *"no company writes this cover"*.

**Closed at the read side already, in the honest direction.** The first draft of the line filter
also matched un-coded lines by canonical name. Measured before keeping it: the colliding set is
**empty on both databases** (4 office lines on db-test, 0 on dev, 0 collisions either side), so
the fallback covered nothing that exists — while putting name similarity back on a matching path
this branch spent weeks clearing, and making the filter return companies whose recorded line was
not the one asked for. It was removed and replaced with an assertion that the set IS empty
(`insurer-schema-constraints.e2e-spec.ts`, with a rolled-back plant proving the query can see a
collision), which is the house shape: **assert the invariant, do not compensate for its absence
at read time.**

What is still missing is the guard on the other side. Options, cheapest first:

1. A **seed-time check** in `packages/db/prisma/seed.ts`: adding an `InsuranceLine` that
   canonically collides with any existing `OfficeInsuranceLine` fails the seed, naming the office
   rows. Cheap, and the seed is already typechecked.
2. A **migration `DO` block** on any future migration that inserts catalogue lines. Stronger — it
   runs on the database being deployed to — but only if whoever writes that migration remembers.
3. The **repointing tool** the remedy actually needs either way: move the `InsurerOfferedLine`
   rows onto the catalogue line and delete the office one. A refusal with no remedy path just
   blocks a legitimate catalogue addition.

Do (1) and (3) together. (2) without (3) turns a good change into an outage.

### 1.40 — RESOLVED (2026-09-22): the four MUST models were BACKFILLED, not converted — no writer set the line FK, and every row written since the migration was unmapped

Found while capturing a pre-reset baseline on db-test, by asking a question the migration's own
success numbers could not answer: *how many rows are unmapped NOW?*

    model                    migration outcome        measured 2026-09-22 (db-test)
    InsuranceProgramLine     962/962, 0 parked        6 unmapped
    RFQ                      4,449/4,449, 0 parked    4 unmapped
    Policy                   4,994 + 632 parked       632 unmapped  (the parked set, expected)
    CommissionAgreement      287/287                  0 unmapped

The two models the migration mapped COMPLETELY now hold unmapped rows. Dated them against the
migration (applied 10:41:47Z): every unmapped `RFQ` was written at **13:10 the same day**, two
and a half hours later. Their `insuranceLine` string is `Property All Risks` — a value the
mapping table handles perfectly. So these are not rows the conversion missed. They are rows
written AFTER it, by code that still fills only the string.

**Confirmed structurally, not inferred from the dates:** nothing in `apps/api/src` writes
`insuranceLineId` or `officeInsuranceLineId` on any of the four models, and
`commission.repository.ts` still MATCHES on the string —
`insuranceLine: { equals: value.trim(), mode: 'insensitive' }` — which is the free-text
matching this whole line of work exists to remove.

**Why this is worth a P1 rather than a note.** The four models were chosen because a line must
MATCH another model's for the system to work at all: a programme line becomes an RFQ, an RFQ
becomes a Policy, a commission agreement is applied to a Policy by line. A row with NULL on
both FKs cannot participate in any FK-based match. Today nothing matches that way, so nothing
is broken — but the moment a reader is written against the FK it will silently skip every row
created since the migration, and the symptom will be "the commission did not apply" rather
than anything pointing here.

**And the crossing we converted `CommissionAgreement` FOR is still running on free text.** That
is the sharpest form of this. A policy finding its governing commission rate is the one crossing
where a mismatch touches MONEY, and it is why that model was a MUST rather than a
nice-to-have — `commission.repository.ts` still matches
`insuranceLine: { equals: value.trim(), mode: 'insensitive' }`. So the column exists, the
variant axis exists, `NULLS NOT DISTINCT` guards the uniqueness, and **the defect all of it was
built to remove is untouched.** The database is ready; nothing reads it.

**Two consequences, stated plainly because they change how this should be scheduled:**

1. **The gap WIDENS with use.** Every row written from here is unmapped, so the mapped
   proportion FALLS over time rather than holding. A migration that converts the existing rows
   and leaves the writers behind does not decay gracefully — it decays monotonically, and the
   longer the interval the more rows a future reader silently skips. The 6 and 4 measured today
   are not a small residue; they are the first two days of an accumulating set.
2. **The order is a rule, not a preference: writers FIRST, then the gate means something, then
   the string goes.** § 1.26 called the string drop "deferred", which made it sound scheduled. It
   is not deferred — it is **UNREACHABLE**: its precondition is "a test measures zero unmapped
   rows", and no writer can satisfy that while writers fill only the string, because the count
   grows with every run. A gate whose precondition nothing can satisfy is not waiting for a
   date; it is waiting for a different change.

**And it makes the deferred gate unreachable.** § 1.26 defers dropping `insuranceLine` until a
test measures zero unmapped rows. That can never go green while the writers fill only the
string: the count grows with every run. The order is therefore fixed — writers first, then the
gate becomes meaningful, then the string can go.

**What the docs now say instead.** "Converted" was the wrong word in § 1.26 and in CLAUDE.md;
both now say the columns are ADDED and BACKFILLED with the writers pending, because a reader
would reasonably take "converted" to mean the model uses the FK.

**FIXED, in the commit after this entry was written.** Identity now flows along the chain rather
than being re-derived at each step:

- **`InsuranceProgramLine`** is the only writer that RESOLVES. `COVERAGE_LINE_MAPPINGS` gained the
  catalogue code for each of its 13 coverages — the same pairs migration `20261019100000` used,
  not re-derived — and the service turns them into ids in one `listStandard()` call per programme.
  An unmapped coverage string still lands with no FK, which is the honest outcome.
- **`RFQ`** COPIES the programme line's FK. `assertLineInProgramme` already fetched the programme
  and matched the line; it returns the matched line's reference instead of `void`.
- **`Policy`** COPIES the RFQ's, which required widening the recommendation include — selecting
  only `insuranceLine` there is exactly why the policy writer had nothing to copy.
- **`CommissionAgreement`** REFUSES. Its input FK is not nullable: the service resolves the typed
  line against the catalogue by exact code or exact name and 422s anything else, because a rate on
  a line nothing can match is a rate that will never be applied. This is the one of the four where
  a NULL has no honest meaning, and the refusal is what makes the unmapped count here stop
  growing.

And the money crossing moved: `agreementLineMatch` matches a Policy to its governing rate on the
line ID, keeping one transitional arm for agreements that predate the migration (removal condition
and query in its docblock).

**And then the SCREEN that calls it turned out to be free text.** `POST /commission/agreements` is
reached from `/commission`, whose line field was an `<input>` with a placeholder — so the server
change above would have turned a trap into a 422 for anyone who typed. Two defects, found by
reading the caller rather than by any test:

1. **The resolver matched `code` and `nameEn` only.** This platform is ARABIC-PRIMARY. An
   administrator reading the Arabic rate screen and typing the Arabic line name is the ordinary
   case, and it was a 422. Every test in that file was written in English, which is how it
   survived. `nameAr` is matched now, with a test.
2. **The Arabic placeholder was not the Arabic catalogue name.** It read
   `التأمين على الممتلكات ضد جميع الأخطار`; the seeded name is `تأمين جميع أخطار الممتلكات`.
   Different wording, so following the screen's own hint produced a line nothing could match —
   true even BEFORE the resolver existed, meaning the screen has been inviting unmatched rates all
   along.

The field is now a `<select>` over the managed catalogue, valued by CODE so the submission is
language-independent while the label follows the reader. Office additions are filtered OUT, because
the API resolves a rate's line from a platform code and an office line has none — offering a choice
the server must refuse is worse than not offering it, and a Playwright assertion pins the option
count with an office line in the fixture.

**Still not done, deliberately — and CHECKED before calling the feature done, because "an office
can add a line and then cannot price it" would be a hole rather than a follow-up.** It is not one,
measured four independent ways on 2026-09-23:

1. `InsuranceProgramLineInput` has **no `officeInsuranceLineId` field at all**, so no API path can
   put an office-added line on a programme line.
2. `RFQ` and `Policy` only COPY their parent's reference, so with nothing upstream to copy neither
   can acquire one.
3. The needs assessment DERIVES its coverage list from answers (`deriveRecommendedCoverageLines`),
   so it is always a subset of the fixed `COVERAGE_LINES` — the `unknown` branch of
   `assembleProgramLines`, which is the only other way a programme line loses its FK, needs a
   hand-edited row.
4. Row counts on dev: **0** office-line references across `InsuranceProgramLine`, `RFQ`, `Policy`
   and `CommissionAgreement`.

So no policy can carry an office-added line, and nothing can need a rate for one. The DTO change
is completeness, not a hole.

**But nothing would NOTICE the day that stops being true**, and the symptom would be a commission
calculation refusing a policy for no visible reason — `resolveGovernedRate` finding nothing, with
no way to create the missing agreement. So the assumption is now a guard:
`managed-line-writers.e2e-spec.ts` asserts no `Policy` (and no programme line or RFQ) carries an
office line, with a message naming this entry and the step to close. Planted by inserting such a
policy inside a rolled-back transaction, so the empty-set assertion is a real measurement.

**Closing it** means the DTO taking `lineId` — the rate screen's picker already has the ids to
hand, so the remaining work is the DTO, the resolver branch, and their tests.

**THE CAVEAT THAT IS STILL THE WHOLE VALUE OF THIS ENTRY — read it before re-measuring.**

db-test was reset on 2026-09-22 (46,153 users to 12), so **all four counts now read ZERO — and
that was true BEFORE the writers were fixed, because the rows were gone rather than mapped.** The
zero is now also true for the right reason, which is precisely why it is a bad measurement: the two
states are indistinguishable from the number alone.

So a zero on this query proves nothing on its own. What proves the writers work is
`managed-line-writers.e2e-spec.ts` — a row written through each API path with the stored FK read
back, and three plants that fail when a writer stops copying. Trust the test, not the count.

So the measurement is only meaningful on a database with REAL VOLUME, taken after the writers
land, and the query to use is the one at the top of this entry. Until then the honest statement
is "no writer populates the line FK" — a fact about the CODE, which a reset cannot erase — and
not any number.

This is the pattern to distrust generally: a gate reading zero on an empty table is measuring
nothing, and it looks exactly like a gate reading zero on a complete migration.

### 1.41 `P3` — Two e2e harness traps, each of which produced a confident wrong diagnosis

Recorded rather than fixed: both have cheap workarounds, and both cost a full test run before
being understood. Neither is a defect in the application.

**`ensureRole` UPSERTS, so a mistyped role name becomes a permissionless role.**
`apps/api/test/tenant-prisma.ts`'s helper takes a name and upserts it, creating the row when it
is absent. A name that is not in the seeded catalogue therefore succeeds, produces a role with
**zero grants**, and every request that user makes returns 403 — which reads exactly like a
broken permission check in the code under test. `'PLACEMENT_OFFICER'` (the real name is
`PLACEMENT_TECHNICAL_OFFICER`) cost a full run, and left a junk role in the cumulative test
database until it was deleted by hand.

*Why not simply make it refuse an unknown name:* custom office-scoped roles are a real feature
since RBAC Phase 3, so a spec may legitimately create one. The honest fix is two functions —
`ensureCatalogueRole(name)` that refuses anything not seeded, and an explicit
`createCustomRole(...)` — but it touches a helper many specs share, so it waits for a commit that
is about the harness.

*Until then:* when a new e2e 403s on everything, check the role name against
`SELECT DISTINCT name FROM "Role"` before reading any guard.

**`fileParallelism: false` serializes files within ONE command and says nothing about two.**
Several specs stand up a second `Organization`, and `signup` refuses while one exists. So two
concurrent e2e commands — including one foregrounded and one backgrounded — make BOTH fail with
500s on signup and timeouts, in tests that have nothing to do with either change. Seen in both
directions in one session.

*Until then:* run several spec files as arguments to ONE command, never two commands at once. If
a spec 500s on signup, `SELECT subdomain FROM "Organization"` before reading the diff — it takes
seconds and answers the question outright.

**And a third, same family: a turbo gate run DURING an e2e run fails on a locked DLL.**
`npm run lint` builds `@ibms/db`, which runs `prisma generate`, which replaces
`node_modules/.prisma/client/query_engine-windows.dll.node`. A running e2e suite has that file
open, so the rename fails:

```
EPERM: operation not permitted, rename '…/query_engine-windows.dll.node.tmp6340'
  -> '…/query_engine-windows.dll.node'
```

Nothing is wrong with the code, and the error names a file rather than a source line, so it is easy
to read as a broken install. *Until then:* do not run `lint`, `build`, `typecheck` or anything else
that triggers `prisma generate` while an e2e suite is running. The same rule as above, one layer
out — on this host, one long-running job at a time.

### 1.42 — RESOLVED (2026-09-22): the reviewer pool had no ORDER, so "the first eligible reviewer" named something that did not exist

Found by resetting db-test, which is the point of doing it on a schedule: the reset changed a
query plan, and a test that had been reporting the plan rather than the behaviour finally said so.

`RoleRepository.findActiveUserIdsWithPermission` had **no `orderBy`**.
`AccessRecertificationService.pickReviewer` takes the first member of that list which is not the
subject, and README described the behaviour as *"always picks the first eligible member of the
pool"*. Without an order there is no first member — Postgres returns rows in whatever order the
plan produces, and the plan changes with the table's size and statistics. **Which reviewer a
subject got was unspecified, on a segregation-of-duties control.**

**How it surfaced, and why it had hidden for months.** `rbac.e2e-spec.ts`'s "not this item's
assigned reviewer" test creates two Compliance Officers and asserts the earlier-created one is
picked; its comment states the assumption outright ("compliance was created … and thus resolved as
the pool's first eligible member"). It passed against a db-test holding 46,153 users and failed
the moment that database was reset to 23. Same commit, same spec, different plan.

**Diagnosed by elimination, not by guessing**, because three explanations fit the symptom
(`subjectItem` undefined):

1. *The cycle produced no item for the subject* — `startCycle` skips a subject with no eligible
   reviewer. Ruled out: the cycles hold 20–23 items against 23 active subjects.
2. *Pagination dropped it* — ruled out by reading the route: `GET /access-recertification/items`
   returns the items assigned to the CURRENT reviewer and does not paginate.
3. *It was assigned to the other reviewer* — which is what an unordered pool permits.

**Fixed** with `orderBy: [{ grantedAt: 'asc' }, { userId: 'asc' }]` — the longest-standing
eligible reviewer, with a total order so two grants in the same millisecond still resolve
identically. `rbac.e2e-spec.ts` 10/10 afterwards.

**What is NOT fixed, and is still the documented gap:** this is not round-robin. One reviewer
takes every subject until they are the subject themselves. That needs a manager-hierarchy field
that `User`/`Employee` do not have. The difference is that the behaviour is now a RULE somebody
can state and a test can rely on, instead of a property of the query planner.

**The class, which is the reusable part:** a consumer that takes `[0]` of a set imposes an
ordering requirement on a query that does not declare one, and nothing type-checks that. Where a
`find`/`[0]`/`first` decides something that matters, the query it reads from needs an explicit
total order — and the reason belongs in the query, because the consumer is usually in a different
file. This is the second ordering defect on this service; the first was a mock that listed the
routine reviewer first and so passed against a flattened pool.

### 1.43 — A BASELINE IS A MEASUREMENT, and measurements find things

Recorded as a method, because it has now paid twice in one day.

Before resetting db-test, the question asked was not "let me note the current numbers" but
**"does any outstanding measurement rest on this database's contents?"** — a question with a
possible answer of *yes*, which makes it a measurement rather than a formality. It returned yes,
and taking it found § 1.40: the four MUST models are backfilled and no writer populates the line
FK, visible only as 6 and 4 unmapped rows on two models the migration had mapped 100%.

A baseline taken as a formality would have recorded "6 and 4" as starting values and moved on.
The finding is not in the numbers; it is in asking what they should have been.

Then the reset itself produced § 1.42, because changing the data changed a query plan and broke a
test that had been passing on the plan. **A reset is not only hygiene — it is a perturbation, and
a perturbation is an experiment.** Anything that breaks when the data volume changes and the code
does not was never measuring the code.

Two habits follow:

- Ask the *yes/no* form of the question before any destructive or environment-changing step, and
  be prepared for the answer to stop you.
- Read what a reset breaks as a FINDING rather than as noise to be re-run away. Both of today's
  came from there.

### 1.44 `P2` — MEASURED: four API surfaces are built and unreachable from the UI, and the office administrator holds three codes it cannot exercise

Asked because the insurer feature had been **unreachable for weeks with every gate green** — 74 nav
links and not one for insurers. That is the same shape as "no spec covers this" predicting "and it
is broken", so the question was whether anything else is in that state. **Recorded, not acted on.**

Method: every `@Controller('...')` prefix in `apps/api/src` (90 of them) against every reference to
that path anywhere under `apps/web/lib|app|components`, excluding `.next`. Seven came back with no
reference; each was then checked by hand, because the grep cannot match a PARAMETERISED prefix
literally and one result was a false positive for exactly that reason.

**Built and genuinely unreachable — no web file mentions them at all:**

| Surface | Routes | Permission | Note |
|---|---|---|---|
| `admin/email-integration` | 6 (`GET`, `authorize-url`, `connect`, `verify`, `test`, `revoke`) | `email.integration.manage` | An office cannot connect, test or revoke its own outbound mailbox. The only web mention of the permission is the Playwright fixture. |
| `POST /imports/customers` | 1 | `customer.bulk-import` | No import screen exists. |
| `insurer-directory` | 1 | `insurer.directory.read` | Known — the next screen slice. |
| `insurers/:insurerId/form-templates` | 3 | `insurer.read` / `insurer.office-form.map` | Known — Q9's UI, a later slice. |

**The sharpest way to put the first two:** `email.integration.read`, `email.integration.manage` and
`customer.bulk-import` are all in the OFFICE_ADMINISTRATOR's 25-code set
(`office-administrator.e2e-spec.ts` lines 91-93). So **the office administrator is granted three
capabilities the product gives them no way to exercise.** A granted permission with no surface is
not harmless: it reads as "this is supported" to whoever audits the grid, and the access
recertification reviewer confirming it is confirming access to nothing.

**Correctly absent, and not defects:**

- `auth/sso` — `@Public() POST :provider/callback`. A callback is invoked by the identity PROVIDER,
  never by the browser app, and README already records SSO as a deferred edge with no IdP
  configured. A nav entry would be wrong.
- `orgs` — `@Public() GET resolve`. Subdomain resolution, which is RBAC Phase 4's mechanism; called
  by infrastructure, not a destination.
- `customers/:customerId` — **false positive.** The web reaches it as `` `/customers/${id}` `` in
  three libs (`customer-api`, `crm-api`, `kyc-api`). The method cannot see a template literal, which
  is worth stating because it is the method's one blind spot: a parameterised prefix must be checked
  by hand or it reads as unreachable.

**What this does NOT measure**, so nobody over-reads it: a page can exist with no nav entry and
still be reachable by a link from another page — `/insurers/[id]` is, from the list. This asks the
narrower question "does any web code call this API at all", which is the one that catches a surface
built and then forgotten.

### 1.45 — A CAST THAT SILENCES THE COMPILER USUALLY MEANS THE QUESTION WAS GOOD

``t(`enumInsurerStructure${s}` as never)`` — a translation key built by template concatenation,
with `as never` to make the type error go away. There were **no structure labels at all, in either
language**, and the screen would have shipped rendering raw key strings. The compiler knew; the cast
was the thing stopping it from saying so.

Replaced with `STRUCTURE_LABEL_KEY`, a `satisfies Record<InsurerStructure, string>` map, so adding a
member to the union is a compile error until its label exists.

Two general forms, both worth applying beyond this instance:

1. **A cast written to stop a complaint is a recorded decision to ignore it.** `as never`,
   `as unknown as T` and `@ts-expect-error` are sometimes right — but the reason belongs beside them,
   and if the reason is "it was noisy" the complaint was probably correct.
2. **A key built by concatenation cannot be checked.** ``t(`prefix${value}`)`` compiles whatever it
   is handed, so a missing or renamed entry becomes a runtime miss rather than a build failure. A
   total map over the union is the form that cannot express the mistake — the opening principle of
   this file, applied to a lookup.

### 1.46 — EVIDENCE THAT THE GUARDS ARE WORTH THEIR COST: one caught a genuine repeat

`apps/web/lib/i18n/translations.test.ts` asserts that every dictionary file ON DISK is registered in
its own map, and its comment says why it exists: *"without this, the map above silently under-covers
the moment someone adds a dictionary — which is exactly what happened when auth.ts was created: the
two checks below kept passing while ignoring the new file entirely."*

On 2026-09-23 it caught exactly that again. `insurers.ts` was created and merged into the flat
translation namespace, but not registered in the test's map — so the AR/EN parity check and the
key-collision check were both silently ignoring **88 new keys** while passing.

**This is the first time one of these guards has caught a genuine repeat of the thing it was built
for**, and it is the evidence the class of test earns its cost. Worth stating plainly, because a
guard that has never fired is indistinguishable from a guard that cannot — which is the § 1.37
problem — and this one has now fired on its own stated scenario.

The pattern to reuse: when a check derives its expected set from the FILESYSTEM rather than from a
list a human maintains, it cannot be under-covered by someone adding a file. Every "assert the whole
set" guard in this repo has that shape, and this is why.

### 1.53 — RENAMING A ROLE AND RE-GRANTING IT ARE ONE PERMISSION

Four-action Phase 1 split `role.manage` into `role.create` / `role.update` / `role.deactivate`, and
`role.update` gates three routes that are not the same kind of act:

    PATCH /rbac/roles/:id                      rename it, change its description
    PUT   /rbac/roles/:id/permissions          change WHAT IT GRANTS
    PATCH /rbac/roles/:id/security-attributes  its MFA requirements (behind a step-up challenge)

The second one can hand a role every permission in the system, including the ones that grant permissions.
The first changes a label. They arrive together because they arrived together under `role.manage` — the
split neither widened nor narrowed anything — and that is precisely why it is easy to leave alone.

Not acted on in Phase 1 deliberately: separating them is a CAPABILITY decision (a new boundary the owner has
not asked for), not a rename, and the four-action scheme's own shape does not produce it —
"change what a role grants" is not one of view/create/edit/deactivate. If it is taken, the likely shape is
`role.permissions.manage` alongside `role.update`, and the step-up challenge already on the MFA-attribute
route is the precedent for what guards it.

The seed's own comment on `role.update` points here, so this entry exists to be pointed at rather than to
argue for the change.

### 1.54 — THE ARABIC HALF IS THE HALF THAT GETS MISSED

Four-action Phase 1 renamed permissions that appear inside user-facing refusal messages. The English
message was corrected and the Arabic one was not, twice in one change:

    insNewNoPermission  AR still said insurer.relationship.manage after EN said insurer.create
    vendNoPermission    AR and EN both said vendor.manage; only venNoPermission had been found

Both were caught by a Playwright assertion on the English text, which is the wrong way round for this
product: **Arabic is the primary language**, the one the owner reads, and the one no test asserted here.
The shape to watch for is a code, a route or a field name appearing inside a TRANSLATED string — a rename
then has to reach two files, and the one a developer greps for is the one in their own language.

Worth knowing that `translations.test.ts` cannot catch this: it enforces AR/EN key PARITY, not that the
two halves say the same thing.

## The check the owner asked for, and the answer

**Asked**: a check that fails when an English string changes in a commit and its Arabic counterpart does
not. **Answer: it is expressible, it is not the right check, and there is a sharper one that is.**

### It is expressible — here is exactly how

For each dictionary file, build `key -> value` for the `AR` and `EN` halves at the merge base and in the
working tree. Then `changedEN = { k : EN_before[k] !== EN_after[k] }`, the same for AR, and require the two
key SETS to be equal. No parsing ambiguity: the dictionaries are plain object literals and both halves are
in one file, so one `git show <base>:<file>` plus one read of the working tree is the whole input.

### Why it is not the right check

**It fires on legitimate single-language edits.** Fixing an English typo, tightening English phrasing, or
improving an Arabic sentence are all normal and all asymmetric by nature. An escape hatch — a marker in the
commit message or the file — turns the gate into a reminder, and a reminder is what we already had.

**And it cannot catch the worse version of the same bug.** If a permission is renamed and NEITHER language
is updated, nothing changed, so there is no asymmetry to detect: the check passes on a dictionary where
both languages now name a code that does not exist. That is a strictly worse state than the one we hit, and
the co-change check is blind to it.

### The sharper check, measured

Scan the VALUES in every dictionary for tokens shaped like a machine identifier
(`[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+`) and assert that any token which looks like a permission code
IS in the catalogue.

Measured on today's dictionaries before proposing it:

    99 distinct dotted tokens, 286 occurrences
    82 of them ARE permission codes  (customer.360-view.read appears 8 times, user.manage 6, …)
    17 are not, and are trivially separable: page.tsx, enums.ts, e.g, privacy-notice-v1.2

So the check has real teeth — 82 codes are quoted at users in refusal messages, in both languages — and its
allow-list is small enough to enumerate and defend. Properties the co-change check does not have:

- **Language-symmetric by construction.** It reads both halves the same way, so the Arabic half cannot be
  the one nobody asserts.
- **Catches the stale-in-both case**, which is the worse one.
- **No false-positive class for prose edits**, so it can be a hard gate rather than an advisory.
- **No git plumbing**: works on a fresh clone, in the fast gate, and cannot be fooled by a squash.

### The sibling worth building at the same time

The same shape catches the `docs/first-run.md` class — a translated string naming a ROUTE
(`/settings/users`) that no longer does what the sentence says. Assert every `/route` mentioned in a
dictionary value exists in the destination catalogue (`components/app/destinations.ts`). That is the
"two rows would have sent her to the wrong screen" defect as a test.

### Recommendation

Build the sharp check as a gate. Do NOT build the co-change check: it cannot be a gate without an escape
hatch, and with one it is a reminder that costs a false alarm on every wording fix. If the owner wants the
co-change signal anyway, it belongs in review as a printed diff summary, never as a pass/fail.

**BUILT (2026-09-25, commit `c1fbc0c`).** The owner's instruction was to build the one recommended here and
not the co-change check. It lives in `apps/web/lib/i18n/translations.test.ts` — inside the existing merged-
dictionary describe, so it reuses that file's own file list rather than re-deriving one — with the allow-list
enumerated (`e.g`, `i.e`, `privacy-notice-v1.2`) and a non-vacuity assertion beside it: both languages must
quote more than 50 real codes and their AR/EN ratio must exceed 0.8, so the check cannot pass by finding
nothing to check. The sibling (`/route` tokens against the destination catalogue) is NOT built.

### 1.56 — THE DEV AND TEST DATABASES SWAPPED PORTS, AND ONLY THEIR NAMES MADE IT LOUD

On 2026-09-26 both Postgres containers restarted unprompted and came back with their published ports
**crossed**: host 5433 answered the db-test instance, 5434 answered the dev one. Every gate and every
application connection goes through those ports; `docker exec <container> psql` does not, which is why the
containers looked healthy while `npm run db:checksums` said `Database "ibms" does not exist`. `docker inspect`
reported the mapping as correct the whole time, so inspecting the container is not a check either.
`docker compose restart db db-test` re-bound them.

**What stopped this from being serious is a naming choice nobody made for this reason.** The dev database is
`ibms`, the test one is `ibms_test`. A crossed mapping therefore lands on an instance that does not have the
requested database and fails immediately. Had both been called `ibms`, an api e2e run — 105 spec files that
create, mutate and delete — would have executed against the DEV database, and every one of them would have
passed. The suite has no way to notice which database it is on.

So the property is load-bearing and should be written down as one: **the two databases must never share a
name.** It is the only thing between a crossed port mapping and a test suite silently rewriting development
data. "Simplify the config so both are just `ibms`" is a change that would look like tidying.

**What this says about a verification run.** Every gate and suite in this session ran BEFORE the restart and
is unaffected — the failure appeared on the first command after it, and the timeline is in the session record.
But the general form is worth stating: a green run is evidence about the database the run actually reached,
and nothing in the output says which one that was. A cheap gate would fix that — have each db script print
`current_database()` and the instance's database list beside its result, so "which database was this" is in
the evidence rather than assumed. Not built here; recorded with the answer.

Host-specific companions already recorded in project memory: Docker Desktop's stuck backend after a GUI
relaunch, and the VHDX that fills the C: drive. This is the third failure mode on this host whose symptom
points somewhere other than its cause.

### 1.55 — § 1.40'S SHAPE, CAUGHT BEFORE SHIPPING: adding a STATE and leaving the READERS

§ 1.40 is about a migration that converted rows and left the writers. Class B piece 1 is the same shape with
the halves swapped, and it was found by asking § 1.40's question in advance rather than discovering it on a
later baseline: **a discarded record keeps its status, so which existing readers now answer with withdrawn
records?**

Measured across all 31 read sites over the four models. A discarded record's state is pinned — a discarded
Policy is `PLACEMENT_CONFIRMED` forever, a Claim `NOTIFIED`, a Recommendation unsent — because a discarded
record cannot advance, so the question is decidable per query rather than a guess. Seven answers were wrong:

    insurer.repository.ts        open-obligation count   PLACEMENT_CONFIRMED is in the set — and this
                                                         number is written into a deactivation AUDIT ROW
    claims-dashboard.repository  open-claims ageing      `status != CLOSED` holds forever, so a withdrawn
                                                         claim ages without limit in the one report built
                                                         to surface claims nobody is progressing
    endorsement.repository       findLiveCancellation    see below — the sharp one
    insurer-performance (x2)     responsiveness ratio    an insurer answerable for a claim we withdrew;
                                                         filtered in BOTH halves or the score moves
    interaction.repository (x2)  the 360° timeline       a withdrawn policy reading "in placement" to
                                                         whoever is on the phone with the client

The other 24 were already correct, and for a reason worth keeping: the analytics reads deliberately start
PAST the pre-commitment statuses (`ANALYTICS_WRITTEN_POLICY_STATUSES`, `AWAITING_INSURER_STATUSES`), so the
new state cannot reach them. An entity's OWN list and its matching count are excluded deliberately, not
overlooked — a withdrawn record stays in its own register, the way a deactivated insurer stays in the
insurer list, because hiding it reads as deletion. That is the rule the seven fixes implement: **a discarded
record stays in its own register and leaves every derived view.**

**THE SHARP ONE: the trap reappeared one level down, in the database.** `Endorsement_one_live_cancellation_per_policy`
is a partial UNIQUE index predicated on `changeType = 'cancellation' AND status <> 'CLIENT_NOTIFIED'`. A
discarded endorsement can never reach `CLIENT_NOTIFIED` — a discard is terminal. So the moment the discard
columns existed, withdrawing a wrongly raised cancellation would have blocked every future cancellation of
that policy, permanently, at the database level, and the only exit would have been to APPLY the cancellation
nobody wanted. That is precisely the trap this feature was built to remove, rebuilt by the feature itself.

Two things about how it was caught. It came from the measurement, not from hitting it — no test would have
failed until somebody discarded a cancellation and then needed a second one, which is a Tuesday in a
brokerage and never in a test suite. And it sits in `db:divergence`'s measured blind spot (partial indexes),
so the assertion lives in the migration's own `DO` block, per the rule already recorded for that gate; the
assertion was run against the un-widened index first and printed the real predicate in its refusal.

**The generalisation, for the next time a state is added to an existing model:** enumerate every read of
that model and answer, per read, "can a row in the new state reach this, and is the answer it gives still
true?" The cost here was one measurement pass over 31 sites. The cost of not doing it is § 1.40's — a number
that drifts from correct to wrong with use, while every gate stays green.

### 1.52 — THREE AUDIT FILTERS THE API ACCEPTS AND NO CONTROL OFFERS

`ListAuditTrailQueryDto` accepts `entityType`, `entityId`, `userId`, `action`, `from` and `to`. The
screen offered the first two. `userId` was closed by the actor picker (Plan B) — the question an audit
trail exists to answer had no control at all — and `action`, `from` and `to` are still unreachable.

This is § 1.44's class, measured again: an API surface with no caller. It is not the same as a missing
feature, because the server half is built, tested and gated; what is missing is three form controls. A
compliance officer who wants "every DELETE last March" has to ask a developer to construct a URL.

Not built here deliberately — the owner's ask was the search component and the audit screen's two named
halves, and an action/date filter is a different feature. Recorded so the next person does not have to
re-measure the DTO to find out.

### 1.51 — A GUARD THAT RUNS, FAILS, AND IS NOT READ. Five ways a proof can be absent while looking present

Five separate mechanisms, found between 2026-09-24 and 2026-09-25, all with the same signature: the
evidence LOOKED like evidence.

**(a) A plant that never applied.** Three plants reported PASSING and had not touched a file.
`process.argv[2]` is empty when node runs with `-e` — no script path occupies argv[1] — so the
selector was `undefined`, no branch matched, and the suite was green for the only reason a suite is
ever green: nothing was wrong with it. A plant that silently does nothing is INDISTINGUISHABLE from a
guard that works; both print a green suite, and the output is then used to justify "this guard is
proven". Audited across the whole week from the session record: 121 plant runs, 67 showing a test
dying, 52 setup/revert steps, and **exactly 3 that reported everything passing** — 2026-09-21T19:48,
2026-09-22T06:38 and 2026-09-24T20:43. All three were noticed and re-run within a minute, which is the
only reason this was survivable.

**(b) A plant DEFINED and never invoked.** A fourth failure mode the "all passed" signal cannot catch,
because nothing ran at all: `plant-ua.mjs` defined four named plants and the loop listed three. The
commit message claimed four. The missing one (`encrypt-inside`, proving no KMS round trip happens
inside the person-and-account transaction) was run afterwards and the guard SURVIVES — but it was
unproven for the whole time it was described as proven.

**(c) A guard file that CI ran, failed on, and nobody read.** `permission-only-gates.e2e-spec.ts`
caught four wrong route gates on `477965d` immediately, naming them:
`expected [ 'GET /admin/departments', …(3) ] to deeply equal []`. It caught them again on
`a7a977d`. Then `395a0a3` introduced an undeclared index, `db:divergence` went red EARLIER in the
same job, the job short-circuited, and **the api e2e suite stopped running at all for three commits** —
so the original failure vanished behind a newer red while local gates stayed green.

The fixes are all structural, because none of these is a thing to be more careful about:

- `scripts/plant.mjs` is the only plant mechanism now. It refuses a missing name, an unknown name, a
  `from` that is absent (the code moved, so the plant is stale), a `from` that occurs more than once
  (ambiguous site), a replacement identical to the original, and it RE-READS the file from disk to
  confirm the edit landed before printing `PLANTED`. Revert restores from a backup written at apply
  time, byte for byte, so a half-reverted plant is not a state you can reach. `--self-test` plants on
  the plant mechanism itself — eleven cases, including the original bug as a test (invoked with no name,
  it must exit non-zero) — and is a gate in `verify.sh`.
- `scripts/check-ci.sh` is the LAST gate in `verify.sh`: it reads the CI conclusion for HEAD and
  fails when a run is red, unfinished, or absent-though-pushed, printing the `gh run view` command for
  each failing run. Being unable to check (no `gh`) is also a failure, because "I could not check" is
  the state that produced this. It passes quietly when HEAD is not pushed yet.
- `ci.yml`'s seed, integration and contract steps carry `if: ${{ !cancelled() }}`, so a red
  verification step no longer hides every test behind it. The job still fails; it stops being a
  one-signal job.

**(d) A plant that APPLIED, and nothing died — because the test could not observe the thing it
guards.** One week after (a), `scripts/plant.mjs` removed the `preventDefault` from EntitySearch's Enter
handler, reported `PLANTED … 10327 -> 10291 bytes, verified on disk`, and all seven tests stayed GREEN.
The tool was right: the bytes changed. The test was wrong: it asserted "no POST happened" on a form whose
required fields make the browser block submission regardless, so both worlds look identical from where it
was standing.

**The standard is "bytes changed AND a test died". "Bytes changed" alone is not.** The plant tool cannot
catch this one — it can only prove the edit landed. Choosing a surface where the two worlds differ
observably is the part no tool does: the rewritten test runs on the audit browse form, which has no
required fields and whose submit is an observable request, and it additionally asserts that the button
still submits, so a dead form cannot pass for a prevented default.

The question to ask of every plant, before believing a green suite: **on this surface, what would the
broken version have done differently?** If the answer is "nothing observable", the plant proved the
plant, not the guard.

**(e) A plant that APPLIED, and the tool said it had NOT — leaving the plant live.** The mirror image of
(a), and the more dangerous half of the pair. `plant.mjs` verified the wrong invariant after writing:
"the text this plant replaces is gone". That is right for a substitution and wrong for an INSERTION — a
plant whose replacement keeps the line it anchors on and adds a write above it, which is how you prove a
test observes a SIDE EFFECT rather than a changed branch. The endorsement plant ("the discard also touches
the policy") is exactly that shape. The tool wrote the file, re-read it, saw the anchor text still present,
and exited non-zero saying the plant had not applied — with the plant in the working tree and a backup
nobody had been told to revert. The suite then failed for the planted reason while the tool's own output
said nothing had been planted.

Worth stating plainly because the first instinct is to read a loud failure as safe: **a loud failure that
misdescribes what happened is not safer than a quiet success — it is the same defect with the halves
swapped.** (a) reported success over no change; (e) reported no change over a real one. Both end with the
operator believing something false about the tree.

The invariant is now "the file on disk is EXACTLY what this plant intended to write", which is the thing
actually being claimed, and it admits insertions. `--self-test` gained a case that applies an inserting
plant and compares the whole file; restoring the old condition makes exactly that case fail, which is how
the fix was shown to be non-vacuous.

**A GUARD FIRING ON ITS BUILDER.** Worth recording separately, because it is the return on every one of
these. Four-action Phase 1 declared two new permissions under a module (`sales-crm`) that no other code
used, when their siblings live in `commercial-front-office`. A permission's module is what groups it on
the Role matrix screen, so that would have rendered a thirteenth group holding two rows — on the very
screen the four-action scheme exists for. Nobody reviewed it. The matrix test's module pin went 12 → 13 and
said so, in the same run as the catalogue-count pin.

The pin was written two commits earlier, by the same hands, for exactly this. That is what a measured pin
is for: it does not care who is wrong, and it does not get tired the way a reviewer does.

The class, stated once: **a proof is only a proof if its absence is loud, AND its report has to describe
what actually happened.** A plant, a guard file, and a CI job all have a silent-absence mode, and all three
were in it simultaneously. A fourth was added by the same reasoning applied one level deeper: a plant that
lands on a surface where nothing can observe it is silent absence wearing a green suite. The fifth is the
one that says loudness is not sufficient — a tool can fail loudly about the wrong thing, and then the
operator is misinformed with a non-zero exit code to back it up.

### 1.50 `P1` — PEP SCREENING DOES NOT EXIST: a sanctions result is stored three times, once labelled PEP

Measured on the owner's question "do KYC and PEP actually work end to end", driven through the real
API on the dev database. **Sanctions screening works. PEP screening is a label on a sanctions result.**

**What happens today, from the screen.** A corporate customer named `'ABBAS, Yasir` — a name taken
FROM the live synced list rather than invented — created, KYC submitted, screening run:

    RESULT SANCTIONS  HIT    list=OFAC_SDN (PAARSSR-EO13894)  provider=built_in  escalated=yes
    RESULT PEP        HIT    list=OFAC_SDN (PAARSSR-EO13894)  provider=built_in  escalated=yes
    RESULT AML        HIT    list=OFAC_SDN (PAARSSR-EO13894)  provider=built_in  escalated=yes
    ScreeningMatch queued for human review: 1   (status `pending`)
    KYC status after screening: SCREENING       (not auto-approved)

An invented name came back CLEAR on all three, escalated nothing, queued nothing. So the machinery —
match, store, escalate, queue for review, hold the KYC record — works, and the queue is reachable by
`COMPLIANCE_OFFICER` (3 live grants) at `/screening-matches`, gated on `sanctions-pep.screen`.

**THE DEFECT.** A "PEP HIT" cites an OFAC SDN sanctions programme as its source. The three types are
one computation stored under three labels, which the whole-database distribution confirms exactly:
27 CLEAR / 11 HIT / 6 PENDING_INVESTIGATION for EACH of SANCTIONS, PEP and AML — identical because it
is one result written three times.

**There is no PEP data to screen against.** `WatchlistEntry` has no list-type column at all; its only
classifier is `source`, and the only sources are `OFAC_SDN` (58,172 rows) and `UN_CONSOLIDATED`
(3,033). Both are sanctions lists. So a politically exposed person who is NOT sanctioned returns
**PEP: CLEAR** — a false negative on the check a regulator asks about, reported with the same
confidence as a true one — and a sanctioned person returns PEP: HIT, a true answer to a question
nobody asked.

`ScreeningService`'s own header says as much ("a real integration would call three distinct
lists/providers per type; this is a deliberate simplification"). The simplification has become a
false claim on screen, because the screen shows a PEP result and names no caveat.

**Specified and NOT implemented, named exactly.** `ScreeningMatch` already carries `listType`,
`pepPosition`, `providerEntityId`, `provider`, `reviewThreshold` and `algorithmVersion`; the schema
anticipates a commercial PEP provider with positions and per-provider thresholds. `ScreeningResult`
carries `provider` and `attemptOutcome`. Nothing sits behind any of it — every stored row is
`provider=built_in`.

**Two smaller measurements.** Every HIT predating this test came from the dev-only FIXTURE
(`listSource` = "Sample OFAC SDN List (fixture)", 33 rows), not from the 61,205 real entries; and
`ScreeningMatch` was **0** across the whole database, so the human-review queue had never held a row.
Both are explained by seeded customers having randomly generated names that match nothing — the first
real match appeared the moment a real listed name was used. Neither is a fault; both would have been
easy to mistake for one.

**Nothing changed in this area, per instruction.** The options are not equivalent: buy a PEP data
source, or remove the PEP and AML labels until there is one. The second is free and honest; the first
is the actual requirement. What must not continue is a screen reporting PEP: CLEAR to a compliance
officer on the strength of a sanctions list.


### 1.49 — ONE screen could render a heading and nothing else. My first count of FOURTEEN was wrong, and the correction is the useful part

Found while diagnosing a blank `/settings/roles`. The screen was not broken — it renders 12 role
rows against a healthy API, and it shows an explicit error when the response cannot be parsed
(both measured). What WAS broken is narrower and worth naming, because it is a pattern rather
than a bug:

```ts
useEffect(() => {
  if (!user || !canRead) return;   // <- the client already knows; it never asks
  void load();                      // <- and the no-permission message lives in load()'s catch
}, [user, canRead, load]);
```

A caller the CLIENT knows cannot read never reaches `load()`, so the message that explains the
refusal — which exists, and is correctly worded — never renders. Measured on the roles screen: the
`main` element held **157 characters**, a heading and one sentence of intro. No table, no empty
state, no reason.

Fixed on `/settings/roles` (a `!canRead` branch, plus a loading line for the window before the
first response, which also rendered nothing).

**I then reported fourteen other screens with the same shape. That was wrong, and the mistake is
worth more than the list was.** My grep matched every screen whose load effect returns early —
`if (!user) return;` — and that is NOT this defect. A screen gated only on `!user` still calls the
API, still receives the 403, and still renders `loadError`; the message is reachable. The defect
needs a CAPABILITY inside the early return, because that is what stops the request from being made
at all and therefore stops the message that lives in the catch.

Re-measured with the right pattern (`!can…` inside the guard) across all 96 screens:

    apps/web/app/(app)/settings/roles/page.tsx:221   if (!user || !canRead) return;
    apps/web/app/(app)/settings/roles/page.tsx:228   if (!canReadCatalogue) return;

**One file — the one already fixed.** The three I named as worth doing first
(`screening-health`, `screening-matches`, `sla-policies`) were then read individually, and each
renders `loadError` on a 403. They were false positives, and folding them into this work would have
meant changing screens that were not broken.

The class, which is the part to keep: **a grep for a SHAPE is not a measurement of a DEFECT.** I
searched for the pattern I had just fixed rather than the one that caused the symptom, and fourteen
files matched it innocently. Reading three of them took two minutes and removed thirteen from the
list — verify a sample before quoting a count.

**And the test lesson, which is the reason this survived 454 green Playwright tests.** My first
version of the proving test asserted a page-wide `getByRole("status").or(getByRole("alert"))` and
**PASSED on the broken build** — satisfied by an empty-text live region OUTSIDE the content area
while `main` held nothing but the heading. A test that can be satisfied from outside the screen is
not testing the screen. Scoped to `main` and to the sentence itself, it fails on `cb24c60` and
passes after the fix.

The general form: **a navigation test that stops at the href shares the assumption it should be
checking.** Assert content — a row, a named value, or an explicit empty-state message.

### 1.48 — A PARTIAL VERDICT REPORTED AS COMPLETE: "screens hidden, not denied" was true of the nav and false of the launcher

**Corrects an earlier audit verdict of my own.** Audit item 5 — *screens are hidden rather than
shown-then-denied* — came back **BUILT**, evidenced by `AppNav` assembling the sidebar from the
resolved permission set. That evidence was real and the verdict was wrong, because the sidebar is
not the only surface that offers routes.

`app/(app)/page.tsx` — the FIRST screen after login, and the most prominent surface in the product —
carried its own hard-coded list of six cards with **no permission check at all**. Measured on the
office administrator's 29 codes: four of the six answered 403 for her (`/leads`, `/prospects`,
`/customers`, `/customers/kyc-queue`) and the three screens she could actually use — `/settings/roles`,
`/settings/users`, `/employees` — had **no card at all**.

The consequence was not cosmetic. She reported that there was **no page to create a role**. There
is: `/settings/roles` is 642 lines, it creates, renames, sets the permission matrix, retires and
reactivates, and `CLAUDE.md`'s claim about it is accurate. It sits in the `الإدارة` group, which is
collapsed unless it holds the current route, and nothing else pointed at it. **A working feature was
indistinguishable from a missing one for the person it was built for.**

**The class.** I measured the mechanism I knew to look at. The verdict should have been *"true of
AppNav; every other surface that renders a destination is unchecked"*, which is a different
sentence and would have sent someone to the launcher. The same shape as the seed: the walkthrough
was written from the code, and the one step never executed was the one that broke.

**The fix is structural rather than repeated.** `components/app/destinations.ts` now holds the
single destination catalogue and the single predicate (`canReach`); `AppNav` and the launcher both
read it. The rule to keep: **if a destination is rendered anywhere, its gating permission decides
whether it renders — one mechanism, not one per surface.** A second hard-coded list cannot satisfy
`e2e/home-launcher.spec.ts`, whose third test enumerates what the launcher offers and asserts every
entry is reachable; planting the unfiltered version kills all four tests.

**Two things the fix had to get right, both found by the tests rather than by reasoning.**
`/settings/security` is ungated on purpose, so it is appended unconditionally — which made the
"nothing to show" message unreachable when it keyed on the full group list; it keys on the MODULE
groups now, and a zero-permission account sees both the explanation and its one route. And the
enumerating test read the DOM before hydration and got zero cards, which would have passed every
"must not contain" assertion for entirely the wrong reason — it anchors on a card that must be
present first.

### 1.47 `P2` — FOUR web Playwright tests are chronically flaky in CI, and a green run has been hiding them

Found while diagnosing a genuine red, which is how a retried flake usually surfaces: you go looking
for one failure and find the run has been carrying two others for a while.

`apps/web/e2e/rfq.spec.ts` "tracks the adjuster survey…" (line 2456) and "settles a small claim
straight through as four distinct figures" (line 2574) both fail on a first attempt in CI with

    Error: locator.click: Test timeout of 30000ms exceeded.
    57 × waiting for element to be visible, enabled and stable

waiting on `Documentation · complete`, and both pass on retry. Playwright reports them as **2
flaky** and the job still concludes SUCCESS.

**Measured across three consecutive runs, and the count GREW while every gate stayed green:**

| CI run | Overall | Flaky |
|---|---|---|
| `35784578362` | **success** | 2 — already flaky before any of this session's screen work |
| `35789856896` | failure (an unrelated real defect, since fixed) | 2 |
| `35827299885` | **success** | **4** |

The two new ones are `rfq.spec.ts:2621` ("a large claim settlement blocks on a mandatory distinct
second approver") and `:2673` ("closes a settled claim once the client payment receipt is
confirmed"). So the flake is not two tests — it is the CLAIMS BLOCK of that file, four consecutive
tests, and it is spreading.

**Ruled out: a cascade.** Consecutive tests sharing state would explain 2 growing to 4, so it was
checked — each of the four calls `mockAuth` + `mockRfqApi` itself and runs in its own browser
context, so none inherits another's state. They are independent tests that happen to do the same
expensive thing.

**What they share is the SHAPE.** Each files four claim documents in a loop — a `selectOption`, two
`fill`s and a `click` per document, so roughly sixteen sequential interactions — and only then
asserts `Documentation · complete`, against a 30s per-test timeout. On CI's slower single-core
runner that budget is marginal, which is why the count tracks load rather than any code change.

**Why this matters even though the gate is green.** A retried flake is a signal the suite has
stopped carrying: the run says success, so nobody looks, and the same two tests could begin failing
for a NEW reason without anyone noticing the change. It also cost real time here — three failures
appeared in one red run and two of them were noise, so the diagnosis started by ruling out a
connection to a nav change that had none.

**Not fixed here** — it is a claims-test concern in a file this session has no other business in,
and the queue has docs next. Named so it can be picked up deliberately:

1. The four tests share one helper-shaped loop. Extract it, and have it wait on the state each
   click depends on rather than on the final label — sixteen interactions with one assertion at the
   end reports "slow" and "broken" identically.
2. Then decide the timeout on evidence. Raising it first would be the § 1.1 mistake again: a
   mitigation that buys time and hides the next crossing.

**The rule worth taking from it now:** `4 flaky` in a green run is a finding. Read the flaky count,
not only the conclusion — and read whether it CHANGED, because a growing count is a different
problem from a stable one.



## 2. Bugs found & fixed this session (regression-watch)

All fixed and covered by tests; listed so a future refactor doesn't silently
undo them.

| # | Bug | Where | Guard |
|---|---|---|---|
| P0 | Non-atomic write — `Prospect` could be created before the `Lead` transition, orphaning on failure | #2 `ProspectService.convert` | e2e asserts risky write first; unit test |
| P0 | Recommendation approval/COI gates were computed from **stale draft-time** data, not live | #16 `RecommendationService` | gates re-derived at send/approve; e2e |
| P0 | `Receipt` had no `@unique` on `invoiceId` — two receipts per invoice possible | #32 migration `20260902220000` | `Receipt.invoiceId @unique` + `P2002` handling |
| P0 | Commission-override approve `updateMany` `where` only re-asserted `status`, not the maker id / amount being copied → stale write or DB-CHECK 500 on a concurrent raise | #35 `CommissionRepository.recordOverrideApproval` | `where` re-asserts **every** validated field; drove a new `race-safe-invariants.md` clause |
| P0 | `buildCommissionRollup.outstanding = amount − paid − reversed` went **negative** for a reconciled-then-clawed-back entry, corrupting the pooled total + inverting the worst-first sort | #40 `finance.config.ts` | `max(0, …)` per entry + `netEarned` field + settled-then-reversed spec case |
| P1 | `finishRemittance` concurrent-landed early-return was a silent 200 even if a different channel/amount landed | #38 `CollectionService` | full same-check → 409 |
| P1 | Owner FKs `ON DELETE SET NULL` would violate the `PaymentChannel_owner_exactly_one` CHECK on a hard delete | #38 migration | `ON DELETE RESTRICT` |
| P1 | `#39` detect `conflicting_exception` returned the *old* row's variance / nothing; a missed best-effort `→ EXCEPTION_RAISED` never retried | #39 `ReconciliationService` | fresh variance always; self-heal on same-figures re-detect |
| P1 | `resumeInvoiceAs: 'REMITTED'` would land a terminal-state invoice with **no `Remittance` row and no `out` `ClientFundsLedgerEntry`** (Part 7.3 hole) | #39 | constrained to `RECONCILED` only |
| P2 | `permissions.spec.ts` had a stale role-level assertion (`FINANCE` on `refund.approve`) failing since #22's `4aa7c3b` | `packages/db` | corrected the test, not the seed (Finance **is** a legitimate refund checker; "not your own" is instance-level) |
| P2 | Local `db` container was missing the `ibms` role/database | dev env | `CREATE ROLE` / `CREATE DATABASE`, non-destructive |

---

## 3. Missing functions / deferred wiring (cross-cutting)

These span multiple backlog items or leave a first-class model unused. Ordered
by blast radius.

### 3.1 `P0` — Two sources of truth for commission

- `Invoice.commissionDeducted` (#31/#32) is derived from the **placed
  quotation's** `commissionRatePercent`.
- `CommissionLedgerEntry.amount` (#35/#36/#40) is derived from the **governed
  `CommissionAgreement`** rate at the policy's inception.
- These are **never reconciled**. `Invoice.commissionDeducted` was deliberately
  **not** rewired onto the governed table. The #40 `commission` roll-up and the
  #34 payables figure both use `Invoice.commissionDeducted`; the #40
  `profitability` section uses `CommissionLedgerEntry`. A dashboard can show two
  different "commission" numbers.
- **Fix:** decide which is authoritative, rewire the other (or add a
  reconciliation view that flags divergence), and make #34/#40 consistent.

### 3.2 `P1` — Refund lifecycle — PARTLY RESOLVED (2026-09-09)

- ~~`Refund.paidAt` is never written~~ — **built.** `POST /refunds/:id/disburse`
  (`refund.disburse`, Finance) stamps `paidAt` and books the client-funds `out`
  movement in ONE `$transaction`, with the stamp status-conditional on
  `paidAt: null` so two concurrent disbursements cannot both pay out. Three
  gates, all load-bearing: the approval requirement is **re-derived from the
  live amount** (`refundNeedsApproval`), never trusted from the stored
  `approvalThresholdMatrixLevel` snapshot — without that this endpoint is a
  maker/checker bypass; the endorsement must actually have reached `APPLIED`
  (paying a refund for an adjustment never made to the policy returns premium
  the client is still being charged); and the ledger movement is transactional
  with the stamp, the same guarantee the `in` side already had.
- **Still open:** `refund.raise` remains seeded with no endpoint — a standalone
  overpayment/goodwill refund needs `Refund.endorsementId` to become nullable,
  since today every refund is anchored to the endorsement whose premium
  adjustment created it. Still no **write-off** path.
- **Fix (remaining):** the schema migration + `POST /refunds`, and a
  maker/checker write-off endpoint.

### 3.3 `P1` — `PremiumTransaction` model is never written

- The schema's generic premium-ledger model exists but no code touches it. #31
  fills `Invoice.premiumAmount` directly; #32 books `ClientFundsLedgerEntry`
  in/out.
- **Fix:** either populate `PremiumTransaction` from the #31/#32/#35/#36 flows,
  or delete the model if `Invoice` + `ClientFundsLedgerEntry` +
  `CommissionLedgerEntry` are the real ledger.

### 3.4 `P1` — Partial payments — RESOLVED (2026-09-09)

An invoice may now be settled in instalments. What that took, beyond dropping
the `@unique` (which on its own was a P0 regression — see the 2026-09-09 note
at the top of this file):

- **A replacement race gate.** `InvoiceRepository.recordReceiptWithLedger` now
  takes `SELECT ... FOR UPDATE` on the parent `Invoice` before re-summing and
  inserting, so concurrent instalments cannot both pass the "does this exceed
  the invoiced total?" check. The old `P2002`-on-`invoiceId` backstop is gone
  and this replaces it (`race-safe-invariants.md` — the write re-asserts the
  condition, under serialisation).
- **An idempotency key.** `Receipt.reference` + a partial `UNIQUE
  (invoiceId, reference) WHERE reference IS NOT NULL` (migration
  `20260909160000`). With instalments allowed, figures alone can no longer
  distinguish a retried POST from a genuine second payment of the same amount.
- **The readers.** `loadOutstandingReceivables` sums receipts and reports the
  REMAINING balance instead of dropping an invoice the moment its first
  instalment lands (which silently understated receivables by the unpaid
  half); `buildReceivablesAgeing` buckets that outstanding figure;
  `loadInsurerObligations` requires FULL collection before an invoice becomes
  an obligation to the insurer (a half-collected invoice treated as fully owed
  would remit the broker's own money).
- **The invoice cycle.** Only the instalment that completes the invoice walks
  `INVOICED → COLLECTED`. `reconcile` already re-derived the sum from live
  rows, so it needed no change.
- **`InvoiceView`** gained `receipts[]`, `collectedAmount`,
  `outstandingAmount` and `fullyCollected`, all computed server-side.

**Still open:** an over-payment is still a 422 pointing at Process 39, not an
automatic `Refund` — the over-payment → `Refund` bridge needs the same
`Refund.endorsementId` nullability §3.2 does.

### 3.5 `P1` — `ClientFundsLedgerEntry` has no balance / reconciliation surface

- Append-only movement log; no running-balance query, no per-client funds
  statement, no "client money held vs. owed" reconciliation report (a CBJ Part
  7.3 expectation).
- **Fix:** `GET /client-funds/:customerId/statement` (running balance) and a
  book-wide "held vs. owed to insurers" reconciliation view.

### 3.6 ~~`P1` — The renewal module (Part 3.9) not existing blocks THREE things~~ — RESOLVED (2026-09-09)

**Built.** `apps/api/src/modules/renewal/` — a nightly `@Cron` sweep (05:00
UTC) plus on-demand `POST /renewal-cases/detect` opens a `RenewalCase` for
every ACTIVE policy inside its lead-time window (`RenewalCase.policyId
@unique` + `P2002` → counted skip is the race gate); `POST
/renewal-cases/:id/transition` walks `RenewalStatus` through the engine, whose
`WORKFLOW_TRANSITIONS.RenewalCase` map had existed since A.6 with no caller;
`PATCH /renewal-cases/:id/flags` carries the two re-marketing triggers. Two
new seeded permissions (`renewal.read`, `renewal.manage`). No migration —
every model and enum already existed.

All three dependents are now live: opening a case triggers
`LossRatioService.recomputeForPolicy` (which had no `RenewalCase` parent to
write to and took its logged no-op branch in every environment);
`RetentionCaseService.runSweep` finally has rows to read; and
`renewal_workflow_start` — one of only two `SLA_REGISTRY` entries with no
caller anywhere, a Part G gate failure — now has one, with the due date
counted BACK from expiry rather than forward from now.

**Scope deliberately limited to the trigger and the lifecycle.** A renewal
that goes to market re-uses the existing Opportunity → RFQ → Quotation →
Comparison → Recommendation chain (`RenewalCase.opportunity` is already in the
schema for exactly that). Building a parallel renewal-quotation stack would be
the two-sources-of-truth mistake §3.1 already records once.

**Still open:** the loss-ratio "period" is still all-time/paid-only — this
module gives it a `RenewalCase` to hang off, but narrowing it to the policy
year and adding earned-premium proration is a separate change. The original
entry follows, for the record.

### 3.6a (historical) — what the gap was

- `LossRatioModule` upserts a `LossRatio` per `RenewalCase`, but every call is a
  **logged no-op** because the renewal module (`RenewalCase` producer) is not
  built. #30 Claims Analytics computes loss ratio on the fly instead.
- Also: the loss-ratio "period" is **all-time / paid-only** — no earned-premium
  proration, no incurred (open-claim reserve) ratio.
- **New as of #46**: `RetentionCaseService.runSweep` (Customer Retention,
  Domain E) reads `RenewalCase.status` / `.triggeredAt` to auto-open a
  retention case on lapse risk or renewal inactivity — also a logged no-op in
  normal running today, same root cause. Unlike Loss Ratio, #46 has **no
  fallback on-the-fly computation** (there's nothing else it could compute
  from) — it is entirely inert until the renewal module lands.
- This item's blast radius has grown from one dependent (Loss Ratio, at Domain
  D) to three (+ #30 Claims Analytics' framing of "current" loss ratio, +
  #46 Customer Retention) — worth moving up the priority queue if the renewal
  module (Part 3.9) is scheduled soon, since it now unblocks real behaviour in
  two already-shipped Domain E/C features, not just one.
- **Fix:** build the renewal module, then wire both recomputes; add an
  incurred ratio option once claim reserves exist.

### 3.7 `P1` — #8 Cross-Selling was built as a no-op "until the Policy module lands"

- The Policy module (#18–22) now exists. Cross-Selling's gap scan compares a
  customer's in-force policies against a benchmark line list — it may now
  actually produce findings and has not been re-verified end-to-end against real
  `Policy` rows.
- **Fix:** re-run #8 against issued policies; confirm the `@@unique([customerId,
  gapLine])` backstop and the nightly sweep behave.

### 3.8 `P2` — Missing invoice types

- Only `new_business_premium` invoices are modelled. `endorsement_adjustment`
  (from #22) and `renewal_premium` (from the renewal module) are not raised.
- **Fix:** wire #22's `calculateAdjustment` to raise an
  `endorsement_adjustment` invoice; add the renewal invoice when that module
  lands.

### 3.9 `P2` — #39 has no `InsurerStatement` model

- `POST /reconciliation-exceptions/detect` takes statement lines in the request
  body; there is no stored statement, no import format, no per-statement
  grouping or audit trail, and no automatic detection sweep.
- **Fix:** an `InsurerStatement` model + a CSV/MT940 import + a scheduled
  detection pass, when a real statement feed exists.

### 3.10 `P2` — Reporting: no point-in-time for commission / profitability, no filters, no export

- #40's `commission` and `profitability` sections are **current-state only**
  (`asOf` only constrains receivables/payables). No line / insurer / branch /
  time / language filters. No CSV / export. In-memory aggregation capped at
  5000 rows/section with **no `truncated` flag** in the payload (same for #30 /
  #33 / #34).
- **Fix (Part E):** push aggregation into SQL (`GROUP BY`), add the filter
  params, add a `truncated` boolean to every capped payload, add CSV export.

### 3.11 `P2` — VAT on a commission reversal is not netted

- #40's `commission.vat` / `commission.gross` are computed on the **gross**
  `earned`; a fully-reversed entry still reports its full VAT. #36 recomputes
  `vatAmount` on an override but not on a reversal.
- **Fix:** decide the tax treatment of a clawed-back commission's VAT (likely a
  credit note) and net it in `buildCommissionRollup` + #36's reversal path.

### 3.12 `P2` — `Insurer.creditTermsDays` is ignored

- #34's payables report shows raw days-outstanding; the insurer's contractual
  grace period is never applied, so nothing is flagged "overdue to the insurer".
- **Fix:** subtract `creditTermsDays` when computing `oldestDaysOutstanding` /
  an `overdue` flag.

### 3.13 `P2` — #41 service requests have no `Document` link and no `change`-request execution path

- A `fulfilled` `certificate` / `copy` request should attach the generated PDF
  (a #25-style `Document` pointer) — not built; the outcome is a free-text note
  only.
- A `change` request (e.g. "update my bank details", "change the mailing
  address") records intent but executes **nothing** — no endorsement is raised,
  no `PaymentChannel` is created. The `NO_FULL_ACCOUNT_NUMBER` guard on
  `detail` / `outcomeNote` (added at the #41 review) keeps a full account number
  out of the free text, but there is still no governed path *from* a service
  request *to* the masked `PaymentChannel` (#38) or an `Endorsement` (#22).
- One 5-business-day SLA covers all four `requestType`s; no per-type target.
- **Fix:** a `ServiceRequest` → `Document` attach on fulfil; a "convert to
  endorsement / payment-channel" action for `change` requests; per-`requestType`
  SLA figures once a service charter supplies them.

---

## 4. Drafted / unsourced values (need a real regulatory citation)

Every value below is a **placeholder the code treats as real**. Each needs a
CBJ / PDPL / Part-3.x source, or a documented business sign-off, before the
system is used for anything.

| Value | Where | Current placeholder |
|---|---|---|
| `INVOICE_MAX_DUE_DAYS_AHEAD` | #31 `finance.config.ts` | 365 days |
| AR ageing bands (`current` / 1–30 / 31–60 / 61–90 / 90+) | #33 `ageingBucketFor` | textbook 30/60/90 |
| `CLAIM_LARGE_THRESHOLD_JOD` (2nd-approver + advisory flag) | #23/#28 | 25 000 JOD |
| Claim follow-up thresholds per line family | #27 | drafted per-family, snapshotted at notification |
| Loss-ratio "period" | #29/#30 | all-time, paid-only |
| `RECON_DETECT_MAX_LINES` | #39 | 500 |
| `FINANCIAL_REPORT_ROW_LIMIT` | #40 | 5000 |
| `ANALYTICS_POLICY_LIMIT` / `AR_AGEING_INVOICE_LIMIT` / `INSURER_PAYABLES_ROW_LIMIT` | #30/#33/#34 | 5000 |
| `netPosition` metric definition (`premium − claims − commission`) | #40 `buildProfitability` | drafted; brokerage P&L driver is actually `commissionEarned` |
| Commission VAT rate | #36 `CommissionAgreement.vatRatePercent` | governed field, value is a manual input (Jordan GST on broker commission unsourced) |
| Premium tax rate | #31 `Invoice.taxAmount` | raw Finance input — **no governed tax-rate table, no exemption model** |
| COI thresholds (10% share / 2 pp price) | #16 | drafted |
| Mandatory-document checklist matrix | #25/#26 | drafted per claim type/line |
| Claim-decision preconditions (adjuster survey + investigation both done) | #26 | drafted |
| KYC compliance-review turnaround + re-KYC cadence | `kyc-aml-sla-timers.md` | draft/unsourced |
| `service_request_fulfilment` SLA | #41 `sla-registry.config.ts` | 5 business days, escalate to Branch/Dept Manager — DRAFT/UNSOURCED (courtesy target, not a PDPL SLA) |
| `complaint_resolution` SLA | #42 `sla-registry.config.ts` | 10 business days, escalate to Branch/Dept Manager — DRAFT/UNSOURCED (CBJ conduct-of-business, not a PDPL SLA; a CBJ complaint-handling instruction should supply the real figure) |
| Jordan business-day calendar (SLA timers) | A.8 | brain gap filed; not implemented |
| `SLA_DASHBOARD_DUE_SOON_WINDOW` | #43 `sla-dashboard.config.ts` | 3 calendar days — a dashboard lookahead heuristic, not a registry SLA value, so lower stakes than the others in this table (doesn't move a deadline) but still an untraced number |
| `FEEDBACK_SCORE_MIN`/`MAX` (satisfaction scale) | #45 `feedback.config.ts` | 1–5, common CSAT convention — no CX/Compliance SOP source |
| `RENEWAL_INACTIVITY_THRESHOLD_BUSINESS_DAYS` | #46 `retention-case.config.ts` | 30 business days since `RenewalCase.triggeredAt` — no source; blocked on the same renewal-module gap as 3.6 anyway |
| `sanctions_match_review` SLA | #49 `sla-registry.config.ts` | 3 business days, escalate to Compliance Officer — DRAFT/UNSOURCED. Neither `pdpl-sla-timers.md` nor `kyc-aml-sla-timers.md` covers turnaround for adjudicating a sanctions-list match. Drafted TIGHTER than the 5-day standard KYC review on the reasoning that an unadjudicated match on a LIVE customer is a live exposure, not a queued onboarding step — that reasoning is ours, not a regulator's. A CBJ AML/CFT instruction or the broker's own AML policy should supply the real figure. |

---

## 5. Security & compliance threats / gaps

### 5.1 `P0` — Part D (PDPL / M-series) is mostly unbuilt — M03 landed 2026-09-04

- **`ConsentRecord` capture/withdrawal is now built** (M03 — `apps/api/src/
  modules/pdpl/`, `ibms-brain/meta/context/consent-management.md`): a grant
  or explicit decline at `POST /consent-records`, plus a two-step
  request-withdrawal/confirm-withdrawal flow that gives the `consent_withdrawal`
  `SlaTimer` (2 business days) a real window and feeds #44's marketing-send
  gate live. **Not built as part of M03**: the capture form is a generic
  screen, not wired into the 7 named touchpoints (lead capture, onboarding/
  KYC, needs & risk assessment, RFQ/market placement, claims, Group
  Medical/Life & Motor Fleet, renewal & cross/up-sell) individually — that
  UI-integration work is still open.
- Still nothing else: no `DataSubjectRequest` handling (M04); no retention &
  disposal *execution* (M06 — `RetentionScheduleItem` / `LegalHold` /
  `DisposalBatch` / `CertificateOfDestruction` have existed in the schema
  since the initial migration, nothing drives them); no cross-border
  transfer gating or `DataSharingApproval` (M08); no DPIA screening (M10);
  no version-controlled bilingual privacy notices; no RoPA register; no DPO
  workspace.
- The **A.8 SLA registry already carries every PDPL timer definition**
  (consent withdrawal, DSR, breach containment, disposal) — `consent_withdrawal`
  is the **first one with a real caller** (M03); DSR / breach containment /
  disposal are still undocumented deadlines, exactly the gap
  `pdpl-sla-timers.md` warns about.
- **Impact:** the system stores national IDs (encrypted), UBO data, medical
  reports (claims), and financial data with a lawful-basis *trail* now
  starting to exist for MARKETING consent specifically (and any other
  `ConsentPurpose`, if a call site captures it) but still **no DSR/erasure
  path and no retention enforcement**. This remains the single biggest
  compliance exposure — one of nine Part D systems is built.

### 5.9 `P0` — RESOLVED (2026-09-09): no way to grant anyone a role

A production seed produced a database with the 11-role catalogue, all 157
permissions, and **not one user able to use any of it**:

- `packages/db/prisma/seed.ts` seeds login-capable sample users **only when
  `NODE_ENV !== 'production'`**.
- `POST /auth/signup` is public and creates an account with **zero roles**.
- `RbacController` is read-only; `user.manage` was seeded and wired to no
  endpoint anywhere; `RoleRepository` had no assignment method.

So there was no path — API or seed — from a fresh production database to any
permission, and therefore to any of the 74 business processes.

**Fixed** by `apps/api/src/modules/rbac/controllers/user-admin.controller.ts`
(`POST /admin/users` provisions an account WITH its initial grants in one
write; grant/revoke; activate/deactivate — all `user.manage` +
SYSTEM_SECURITY_ADMINISTRATOR), plus an opt-in bootstrap administrator in the
seed driven by `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` (deliberately
env-driven, never a hardcoded default credential; the password is validated
against the same Part 10.1 policy the login path enforces, shared from
`@ibms/db` so the two cannot drift). Revoking stamps `revokedAt` rather than
deleting the grant, and revoking the last active administrator is refused —
nobody would be able to grant it back.

Segregation of duties: single-actor, not maker/checker —
`maker-checker-segregation.md` scopes that rule to KYC, policy checking,
refunds, disposal and DSR closure. The compensating control is A.2's periodic
access recertification, which explicitly does not exempt the administrator's
own access.

### 5.2 ~~`P0` — Screening is simulated~~ — LARGELY RESOLVED

**This entry was stale.** A real provider integration landed with Process 49
(`watchlist-sync`) and was never reflected here: `watchlist-fetchers.ts` pulls
the **live OFAC SDN** and **UN Consolidated** lists (free, no API key), and
`ScreeningService` has matched against that synced cache in every environment,
production included. Verified live 2026-09-09: HTTP 200, 5.7 MB, **19,369
records** parsed by this repo's own parser. The fictional fixture is a
*second*, dev-only source, hard-gated off in production. Exactly the "a claim
outlives the session that made it true" pattern this file's own 2026-09-07
note warns about.

**What was genuinely wrong, and is now fixed (2026-09-09):**

- **Matching was exact token-set equality**, which silently missed the two
  commonest real shapes for a Jordan-based broker: a different romanisation of
  the same Arabic name (Muhammad/Mohammed), and a four-part national-ID name
  against a two/three-part list entry. Both produced a **CLEAR** result — the
  worst failure mode a sanctions control has. Replaced with containment
  matching over canonical tokens (`watchlist-match.config.ts`), reusing the
  curated transliteration table Part F item #6 already ships, so an
  Arabic-script given name now collapses to the same key as its Latin
  spelling. Proven against the live OFAC list: a name + an extra middle name
  went **MISS → HIT**, while an exact name stayed a HIT.
- **No match-review queue.** Added `ScreeningMatch` + `GET /screening/matches`
  / `POST /screening/matches/:id/review`, with a mandatory written reason on
  both outcomes and a status-conditional write so two reviewers cannot
  overwrite each other. Conservative by design: a match escalates to EDD and
  raises a queue item, and **never** auto-blocks or auto-suspends — fuzzy
  matching produces false positives, so the decision is a person's.
  Clearing a match does not unwind the EDD escalation it caused.

**Still open (deliberately, and NOT to be self-selected):**

- **No PEP data.** OFAC and UN are sanctions lists. The backlog asks for
  "sanctions/PEP/AML" and there is no free PEP source — this needs a
  commercial provider (Dow Jones / Refinitiv / ComplyAdvantage) with a
  contract and an API key. The provider-adapter shape was scoped and
  deliberately not built, because it could not be tested against the real
  service without credentials.
- **The sync has never been run on a real deployment**, so `WatchlistEntry`
  starts empty. The 12-hourly `WatchlistSyncScheduler` and
  `POST /watchlist-sync/run` both exist; someone has to run one. This is an
  OPERATIONAL gap, no longer a silent one: as of 2026-09-10 an unsynced cache
  no longer produces a CLEAR. A screening that could not reach a populated
  list records `PENDING_INVESTIGATION` (the enum value that had sat in the
  schema since the original model with zero writers), escalates to Compliance,
  is counted separately by the recurring batch as `unscreenable`, and raises a
  banner on the review-queue screen. A CLEAR now means "we checked a list and
  this subject was not on it", never "we checked an empty table".
- The transliteration table covers ~50 common Jordanian/Arab **given** names
  and deliberately excludes family-name components. Family names across
  scripts still will not match. Adding them is NOT a safe incremental change:
  the table's own header records that "Al-"/"El-" prefixes "compose with far
  more variation than a fixed-group table can safely represent without new
  false-positive risk".
- The `sanctions_match_review` SLA figure (3 business days) is **drafted, not
  sourced** — see §4. The queue now has a tracked deadline and escalation;
  what it does not have is a regulatory basis for that particular number.

### 5.3 `P1` — No AML/CFT transaction monitoring (#48)

- No unusual-pattern detection (large premium payments, frequent
  cancellations/refunds, third-party payment sources), no
  `TransactionMonitoringAlert`, no suspicious-activity escalation to the
  competent authority, no regulator-mandated record retention.
- The data to detect these already exists (`Receipt` / `Refund` /
  `Endorsement` / `PaymentChannel.ownerType`) — it's a rules engine + an alert
  workflow that's missing.

### 5.4 `P2` — `CommunicationLog` is a log, not a sender (#44)

- The consent gate itself is built (§ "Resolved since this file was first
  compiled" above) — `POST /communications` correctly blocks a marketing send
  without a granted, non-withdrawn `ConsentRecord`. What's still missing: no
  real email/SMS/WhatsApp gateway integration (a "sent" `CommunicationLog` row
  does not cause anything to actually leave the building), and the
  consent-check-then-write has no DB constraint tying the two together — a
  withdrawal landing in that window would let a row through citing consent
  that no longer holds. Both are explicitly tolerable **only** because there
  is no real dispatch yet (`ibms-brain/meta/context/customer-service-lifecycle.md`
  § "Customer Communication (Process 44)" already says a real integration
  must re-check consent at send time, inside the transaction that actually
  dispatches).
- **Fix:** when a delivery gateway is wired, re-run the consent check
  atomically with the dispatch (not just at `CommunicationLog` creation time).

### 5.5 `P1` — Encryption at rest not enabled on the deployment target

- App-level field encryption (`EncryptionService`) protects national ID / UBO /
  contact fields. **Database and object-storage encryption at rest is a
  deployment-time setting and the deployment target is undecided** (`README.md`
  § Deployment / § Security). `backup-rpo-rto.md` also wants an
  actually-tested restore drill (the `backup-drill.yml` workflow needs a
  `BACKUP_DRILL_ENCRYPTION_KEY` secret to even run).

### 5.6 `P1` — Payment-channel bank/card data is masked-only by design

- #38 stores `label` + `bankName` + `accountLast4` only — **no full IBAN /
  account number / SWIFT anywhere**. That was the right call for now
  (`sensitive-data-handling.md`: full bank/card data is Highly Confidential),
  but a real payment run needs the full number, which then needs field
  encryption + a "who can see it" access path.

### 5.7 `P2` — Demo/test data seeding relies on throwaway MFA

- There is no repo seed for business data; demo data is created by driving the
  running API over HTTP with a throwaway TOTP enrolment. Sample users have an
  `mfaEnabled`-with-no-credential state that trips up login (memory
  `project_demo_data_seeding`).
- **Fix:** a proper `db:seed:demo` script (idempotent, MFA-bypassed for a
  clearly-marked demo user set), or a documented "how to get a working session"
  runbook.

### 5.8 `P2` — No rate limiting / brute-force protection documented beyond account lockout

- `auth.e2e-spec.ts` covers account lockout after repeated failures. No
  IP-level throttling, no CAPTCHA, no anomaly-based lock on the login /
  password-reset / MFA-verify endpoints is described.

---

## 6. Architecture & tech debt

### 6.1 `P1` — Every reporting endpoint aggregates in memory — 2 of 4 DONE

**2026-09-09:** #33's `loadOutstandingReceivables` and #34's
`loadInsurerObligations` now aggregate in SQL (`GROUP BY` + `HAVING`), not in
JS. That was forced rather than chosen: once partial payments made
"outstanding" a cross-row SUM, a JS filter put `LIMIT` on the wrong side of it
and silently truncated the report. The remaining two (#30 loss-ratio
breakdown, #40 financial summary) are unchanged and still in-memory.

### 6.1 `P1` — Every reporting endpoint aggregates in memory

- #30 (loss-ratio breakdown), #33 (AR ageing), #34 (insurer payables), #40
  (financial summary) all `findMany` up to 5000 rows and group in JS. Fine at a
  small broker's book size; **silently partial** past the cap (no `truncated`
  flag), and it will not scale.
- **Fix:** move each to a SQL `GROUP BY` / materialised view; add the
  `truncated` flag in the meantime.

### 6.2 `P1` — No stored aggregate / reporting tables

- All reporting is on-the-fly. There is no nightly rollup, no
  snapshot-as-at-date table, so "point-in-time" is faked with `createdAt` /
  `receivedAt` filters (works for the current write-once fields; breaks the day
  any of them becomes mutable — e.g. an invoice amend / credit-note path).

### 6.3 `P1` — No architecture decisions recorded for call-direction / auth-boundary / system-of-record

- `ibms-brain` explicitly says only "web calls api" has been decided; "Do not
  invent one." Everything downstream (service boundaries, event bus, read
  models) is undecided. `IMPROVEMENTS` can't fix this — it needs a design doc in
  `ibms-brain/meta/designs/`.

### 6.4 `P2` — Prisma pinned at 6.19.3

- Node is on 20.19.0 (satisfies Prisma 7's floor) but Prisma stays 6.x. A
  Prisma 7 bump needs the driver-adapter (`@prisma/adapter-pg`) +
  `prisma.config.ts` migration first (`README.md` Prisma note).

### 6.5 `P2` — Perf indexes (Part B) are unshipped

- Deferred because there is no load test to justify them. Blocked on 6.1/6.2
  landing so there's something to measure.

### 6.6 `P2` — `rfq.service.ts:626` + `loss-ratio.service.ts:29` + `ClaimSection.tsx:345` carry `TODO`s

- `rfq.service.ts`: a follow-up-sweep optimisation "if real RFQ traffic
  arrives".
- `loss-ratio.service.ts`: the renewal module owns terminal-`RenewalCase`
  handling.
- `ClaimSection.tsx`: the recorded claim verdict should stay visible after the
  claim moves on (#28 UI polish).

### 6.7 `P2` — Everything is JOD-only

- `money.util.ts` is fils-precision JOD. `Remittance` has no currency column.
  The context document calls for **multi-currency support for reinsurance**.
  Cross-currency pooling in the reporting builders is currently a documented
  harmless no-op (single currency).

### 6.8 `P2` — Broker legal name is a placeholder

- Not supplied to `ibms-brain` or the app. Needs replacing throughout
  (documents, audit, notices) once known.

---

## 7. Frontend / UX gaps

### 7.1 `P1` — Part F (bilingual UI) is entirely unbuilt

- No instant language switch, no RTL layout for Arabic, no bidi handling for
  mixed-content fields, no Arabic-first input (keyboards, national-ID name
  conventions, Arabic sorting), no locale-aware number/date/currency formatting
  (Gregorian + optional Hijri), no bilingual system-generated documents
  (quotation comparison, recommendation report, policy schedule, invoices,
  certificates, complaint acknowledgements), no cross-language full-text search
  with transliteration fuzzy-matching.
- Every screen also needs the **four documented states** (loading / empty /
  error / populated) with a screenshot each before it counts as done (Part F
  last bullet) — current screens are functional but not audited for this.

### 7.2 `P2` — Part E (dashboards) is unbuilt

- The six dashboards (Sales, Policy, Claims, Financial, Compliance, Insurer &
  Employee Performance) don't exist. #40 built the Financial Dashboard's
  **backend** (`GET /financial-report/summary`); the other five have partial
  backends at best (#30 loss-ratio, #33/#34 accounting reads) and no UI.
- Every dashboard must be filterable by branch / line / insurer / time period
  and renderable in either language.

---

## 8. Not-yet-started backlog scope

Tracked in `README.md` § "Scope status" — listed here only so this file is a
complete picture. **Not** improvements to existing code; net-new build.

- ~~**Domain E — Customer Service (#41–46)**~~ — **complete**, moved out of
  this section. Its remaining deferred edges (the drafted SLA figures, the
  no-committee-auto-escalation gap, the renewal-module dependency, etc.) are
  tracked above (§3.6, §3.13, §4, §5.4) and in `README.md` § Known gaps, not
  here — this section is net-new build only.
- **Domain F — Compliance & Risk (#47–57):** AML/CFT (5.3), sanctions batch,
  regulatory calendar, incident management, internal audit, data-protection
  compliance (= Part D, 5.1).
- **Domain G — Management (#58–65):** KPI dashboard, executive reporting,
  insurer/employee performance scoring.
- **Domain H — Supporting Operations (#66–74):** HR, procurement, IT asset,
  document management, vendor management, BCP/DR, knowledge base.
- **Part D — PDPL / M-series** (5.1) — **begun**: M03 Consent Management
  landed 2026-09-04 (see §5.1 above); the other eight systems (DSR,
  retention & disposal execution, vendor risk, data sharing, incident &
  breach, DPIA, notices, RoPA) and the DPO Workspace are still net-new.
- **Part E — Dashboards** (7.2).
- **Part F — Bilingual UI** (7.1).
- **Part G — Final verification checklist** — the sign-off gate for "done".

## 9. Suggested order of attack (after the backlog build)

1. **CI isolation (1.1–1.4)** — until the e2e gate is reliable, nothing else's
   "done" is trustworthy.
2. **Commission single-source-of-truth (3.1)** — a live correctness bug users
   would see today.
3. **PDPL foundations (5.1)** + **real screening (5.2)** — the compliance
   exposures that make the system un-shippable.
4. **Partial payments + refund disbursement + client-funds statement
   (3.2–3.5)** — the finance cycle isn't real without them.
5. **Drafted values (§4)** — a review pass with the business to source or
   sign off each one.
6. **Reporting → SQL aggregation + `truncated` flags (6.1/3.10)**.
7. **Bilingual UI + dashboards (§7)** — the remaining Parts E/F.
8. Everything in §8 (net-new domains).

---

---

## 10. 2026-09-07 — full-codebase code-review audit (MINOR/NIT findings)

A `/review all the code` request dispatched 10 parallel `@code-reviewer` batches
across all 35 `apps/api/src/modules/*` plus the whole `apps/web` frontend. The
2 `BLOCKER` + 8 `MAJOR` findings were fixed immediately (not tracked here — see
`CLAUDE.md` § What's New for the full detail: the shared
`WorkflowTransitionService.transition()` non-atomic status+audit write, the JWT
secret's missing production fail-fast, three read-then-write races (Access
Recertification, password reset, Insurance Program reassembly), two dashboards
missing `isSensitiveDataAccess`, `PaymentChannel`'s missing bank-data input
guard, and a stale `consent-management.md` premise that had left the Claims
consent touchpoint unwired). These `MINOR`/`NIT` findings did not block and are
logged here instead, ordered by area:

### 10.1 `P2` — Stale doc comments citing a module as "not built yet"

- `workflow-transition.service.ts`'s own docstring said "No domain module calls
  this yet" — false, 30+ services call it. Already fixed as part of the
  BLOCKER work above (cheap, done inline).
- `sla-timer.service.ts:73-81` says "No domain module calls startTimer()/
  resolve() yet for 13 of the 14 registry entries... the one exception:
  AccessRecertificationService" — false, 12+ services call these already.
  The exact same "cites another module as not-built-yet, goes stale the day
  that module ships" pattern this file's own history has hit before (see
  §5.1's own note above). **Not fixed** — a one-line doc correction, worth
  doing next time this file is touched.
- `sla-timer.service.ts:51` and `ibms-brain/meta/context/business-day-
  calendar.md:54` both say "the 14-entry SLA registry" / "all 14 SLA
  types" — the real registry has 15 entries (`sla-registry.config.spec.ts`
  already gets this right). Harmless off-by-one, not fixed.
- `common/maker-checker.util.ts:22-37`'s "covered pairs" doc table omits
  `NeedsAssessment` and `DataSubjectRequest`, both of which ARE correctly
  enforced — the table itself just hasn't been kept in sync with every
  module that adopted the pattern. Not fixed.

### 10.2 `P2` — Missing `P2002`-to-409 mapping on two creates

- `ProspectRepository.create()` (`Prospect.leadId @unique`) and
  `CustomerRepository.create()` (`Customer.prospectId @unique`) don't catch
  Prisma `P2002`, unlike every comparable unique-constraint-backed create
  elsewhere (`rfq`, `quotation`, `disposal-batch`, `retention-schedule`,
  `endorsement`, `policy`). The underlying invariant IS enforced by the DB
  constraint — a genuine concurrent double-conversion surfaces as an
  unhandled 500 instead of a clean 409, not a data-integrity gap.

### 10.3 `P2` — Best-effort writes not wrapped in try/catch (inconsistent with sibling code)

- `ScreeningService.run()`'s per-`ScreeningType` audit call, and PDPL's
  `data-sharing-approval.service.ts`/`dpia-screening.service.ts`'s
  `startTimer()` calls, are NOT wrapped in the "log and continue" try/catch
  every sibling service in the same file/module uses for the identical
  call. `KycService` never lets a partially-failed `run()` reach `decide()`
  (no compliance bypass), and the PDPL SLA-timer gap means a transient
  timer-start failure surfaces as a 500 to a caller whose write actually
  committed, with no idempotency key to make a retry safe.

### 10.4 `P2` — Two more read-then-write race gaps, lower stakes than the fixed ones

- `commission.repository.ts`'s `recordEntryReversal` doesn't re-assert
  `reversedAmount` in its `updateMany` `where` — mitigated because `settle()`
  independently re-derives the true reversal state before any payout;
  exposure is a transiently-wrong ledger/report figure, not an overpayment.
- `insurer-performance.repository.ts`/`employee-performance.repository.ts`'s
  `upsertScore`/`upsertRecord` run a separate `findUnique` to derive the
  audit CREATE/UPDATE label, then a separate `upsert` — under genuine
  concurrency both could audit CREATE; the row itself stays correct (the
  real `@@unique` backs the upsert).

### 10.5 `P2` — Dashboard/reporting gaps found this pass

- `management-reporting/sales-dashboard.service.ts` applies no
  officer-level visibility scoping, unlike the sibling
  `sales-performance.service.ts` sharing the same `dashboard.sales.view`
  permission (which forces a non-manager caller to their own book) — a
  plain Sales Officer can see book-wide figures across every branch/officer.
- `claims-dashboard.repository.ts`'s `findOpenClaimsForAgeing` orders
  `createdAt asc` before capping at `CLAIMS_DASHBOARD_READ_LIMIT` — if open
  claims ever exceed the cap, truncation keeps the OLDEST rows and drops the
  newest, backwards from what an ageing reader would expect.

### 10.6 `P2` — Web frontend gaps found this pass

- `ConsentCaptureWidget.withdraw()` collapses the documented two-step
  withdrawal flow (request → confirm) into one atomic click at every
  touchpoint it's mounted on — the standalone `/consent` register page
  correctly offers both steps separately. Never late, but creates-then-
  instantly-resolves an `SlaTimer` row every time, adding noise.
- `lib/supporting-operations/employee-api.ts`'s `nationalId: string` has no
  comment noting it's a masked display value (unlike the equivalent
  `customer-api.ts` field) — not a live leak, a documentation gap that
  could mislead a future reader into treating it as raw.
- `employees/[id]/page.tsx`'s reveal-reason input's label states "min. 10
  characters" but the `<input>` has no `minLength={10}` to match — backend
  presumably still enforces it.
- The JOD-3-decimal `money()` formatter is hand-duplicated verbatim across
  `financial-report`, `client-accounting`, `insurer-accounting` pages and
  `ClaimSection.tsx` — an extraction candidate (`lib/finance/format.ts`),
  matching this codebase's own pattern of promoting shared constants out of
  per-page files.
- `vendors/[id]/page.tsx`'s DPA "Sign"/"DPO approve" buttons have no
  client-side role gate, unlike every sibling maker/checker screen in this
  app (backend is the real authority either way).
- `retention-disposal/page.tsx`'s Legal Hold form allows both Customer ID
  and Insured person ID to be filled at once with no client-side "at most
  one" guard, even though the backend 422s on that combination — an
  avoidable round trip.

Full findings, including everything already fixed, are in the 10 code-review
transcripts this session ran; this section only carries what wasn't fixed
inline. The web-frontend batch explicitly sampled ~45 of ~90 pages rather
than reading every one (its own coverage note lists exactly which) — treat
this section as a partial pass, not an exhaustive one.

