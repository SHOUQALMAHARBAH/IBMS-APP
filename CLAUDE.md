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
| 2026-09-14 | Part C #63 (Profitability Analysis) landed — "commission income vs. cost-to-serve per segment/line." Like #62, no new model/migration/scheduler — but unlike #62, this REUSES the same written-policy data #40's `FinancialReportService` already loads, reduced into a genuinely different metric. **Why this isn't a duplicate of #40's `netPosition`**: #40's `netPosition = premiumWritten − claimsPaid − commissionEarned` is an underwriting-result view of the INSURER's side of the book; #63 asks whether the commission the BROKER earns is enough to cover what it costs the broker to service the book — `netProfitability = commissionIncome − costToServe`, reducing the identical raw data differently. `commissionIncomeJod` = Σ(`commissionAmount − commissionReversedAmount`) per group, the SAME net-of-clawback calc #40 uses (not #58/#61's gross simplification). `costToServeJod` = Σ net settlement of SETTLED/CLOSED claims — **a documented scoped interpretation, not a true operational cost**: no expense/staff-time/overhead model exists anywhere in this schema (Domain H/#66 HR isn't built), so claims-settlement payout stands in as the closest available cost signal, reusing (not duplicating) the SAME `claimsPaid` figure #40 already computes. Grouped by `insuranceLine`/`customerType` ONLY (no insurer/geography, unlike #62's four); worst-first sort, the #40 convention. **A new kind of promotion**: `ProfitabilityPolicyRow` + its loader were extracted OUT of `FinancialReportRepository` (#40) into a standalone `repositories/profitability-policy.repository.ts` — `finance.config.ts` re-exports the type so existing imports keep working. **Module wiring stayed zero-coupling**: the same repository class is provided independently in BOTH `FinanceModule`'s and the new `ProfitabilityAnalysisModule`'s own `providers` arrays — no `imports`/`exports` wiring between them. **Permission is a real deviation from #58-62**: `profitability-analysis.view` (pre-seeded) grants `[EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER]` — NOT `BRANCH_DEPARTMENT_MANAGER`; zero seed change, the #60/#62 "no new permission" precedent a third time. A best-effort READ audit flags `isSensitiveDataAccess` whenever a settled claim contributed, the #40 rule. `apps/web/` gains a **"Profitability analysis"** screen (two breakdown tables). **Verification**: +13 api unit (`profitability-analysis.config.spec.ts` 8, `profitability-analysis.service.spec.ts` 5) → api unit **1966** (144 files, from 1953); the #40 extraction re-verified transparent (55/55 unchanged, re-confirmed after `eslint --fix`). New `test/profitability-analysis.e2e-spec.ts` **3/3** — permission gating; an explicit Branch/Department Manager FORBIDDEN assertion (documenting the role-scope deviation); a real fixture (unique line + a SETTLED Claim/Settlement + a CommissionLedgerEntry) proving all three money figures, plus a before/after delta on `bySegment`. Full api unit suite 1966/1966 confirmed green; full 43-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`, including #40's own e2e coverage re-confirmed green post-extraction. New Playwright `profitability-analysis.spec.ts` 3/3; full Playwright suite 207/207. `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `profitability-analysis.view` was already pre-seeded. |
| 2026-09-13 | Part C #62 (Portfolio Analysis) landed — "a query by line/insurer/client segment/geography." Unlike #59-61 (each introducing or consuming a dedicated periodic-snapshot model), #62 has **no model of its own at all** — a pure, on-demand, current-state read over `Policy` and its joined tables. No migration, no scheduler, no new permission — the lightest Domain G process built so far. Each dimension mapped to the cleanest existing field: line = `Policy.insuranceLine`; insurer = `Policy.insurerId` resolved to `Insurer.name`; client segment = `Customer.customerType` (`CORPORATE`/`INDIVIDUAL`); geography = `Branch.name` via the customer-owning Sales Officer's `Customer.ownerUserId -> User.branchId -> Branch.name` — the only structured, low-cardinality location-like field anywhere in this schema (`Customer.registeredAddress` is free text, unusable for a clean group-by; this is the broker's OWN operational geography, not the customer's address). All four scope to `issuedPremium IS NOT NULL`, the same inclusion rule `kpi-dashboard.md`'s `totalIssuedPremiumJod` already uses. **`insuranceLine`/`insurerId` live directly on `Policy`, so `byLine`/`byInsurer` are genuine DB-side `groupBy` calls (the #58 shape, no read-limit needed)** — but `Customer.customerType` and the resolved branch name both require crossing a relation Prisma's `groupBy` cannot cross, so `byClientSegment`/`byGeography` are instead a capped `findMany` (`PORTFOLIO_ANALYSIS_READ_LIMIT=5000`) reduced in pure JS — the `SlaDashboardRepository`/`InternalControlsService` shape; an owner with no `branchId` resolves to an explicit `UNASSIGNED_GEOGRAPHY_LABEL` ('Unassigned'), never dropped. The three top-level queries fire via `Promise.all` — the #56 concurrency lesson applied from the FIRST draft. **A shared utility was promoted, not duplicated, for the SECOND consecutive process**: `formatMoneySum` moved from `kpi-dashboard.config.ts` to `common/money.util.ts`, re-exported so existing imports keep working (the same promotion #61 did for `previousUtcMonthRange`/`PeriodWindow` into `common/period.util.ts` one process earlier). No new permission — `portfolio-analysis.view` (pre-seeded) gates the single `GET /portfolio-analysis` route, the #60 "zero seed change" precedent repeated. A best-effort `READ` audit row never fails the read itself if the write fails. `apps/web/` gains a **"Portfolio analysis"** screen (four breakdown tables, largest-premium-first). **Verification**: +14 api unit (`money.util.spec.ts` +2, `portfolio-analysis.config.spec.ts` 9, `portfolio-analysis.service.spec.ts` 5) → api unit **1953** (142 files, from 1937). New `test/portfolio-analysis.e2e-spec.ts` **2/2** — permission gating; a REAL fixture chain using uniquely-named Insurer/Branch/insuranceLine values for exact `byLine`/`byInsurer`/`byGeography` assertions, plus a before/after DELTA assertion on `byClientSegment` (a shared closed-set bucket, the #58 delta-testing precedent). Full api unit suite 1953/1953 confirmed green; full 42-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) re-confirmed passing with `--testTimeout=90000`. New Playwright `portfolio-analysis.spec.ts` 3/3; full Playwright suite 161/161 (from 159). `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `portfolio-analysis.view` was already pre-seeded. |
| 2026-09-12 | Part C #61 (Employee Performance) landed — "`EmployeePerformanceRecord`: a periodic job: new clients/premium/commission/renewal rate/cross-sell rate." Like #60, the model already existed in the core schema — this process is its first real consumer, alongside two other dormant pieces: `Employee` itself (Domain H/#66 HR is not built) and `User.employeeId` (no writer sets it either). Every business signal needed (`Lead.ownerUserId`, `Prospect.salesOwnerUserId`, `Policy.placedByUserId`, `Customer.ownerUserId`) is keyed by `User.id`, not `Employee.id` — the service resolves `Employee -> User` via `User.employeeId` first; no linked User means nothing to compute (404 on the manual trigger). Five metrics: newClients = `Customer` rows created in the period via `Customer.prospectId -> Prospect.salesOwnerUserId` (the #59 attribution precedent); premiumWritten = `SUM(Policy.issuedPremium)` for policies this employee PLACED — unlike #59's caution about crediting a Sales Officer (unreliable), crediting whoever PLACED the policy is a clean single-hop relationship; commissionEarned = `SUM(CommissionLedgerEntry.amount)` on those same policies, a plain gross figure, no netting; renewalRatePercent = of this employee's placed policies' `RenewalCase`s reaching a terminal outcome in the period, the proportion RENEWED — `RenewalCase` has no writer anywhere in this codebase today (the renewal module isn't built), so this returns null for every employee currently, implemented forward-compatible and PROVEN correct by seeding `RenewalCase` rows directly via Prisma in the e2e suite; crossSellRatePercent = of `CrossSellOpportunity` rows for customers this employee OWNS, RESOLVED in the period, the proportion CONVERTED — a real, working dimension today since Cross-Sell (#8) is fully built. **The two rate fields are null, not 0, with no denominator** — the columns are nullable by the schema's own original design (unlike #60's `InsurerPerformanceScore`, which needed a `NEUTRAL_SCORE=50` fallback since its columns aren't nullable). **The #60 manual-trigger-scoping lesson was applied from the FIRST draft, not rediscovered** — `POST /employee-performance/compute` requires `employeeId` from the start; the all-employees batch runs only from the scheduler, in bounded-concurrency chunks of 20. `@@unique([employeeId, periodLabel])` (migration `20260912120000`) makes a recompute upsert. No new permission — `employee-performance.view` (pre-seeded) gates both the read and the manual trigger. **A shared utility was promoted, not duplicated**: `previousUtcMonthRange`/`PeriodWindow` moved from `insurer-performance.config.ts` to new `common/period.util.ts`, re-exported so existing imports keep working. `apps/web/` gains an **"Employee performance"** screen (lookup + history table with a dash for null rates + a compute-now form). **Verification**: +26 api unit (`period.util.spec.ts` 2, `employee-performance.config.spec.ts` 9, `employee-performance.service.spec.ts` 15) → api unit **1937** (140 files, from 1911). New `test/employee-performance.e2e-spec.ts` **5/5** (permission gating; a partial-period 422; a 404 for an employee with no linked User; the default-previous-month resolution; a real Customer/Prospect/Policy×3/CommissionLedgerEntry/RenewalCase×2/CrossSellOpportunity×2 fixture chain proving all five metrics compute correctly including genuine 50%/50% renewal and cross-sell rates, and a same-period recompute upserting instead of duplicating). Full api unit suite 1937/1937 confirmed green; full api e2e suite (41 files) green, including both chronic flakes (`rbac`, `up-sell`) and two confirmed-transient environment hiccups (a mid-session system-memory-pressure episode and a TOTP-timing flake) both re-confirmed clean on isolated re-run, unrelated to this diff. New Playwright `employee-performance.spec.ts` 4/4; full Playwright suite 159/159 (from 156). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (migration `20260912120000`; 50 migrations). No seed change — `employee-performance.view` was already pre-seeded. |
| 2026-09-11 | Part C #60 (Insurer Performance) landed — "`InsurerPerformanceScore`: a periodic job computing the score from quote-response speed/claims service/price/service quality." Unlike #58/#59, `InsurerPerformanceScore` AND `InsurerSlaAgreement` already existed in the core schema — this process is their first real consumer for either. Four dimensions mapped to existing signals: quote-response speed = average `RFQInsurer.sentAt`→`respondedAt` days (only ever stamped on QUOTED/DECLINED) scored against `InsurerSlaAgreement` (`slaType: 'quote_response'`) if one exists, else the same 9-day default `RFQ.followUpThresholdDays` already uses; claims service = proportion of claims notified in the period with no `ClaimFollowUpAlert` ever raised; price = this insurer's premium vs. the field average of every other insurer's current quote on the same RFQ, kept in `Prisma.Decimal` via `money.util.ts` throughout since `Quotation.premium` is a money-decimal field; service quality = the average of `ComparisonMatrixRow.serviceScore`, an EXISTING optional subjective field whose own doc comment says "there is no Insurer-scoring module yet" — this process is exactly that module. Any dimension with no computable data for the period defaults to a uniform `NEUTRAL_SCORE = 50.00` (never 0 or 100, which would misread absence of evidence as a verdict). **A real redesign happened mid-build**: the first draft's `POST /insurer-performance/compute` recomputed every insurer with no `insurerId` — this timed out a 30s e2e test against `db-test`'s 2,726 accumulated `Insurer` rows (real Postgres connection-pool pressure, not a flaky assertion). Fixed by making `insurerId` mandatory on the manual trigger (the `up-sell-recommendations/detect` shape — no "detect for everyone" HTTP route exists there either), and by switching the scheduler's own all-insurers batch from a sequential loop to bounded-concurrency chunks (`Promise.allSettled`, 20 at a time — the #56 lesson taken further: unbounded parallelism over a large book would make pool pressure worse, not better). `@@unique([insurerId, periodLabel])` (migration `20260911120000`, a plain composite unique — no `SalesTarget`-style NULL gotcha, both columns always non-null) makes a recompute upsert rather than duplicate. **No new permission** — `insurer-performance.view` (pre-seeded) gates both the read and the manual trigger, the `internal-controls.audit` "Run audit now" precedent; the first Domain G process needing zero seed change. Monthly cadence (06:00 UTC on the 1st) — the first non-daily scheduler in this codebase. `apps/web/` gains an **"Insurer performance"** screen (lookup + history table + a compute-now form). **Verification**: +31 api unit (`insurer-performance.config.spec.ts` 16, `insurer-performance.service.spec.ts` 15) → api unit **1911** (139 files, from 1880). New `test/insurer-performance.e2e-spec.ts` **4/4** (permission gating; a partial-period 422; the default-previous-month resolution; a real RFQ/RFQInsurer/Quotation×2/ComparisonMatrixRow/Policy/Claim fixture chain proving all four scores compute correctly plus a zero-activity insurer defaulting to neutral 50, in the same period; a same-period recompute upserting instead of duplicating). Full api unit suite 1911/1911 confirmed green; full api e2e suite (40 files) green, including both chronic flakes (`rbac`, `up-sell`) and one confirmed-transient TOTP-timing flake in `complaint.e2e-spec.ts` (unrelated). New Playwright `insurer-performance.spec.ts` 4/4; full Playwright suite 156/156 (from 153). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (migration `20260911120000`; 49 migrations). No seed change — `insurer-performance.view` was already pre-seeded. |
| 2026-09-10 | Part C #59 (Sales Performance) landed — "a query per employee/team against target." The backlog names no model and no target metric. New model `SalesTarget` (migration `20260910120000`, a genuine new migration — unlike #60/#61's `InsurerPerformanceScore`/`EmployeePerformanceRecord`, both already pre-existing core schema, #59 had none). Target metric picked: `targetNewProspects` — new `Prospect` rows (a `Lead` qualified, Process 1→2) attributable to `Lead.ownerUserId`/`Prospect.salesOwnerUserId`, or to every user in one `Branch`, in `[periodStart, periodEnd)`. **Deliberately NOT premium/commission-based** — `Policy.placedByUserId`/`Opportunity.createdByUserId` name the PLACEMENT officer, not the sourcing Sales Officer, and `Customer.prospectId` is optional (a Customer can be onboarded with no Prospect at all), so there is no reliable way to attribute bound premium back to a Sales Officer without guessing; that dimension stays at `EmployeePerformanceRecord.premiumWritten` (#61, not built here). `ownerUserId`/`branchId` are bare scalars (no relations, the `Opportunity.createdByUserId` shape) — exactly one is set, checked at three layers: a pure `isExactlyOneScope()` validator, a hand-authored DB `CHECK` (`SalesTarget_owner_xor_branch`), and re-derived again on the read side's own scope resolution. **The #48 AML NULL-uniqueness gotcha resurfaced** — "at most one target per owner per period" / "...per branch per period" are TWO hand-authored partial unique indexes, not one composite `@@unique`, since Postgres treats every NULL as distinct in a plain composite unique and a composite key would never collide on the column that's always NULL for that row's scope. `GET /sales-performance` (`dashboard.sales.view`, pre-seeded) forces a Sales/Relationship Officer to their own `ownerUserId` and 403s a branch request outright (reusing `common/rbac-visibility.util.ts`'s existing `VIEW_ALL_OWNERS_ROLES`); Manager/Executive must supply exactly one of `ownerUserId`/`branchId` (422 on both/neither). No target found for "now" returns `target: null` (a valid, expected state), while an explicit unmatched `periodLabel` 404s. New permission `sales-target.manage` (`[BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`, 150 → 151 perms) — the one genuinely new Domain G permission this process needed. `apps/web/` gains a **"Sales performance"** screen (an officer's own stat cards with no scope picker; a Manager gets a lookup form plus a set/revise-target form). **Verification**: +24 api unit (`sales-performance.config.spec.ts` 9, `sales-performance.service.spec.ts` 15) → api unit **1880** (137 files, from 1856). New `test/sales-performance.e2e-spec.ts` **7/7** (permission gating; exactly-one-scope 422 on create and read; a 409 duplicate-target + PATCH-revise round trip; Sales-Officer-forced-to-self / branch-view-forbidden visibility; a null-target response + an explicit-`periodLabel` 404; a REAL Lead→Prospect walk moving a brand-new officer's `newProspects` from 0 to 1; a branch-scoped target resolving to two officers' combined actuals). Full api unit suite 1880/1880 confirmed green; full api e2e suite (39 files) green, both chronic flakes (`rbac`, `up-sell`) passing cleanly. New Playwright `sales-performance.spec.ts` 4/4; full Playwright suite 153/153 (from 150). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (migration `20260910120000`; 48 migrations). Seed change — `npm run db:seed` (new `sales-target.manage` permission; already applied to dev and test DBs during this build). |

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
