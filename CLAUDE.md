@ibms-brain/CLAUDE.md

<!-- The import above pulls in ibms-brain's full rule set (meta/lex/, meta/context/,
     meta/designs/) via the ibms-brain/ git submodule. If that directory is empty, run
     `git submodule update --init --recursive` — see "Cloning this repo" below. Keep
     the import on line 1, same reason ibms-brain's own CLAUDE.md keeps @AGENTS.md on
     line 1: without it this content is dead weight while still read by other tools. -->

# CLAUDE.md — ibms-app

This is the first IBMS engineering repo. **Standards, mandatory rules, domain
knowledge, and architecture decisions live in `ibms-brain` (imported above via git
submodule at `ibms-brain/`), not here** — `ibms-brain/meta/lex/` (mandatory),
`ibms-brain/meta/context/` (domain knowledge), `ibms-brain/meta/designs/` (why decisions
were made). Read the relevant `meta/context/` file before touching an area, and the
`meta/lex/` rules before any non-trivial change — most of them (money-decimal-jod,
workflow-state-transitions, maker-checker-segregation, sensitive-data-handling,
pdpl-sla-timers) apply the moment real domain code lands here, which it has not yet.

## What's New

| Date | Change | Action required |
|------|--------|-----------------|
| 2026-09-11 | Part C #60 (Insurer Performance) landed — "`InsurerPerformanceScore`: a periodic job computing the score from quote-response speed/claims service/price/service quality." Unlike #58/#59, `InsurerPerformanceScore` AND `InsurerSlaAgreement` already existed in the core schema — this process is their first real consumer for either. Four dimensions mapped to existing signals: quote-response speed = average `RFQInsurer.sentAt`→`respondedAt` days (only ever stamped on QUOTED/DECLINED) scored against `InsurerSlaAgreement` (`slaType: 'quote_response'`) if one exists, else the same 9-day default `RFQ.followUpThresholdDays` already uses; claims service = proportion of claims notified in the period with no `ClaimFollowUpAlert` ever raised; price = this insurer's premium vs. the field average of every other insurer's current quote on the same RFQ, kept in `Prisma.Decimal` via `money.util.ts` throughout since `Quotation.premium` is a money-decimal field; service quality = the average of `ComparisonMatrixRow.serviceScore`, an EXISTING optional subjective field whose own doc comment says "there is no Insurer-scoring module yet" — this process is exactly that module. Any dimension with no computable data for the period defaults to a uniform `NEUTRAL_SCORE = 50.00` (never 0 or 100, which would misread absence of evidence as a verdict). **A real redesign happened mid-build**: the first draft's `POST /insurer-performance/compute` recomputed every insurer with no `insurerId` — this timed out a 30s e2e test against `db-test`'s 2,726 accumulated `Insurer` rows (real Postgres connection-pool pressure, not a flaky assertion). Fixed by making `insurerId` mandatory on the manual trigger (the `up-sell-recommendations/detect` shape — no "detect for everyone" HTTP route exists there either), and by switching the scheduler's own all-insurers batch from a sequential loop to bounded-concurrency chunks (`Promise.allSettled`, 20 at a time — the #56 lesson taken further: unbounded parallelism over a large book would make pool pressure worse, not better). `@@unique([insurerId, periodLabel])` (migration `20260911120000`, a plain composite unique — no `SalesTarget`-style NULL gotcha, both columns always non-null) makes a recompute upsert rather than duplicate. **No new permission** — `insurer-performance.view` (pre-seeded) gates both the read and the manual trigger, the `internal-controls.audit` "Run audit now" precedent; the first Domain G process needing zero seed change. Monthly cadence (06:00 UTC on the 1st) — the first non-daily scheduler in this codebase. `apps/web/` gains an **"Insurer performance"** screen (lookup + history table + a compute-now form). **Verification**: +31 api unit (`insurer-performance.config.spec.ts` 16, `insurer-performance.service.spec.ts` 15) → api unit **1911** (139 files, from 1880). New `test/insurer-performance.e2e-spec.ts` **4/4** (permission gating; a partial-period 422; the default-previous-month resolution; a real RFQ/RFQInsurer/Quotation×2/ComparisonMatrixRow/Policy/Claim fixture chain proving all four scores compute correctly plus a zero-activity insurer defaulting to neutral 50, in the same period; a same-period recompute upserting instead of duplicating). Full api unit suite 1911/1911 confirmed green; full api e2e suite (40 files) green, including both chronic flakes (`rbac`, `up-sell`) and one confirmed-transient TOTP-timing flake in `complaint.e2e-spec.ts` (unrelated). New Playwright `insurer-performance.spec.ts` 4/4; full Playwright suite 156/156 (from 153). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (migration `20260911120000`; 49 migrations). No seed change — `insurer-performance.view` was already pre-seeded. |
| 2026-09-10 | Part C #59 (Sales Performance) landed — "a query per employee/team against target." The backlog names no model and no target metric. New model `SalesTarget` (migration `20260910120000`, a genuine new migration — unlike #60/#61's `InsurerPerformanceScore`/`EmployeePerformanceRecord`, both already pre-existing core schema, #59 had none). Target metric picked: `targetNewProspects` — new `Prospect` rows (a `Lead` qualified, Process 1→2) attributable to `Lead.ownerUserId`/`Prospect.salesOwnerUserId`, or to every user in one `Branch`, in `[periodStart, periodEnd)`. **Deliberately NOT premium/commission-based** — `Policy.placedByUserId`/`Opportunity.createdByUserId` name the PLACEMENT officer, not the sourcing Sales Officer, and `Customer.prospectId` is optional (a Customer can be onboarded with no Prospect at all), so there is no reliable way to attribute bound premium back to a Sales Officer without guessing; that dimension stays at `EmployeePerformanceRecord.premiumWritten` (#61, not built here). `ownerUserId`/`branchId` are bare scalars (no relations, the `Opportunity.createdByUserId` shape) — exactly one is set, checked at three layers: a pure `isExactlyOneScope()` validator, a hand-authored DB `CHECK` (`SalesTarget_owner_xor_branch`), and re-derived again on the read side's own scope resolution. **The #48 AML NULL-uniqueness gotcha resurfaced** — "at most one target per owner per period" / "...per branch per period" are TWO hand-authored partial unique indexes, not one composite `@@unique`, since Postgres treats every NULL as distinct in a plain composite unique and a composite key would never collide on the column that's always NULL for that row's scope. `GET /sales-performance` (`dashboard.sales.view`, pre-seeded) forces a Sales/Relationship Officer to their own `ownerUserId` and 403s a branch request outright (reusing `common/rbac-visibility.util.ts`'s existing `VIEW_ALL_OWNERS_ROLES`); Manager/Executive must supply exactly one of `ownerUserId`/`branchId` (422 on both/neither). No target found for "now" returns `target: null` (a valid, expected state), while an explicit unmatched `periodLabel` 404s. New permission `sales-target.manage` (`[BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`, 150 → 151 perms) — the one genuinely new Domain G permission this process needed. `apps/web/` gains a **"Sales performance"** screen (an officer's own stat cards with no scope picker; a Manager gets a lookup form plus a set/revise-target form). **Verification**: +24 api unit (`sales-performance.config.spec.ts` 9, `sales-performance.service.spec.ts` 15) → api unit **1880** (137 files, from 1856). New `test/sales-performance.e2e-spec.ts` **7/7** (permission gating; exactly-one-scope 422 on create and read; a 409 duplicate-target + PATCH-revise round trip; Sales-Officer-forced-to-self / branch-view-forbidden visibility; a null-target response + an explicit-`periodLabel` 404; a REAL Lead→Prospect walk moving a brand-new officer's `newProspects` from 0 to 1; a branch-scoped target resolving to two officers' combined actuals). Full api unit suite 1880/1880 confirmed green; full api e2e suite (39 files) green, both chronic flakes (`rbac`, `up-sell`) passing cleanly. New Playwright `sales-performance.spec.ts` 4/4; full Playwright suite 153/153 (from 150). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (migration `20260910120000`; 48 migrations). Seed change — `npm run db:seed` (new `sales-target.manage` permission; already applied to dev and test DBs during this build). |
| 2026-09-09 | Part C #58 (General KPI dashboard) landed — **opens Domain G, Management (#58-65).** The backlog line names no model and no metric list: "aggregate queries across every module above." Deliberately scoped to a curated, low-risk set rather than an exhaustive KPI catalogue — one plain `count` or `groupBy`-count per already-built domain (Sales/CRM: total customers + leads/prospects/opportunities by status; Policy: policies by status + total issued premium; Claims: claims by status; Customer Service: complaints by status + open service requests; Compliance & Risk: open risk-register items/incidents/internal-audit findings), plus two unambiguous money sums for Finance (outstanding invoiced — the SAME "outstanding" definition #33's AR ageing report already uses; commission this month, a plain gross figure, no netting). **Deliberately NOT attempted**: "outstanding payables owed to insurers" — #34's definition nets out the broker's own commission deduction, and reproducing that here risked a second, driftable copy of business logic; the precise figure stays at #34/#40. **Reads every table DIRECTLY — zero cross-module service dependency** — even though `FinancialReportService` (#40) already composes almost this exact finance summary, no prior cross-cutting reporting module in this codebase (`SlaDashboardModule` #43, `InternalControlsModule` #56, `AuditTrailModule` #57) calls into another domain's SERVICE for a number, and this process kept that consistency rather than widening two unrelated modules' `exports` arrays. New `KpiDashboardRepository`'s every method is a genuine DB-side `count`/`groupBy`/`aggregate` call, never a loaded-then-reduced `findMany` — so unlike every prior dashboard here, there is NO read-limit/truncation-warning concept at all. **The #56 concurrency lesson (fire independent queries via `Promise.all`) was applied from the FIRST draft, not rediscovered via a timing failure** — all fifteen queries run concurrently. New permission `kpi-dashboard.view` (`[BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`, 149 → 150 perms) — genuinely new, unlike every OTHER Domain G permission (`dashboard.sales.view`, `dashboard.policy.view`, `dashboard.claims.view`, `dashboard.financial.view`, `dashboard.compliance.view`, `insurer-performance.view`, `employee-performance.view`, `dashboard.executive.view`, `portfolio-analysis.view`, `profitability-analysis.view`, `planning-export.generate`), ALL pre-seeded ahead of time for #59-65. `EXTERNAL_AUDITOR` deliberately excluded — the #57 lesson: their scope is logs/documents/workflow history, not live business-KPI content. `apps/web/` gains a **"KPI dashboard"** screen (six sections, stat cards + status-breakdown tables). **Verification**: +10 api unit (`kpi-dashboard.config.spec.ts` 6, `kpi-dashboard.service.spec.ts` 4) → api unit **1856** (133 files, from 1846). New `test/kpi-dashboard.e2e-spec.ts` **2/2** — permission gating + full response-shape assertions; a before/after DELTA test (never a global count, `db-test` is cumulative) proving a fresh `Lead` and a fresh `RiskRegisterItem` each move their own bucket by exactly 1. New Playwright `kpi-dashboard.spec.ts` 3/3. `npm run typecheck`/`lint`/`build` (api + web) OK. | Seed change — `npm run db:seed` (new `kpi-dashboard.view` permission; already applied to dev and test DBs during this build). No migration. |
| 2026-09-08 | Part C #57 (Internal Audit) landed — **closes Domain F, #47–57 all built or verified-covered.** Two checkboxes, built as two separate modules: "Record audit findings, remediation path, and closure" (`InternalAuditFindingService` — `InternalAuditFinding` is the exact bare `RiskRegisterItem` register shape one model up in the schema, no maker/checker columns at all, so `internal-audit.record` [Compliance] / `internal-audit.close` [Compliance, Manager] are two DISTINCT permissions on two different actions, the #48 `aml.monitor`/`aml.escalate` shape — not a maker/checker pair) and "Time-boxed read-only access for the External Auditor role across all records, documents, and workflow history" (**new module** `apps/api/src/modules/audit-trail/`, a cross-cutting reader over `AuditLogEntry` + `Document`). **Genuinely no migration, no seed change for EITHER checkbox** — `InternalAuditFinding` and all FIVE consumed permissions (`internal-audit.record`, `internal-audit.close`, `audit-log.read`, `document-history.read`, `workflow-history.read`) were pre-seeded ahead of time with zero prior application code ever calling them. **"All records" resolved narrower than it first reads**: `ibms-brain/meta/context/roles-and-segregation-of-duties.md`'s own Part 5.1 role table names the scope as "logs, documents and workflow history," not blanket business-table access — confirmed by the seed itself, which never provisioned a generic `customer.read`/`policy.read`/`claim.read` for External Auditor. `AuditLogEntry`'s own polymorphism across every entity type in the schema is what satisfies "all records" — an auditor filters the SAME table down to whichever record they're reviewing, never gaining live read access to the business table itself. **"Time-boxed" needed nothing new** — `User.accessValidUntil` + `SessionService.validate` (already tested by the Auth e2e's own "External Auditor time-boxed access (Part 5.1)" suite) pre-existed this process entirely. Three endpoints on a new `AuditTrailController`: `GET /audit-trail` (general browse — Compliance/Admin/Auditor), `GET /audit-trail/workflow-history?entityType=&entityId=` (the `TRANSITION`-action rows for one record — Compliance/Auditor only, no Admin), `GET /audit-trail/documents/:id/history` (the `Document` version chain — `previousVersionId`/`nextVersion`, a doubly-linked list, dormant today since no writer creates a second version yet, walked anyway per the #48/#56 forward-compatible precedent — Compliance/Auditor only, no Admin). Every read writes a best-effort `READ` audit row, unconditionally `isSensitiveDataAccess: true`. `apps/web/` gains two new screens: **"Internal audit findings"** and **"Audit trail"** (browse / workflow-history / document-history lookups). **Verification**: +26 api unit (`internal-audit-finding.config.spec.ts` 4, `internal-audit-finding.service.spec.ts` 11, `audit-trail.config.spec.ts` 5, `audit-trail.service.spec.ts` 6) → api unit **1846** (131 files, from 1820). New `test/internal-audit.e2e-spec.ts` **2/2** — the finding CRUD's per-action permission split proven end-to-end (a Manager can close but not record/remediate); the External Auditor's three reads proven against a REAL `Lead` TRANSITION (`POST /leads` + `POST /leads/:id/transition`) and a REAL `Document` + matching `AuditLogEntry` seeded directly via Prisma, confirming Admin gets 403 on document/workflow history but 200 on the general browse. New Playwright `internal-audit-findings.spec.ts` 4/4 + `audit-trail.spec.ts` 3/3. `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — every model and permission this process reads/writes was already pre-provisioned. |
| 2026-09-07 | Part C #56 (Internal Controls — Maker/Checker) landed — a one-liner backlog item, not a checkbox list: "fully covered in Part A.5, plus a periodic audit report scanning for any possible self-approval cases." Part A.5 (`assertDifferentActors` + a DB `CHECK` per pair) was verified intact — the only new work is the report. **New module** `apps/api/src/modules/internal-controls/` (`internal-controls.{config,service,controller}.ts` + `internal-controls-audit.scheduler.ts`), the `SlaDashboardModule` shape (aggregates other modules' data, owns none of it). **`MAKER_CHECKER_REGISTRY`** is a hand-built inventory of all 15 same-table maker/checker pairs this codebase has a DB `CHECK` constraint for (traced across five migrations, `20260826091424` through `20260906120000`), including three flagged `dormant: true` (`DisposalBatch`/`DataSharingApproval`/`DataProcessingAgreement` — M06/M07/M08 aren't built, no writer exists yet, the #48 dormant-classifier precedent). **A 16th pair is handled separately**: `PolicyChecking.checkedByUserId` vs the PARENT `Policy.issuedByUserId` — this build resolved an open question `ibms-brain/meta/context/policy-lifecycle.md` had flagged (should the DB CHECK extend to `issuedByUserId`?): it structurally CANNOT — a Postgres `CHECK` constraint compares columns on one row of one table, and these two columns live on different tables. This periodic scan is that one pair's ONLY defense-in-depth backstop beyond the app-level `assertDifferentActors` guard, by design. **A genuine perf fix found mid-build, not a review comment**: the scan's 16 independent read queries were originally sequential, timing out a 30-second e2e test against this session's own long-lived, cumulative `db-test` database; switched to `Promise.all`, cutting the scan to under 12 seconds. New permission `internal-controls.audit` (`[COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`, 148 → 149 perms) — genuinely new, not pre-seeded ahead of time the way #55's four were. **A clean run (zero violations) is the EXPECTED outcome** — every same-table pair is already DB-enforced, so the e2e proof of genuine detection had to target the one pair with no DB backstop (planted directly via Prisma, bypassing `assertDifferentActors` entirely, then restored before finishing — the #51 restore-before-finishing precedent scaled to one row); every same-table pair's classification logic is proven via pure-function unit tests instead. `apps/web/` gains an **"Internal controls"** screen. **A `react-hooks/set-state-in-effect` ESLint false positive was hit and worked around** — `void load()` directly in a mount effect was flagged even though `load`'s only `setState` calls happen after an `await`; fixed by matching `apps/web/app/(app)/incidents/page.tsx`'s existing `void (async () => { await load(); })();` pattern instead of `void load();`. **Verification**: +21 api unit (`internal-controls.config.spec.ts` 15, `internal-controls.service.spec.ts` 6) → api unit **1820** (127 files, from 1799). New `test/internal-controls.e2e-spec.ts` **2/2** (permission gating + full 16-pair report shape; a live-planted cross-table violation detected end-to-end). Full api unit suite 1820/1820 confirmed green. New Playwright `internal-controls.spec.ts` 4/4. `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration (a pure read over existing tables). Seed change — `npm run db:seed` (new `internal-controls.audit` permission; already applied to dev and test DBs during this build). |

