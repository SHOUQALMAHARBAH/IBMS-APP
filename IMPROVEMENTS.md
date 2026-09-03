# IMPROVEMENTS.md

Consolidated backlog of **things to fix** — bugs, CI/test failures, missing
wiring, unsourced values, security & compliance gaps, and tech debt — gathered
while building Part C (Domains A–D). This is the **cross-cutting action list**;
the per-backlog-item deferred edges live in `README.md` § "Known gaps (per
completed backlog item)" and are not repeated here except where they compound
into a system-wide problem.

**Status:** first compiled at parent `17e52b4` / `ibms-brain` `ed9ad56` (Domain
D complete); topped up through Part C #42 (Domain E — #41 Customer Requests +
#42 Complaints Management built). Nothing below has been actioned — this file is
the plan for the "solve every gap / threat / bug" pass the user asked for
**after** the backlog build is finished.

**Priority key:** `P0` blocks correctness, security, or a real "definition of
done" · `P1` must be fixed before the system goes near production · `P2` tech
debt / quality-of-life.

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

### 3.2 `P1` — Refund lifecycle is incomplete

- `refund.raise` permission is **seeded but wired to no endpoint** — there is no
  standalone / overpayment / goodwill refund-raise path; a `Refund` is only ever
  auto-minted by a negative/cancellation `Endorsement` (#22).
- `Refund.paidAt` is **never written** — there is no disbursement step (the
  approve step just flips status; money never "goes out").
- No **write-off** path (`money-decimal-jod.md` mentions write-offs; nothing
  implements one).
- **Fix:** `POST /refunds` (standalone raise, `refund.raise`), a
  `POST /refunds/:id/disburse` that stamps `paidAt` + books the client-funds
  ledger `out` movement, and a maker/checker write-off endpoint.

### 3.3 `P1` — `PremiumTransaction` model is never written

- The schema's generic premium-ledger model exists but no code touches it. #31
  fills `Invoice.premiumAmount` directly; #32 books `ClientFundsLedgerEntry`
  in/out.
- **Fix:** either populate `PremiumTransaction` from the #31/#32/#35/#36 flows,
  or delete the model if `Invoice` + `ClientFundsLedgerEntry` +
  `CommissionLedgerEntry` are the real ledger.

### 3.4 `P1` — No partial payments anywhere in the finance cycle

- #32 records **exactly one** `Receipt` per invoice for the **full**
  `totalAmount` (a variance is a 422). #34/#33/#40 all assume "a receipt means
  paid in full". A real broker takes instalments.
- **Fix:** relax `Receipt.invoiceId @unique` to allow multiple partial receipts
  summing to the total; update the ageing/payables/summary readers to sum
  receipts instead of testing for existence; add an over-payment → `Refund`
  bridge.

### 3.5 `P1` — `ClientFundsLedgerEntry` has no balance / reconciliation surface

- Append-only movement log; no running-balance query, no per-client funds
  statement, no "client money held vs. owed" reconciliation report (a CBJ Part
  7.3 expectation).
- **Fix:** `GET /client-funds/:customerId/statement` (running balance) and a
  book-wide "held vs. owed to insurers" reconciliation view.

### 3.6 `P1` — `LossRatio` recompute is a logged no-op

- `LossRatioModule` upserts a `LossRatio` per `RenewalCase`, but every call is a
  **logged no-op** because the renewal module (`RenewalCase` producer) is not
  built. #30 Claims Analytics computes loss ratio on the fly instead.
- Also: the loss-ratio "period" is **all-time / paid-only** — no earned-premium
  proration, no incurred (open-claim reserve) ratio.
- **Fix:** build the renewal module, then wire the recompute; add an incurred
  ratio option once claim reserves exist.

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

---

## 5. Security & compliance threats / gaps

### 5.1 `P0` — Part D (PDPL / M-series) is entirely unbuilt

- No `ConsentRecord` capture/withdrawal at the 7 touchpoints; no
  `DataSubjectRequest` handling; no retention & disposal
  (`RetentionScheduleItem` / `LegalHold` / `DisposalBatch` /
  `CertificateOfDestruction`); no cross-border transfer gating; no
  `DataSharingApproval`; no DPIA screening; no version-controlled bilingual
  privacy notices; no RoPA register; no DPO workspace.
- The **A.8 SLA registry already carries the PDPL timer definitions** (consent
  withdrawal, DSR, breach containment, disposal) but **nothing consumes them** —
  `pdpl-sla-timers.md` says every statutory SLA must be a tracked deadline with
  escalation, not documentation.
- **Impact:** the system stores national IDs (encrypted), UBO data, medical
  reports (claims), and financial data with **no lawful-basis tracking, no
  erasure path, no retention enforcement**. This is the single biggest
  compliance exposure.

### 5.2 `P0` — Screening is simulated

- Customer onboarding (#3–4) does **simulated** sanctions/PEP screening. No real
  watchlist provider is integrated. `ScreeningResult` is populated with fake
  outcomes.
- **Fix:** integrate a real screening provider (or a maintained local list),
  with a match-review queue and a maker/checker clear/escalate path.

### 5.3 `P1` — No AML/CFT transaction monitoring (#48)

- No unusual-pattern detection (large premium payments, frequent
  cancellations/refunds, third-party payment sources), no
  `TransactionMonitoringAlert`, no suspicious-activity escalation to the
  competent authority, no regulator-mandated record retention.
- The data to detect these already exists (`Receipt` / `Refund` /
  `Endorsement` / `PaymentChannel.ownerType`) — it's a rules engine + an alert
  workflow that's missing.

### 5.4 `P1` — No consent check before marketing sends (#44)

- #44 requires respecting the customer's recorded channel + language and
  checking `ConsentRecord` **before any marketing send**. `CommunicationLog`
  records sends; nothing gates them on consent (and `ConsentRecord` doesn't
  exist yet — see 5.1).

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

- **Domain E — Customer Service (#43–46):** #41 (`ServiceRequest`) and #42
  (`Complaint` + supervisor sign-off + Insurance Dispute Resolution Committee
  escalation) are built. Remaining: the cross-module SLA monitoring dashboard
  (#43), `CommunicationLog` consent-gated sends (#44), `CustomerFeedback` (#45),
  `RetentionCase` auto-open on lapse risk (#46). #42 gaps: one 10-day
  complaint-resolution SLA for all categories (drafted / unsourced); no
  automatic escalation sweep to the dispute-resolution committee (the nightly
  sweep only escalates the timer to the internal manager); no complaint →
  acknowledgement / final-response `Document` link; escalation does not restart
  the SLA on a return-to-handling; no re-open of a closed complaint.
- **Domain F — Compliance & Risk (#47–57):** AML/CFT (5.3), sanctions batch,
  regulatory calendar, incident management, internal audit, data-protection
  compliance (= Part D, 5.1).
- **Domain G — Management (#58–65):** KPI dashboard, executive reporting,
  insurer/employee performance scoring.
- **Domain H — Supporting Operations (#66–74):** HR, procurement, IT asset,
  document management, vendor management, BCP/DR, knowledge base.
- **Part D — PDPL / M-series** (5.1).
- **Part E — Dashboards** (7.2).
- **Part F — Bilingual UI** (7.1).
- **Part G — Final verification checklist** — the sign-off gate for "done".

---

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
