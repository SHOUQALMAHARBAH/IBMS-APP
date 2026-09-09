# IMPROVEMENTS.md

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
  starts empty and every real-list check returns CLEAR until the first sync.
  The 12-hourly `WatchlistSyncScheduler` and `POST /watchlist-sync/run` both
  exist; someone has to run one.
- The transliteration table covers ~50 common Jordanian/Arab **given** names
  and deliberately excludes family-name components. Family names across
  scripts still will not match.

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