Drop the oldest row once this table exceeds 5 entries (ibms-brain/meta/lex/workspace-updates.md).

## Cloning this repo

```bash
git clone --recurse-submodules https://github.com/SHOUQALMAHARBAH/IBMS-APP.git
# already cloned without it?
git submodule update --init --recursive
```

The submodule pins a specific `ibms-brain` commit — it does not auto-track `main`. Pull
in newer brain rules deliberately:

```bash
cd ibms-brain && git pull origin main && cd ..
git add ibms-brain && git commit -m "ibms-brain: sync to latest"
```

## What's here today

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–10** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6), Product
Recommendation / Program Design (#7), Cross-Selling (#8, a no-op until the Policy module
lands), Up-Selling (#9, flags a survey that outgrew the designed property Sum Insured),
Relationship Management / CRM (#10, logs every touchpoint as an `Interaction` and serves
the aggregated 360° customer timeline — policies/claims/complaints empty until Domains
B/C/E land). **Domain A is complete.** Part C **Domain B** has begun with RFQ / Market
Submission (#11) — a minimal `Opportunity` parent (created from a FINALIZED Insurance
Program) plus `RFQ`/`RFQInsurer` (one RFQ per line, insurer shortlist, per-insurer
response tracking, a nightly business-day follow-up alert sweep). Everything else —
Domain B #12–22, Domains C–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
verification) — is not started. See root `README.md` § Scope status for the full picture
and § Known gaps for each built item's deferred edges.

## Common commands

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate:dev
npm run db:seed       # 11 roles + full permission grid — RBAC needs these to exist
npm run dev          # web:3000, api:4000
npm run lint
npm run typecheck
npm run test          # vitest, web + api

# api e2e — separate test DB (db-test), never the dev DB above. See README
# § Dev DB vs. test DB.
cp .env.test.example .env.test
docker compose up -d db-test
npm run db:test:migrate:dev
npm run test:e2e

npm run e2e           # playwright + axe-core, web
```

## Environment

- Node `20.19.0` — see `.nvmrc`. This satisfies Prisma 7's Node floor (≥20.19/22.12/24)
  but Prisma itself stays pinned at `6.19.3` in `package.json` — Node version no longer
  blocks a Prisma 7 install, so don't bump `prisma`/`@prisma/client` past 6.x without
  doing the driver-adapter (`@prisma/adapter-pg`) + `prisma.config.ts` migration first.
  See the Prisma note in root `README.md`.
- Docker required for Postgres locally and for building `apps/api`/`apps/web` images.

## Repo map

```
apps/web/     Next.js frontend
apps/api/     NestJS backend
packages/db/  Shared Prisma schema + client (@ibms/db)
ibms-brain/   Submodule — standards/rules/context (loaded via the import above)
.claude/      Agents/commands mirrored from ibms-brain + a subset of its hooks — see
              README.md § .claude/ — agents, commands, hooks
```

`@code-reviewer` and `@software-developer` (defined in `ibms-brain/meta/agents/`) and
`/brain-gap` are available in this repo via `.claude/`. Not yet wired here: the `git push`
evidence-gate hook (`enforce-evidence.sh`) and the domain-code hooks — see README.md for why.

## Before you write code

Same rule as ibms-brain: read `meta/context/` for the area, `meta/lex/` for what's
mandatory, cite the source document (PDPL / CBJ / ISO 27001/27701 / a specific
`PRIV-STD-*`/`PRIV-SOP-*`) in the PR when the change touches a regulatory obligation.
