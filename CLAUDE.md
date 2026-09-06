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
| 2026-09-19 | Part C #68 (Internal Information Technology) **verified, not built** — the backlog's own annotation claims it's already covered by A.10 (environment separation) and "Part 10.5" (change management with security sign-off before deployment), no standalone data table needed. This process did NOT take that claim at face value. **"No standalone data table" holds up** — #68 names no business-entity concern, so this is a genuine #47/#50 "verified-covered" shape, not a skipped build. **But the coverage claim is overstated on the other two counts**: (1) A.10's Dev/Test/UAT/Prod separation is THIS SAME README's own § Known gaps admission of "scaffolded, not achieved" — three local docker-compose Postgres instances, no real UAT/Prod deployment target; (2) "Part 10.5" as a distinct control has NO independent definition anywhere in this repo or `ibms-brain` — grepped exhaustively, it appears nowhere except inside the #68 annotation itself; it's the backlog author's own gloss on A.10's combined "Part 10.4/10.5" citation. The closest real artifact (DAST in CI) is explicitly non-blocking, and no deployment pipeline exists for a sign-off gate to attach to. No separate build was made — this verification pass IS the process's completion — but its coverage reads as "the same infra gaps A.10 already tracks," not "done." | Nothing to run — no code changed. README.md updated with the full verification (§ Known gaps cross-reference, not a duplicate); no `ibms-brain` change (this is ibms-app's own infra-status fact, not generalizable brain content). |
| 2026-09-18 | Part C #67 (Procurement) landed — the backlog's own text carries an explicit scope warning, quoted in full since it IS the design brief: "The two source documents give no more than a one-line general description ('purchase requests and vendor selection for non-insurance operational needs') — no field-level detail or defined workflow in the source. The only task actually executable from the source directly: use `Vendor` (with `vendorType=other`) as the general vendor record for this purpose, without inventing a purchase-request model that isn't in the text." **No `PurchaseRequest` model, no approval workflow, nothing beyond the literal instruction was built** — the opposite case from most items: the source names EXACTLY which existing model to reuse and exactly what NOT to invent. **`Vendor` is a genuinely shared register — THREE consumers, one model**: its own schema doc comment already says "Merges Process 71 (Vendor Management) and PDPL third-party governance"; #67 adds a third consumer (`vendorType: 'other'`) to the SAME rows #71 (risk tiering/DPAs/annual review) and Part D's Third-Party & Data Sharing section will also use. Zero prior application code — the same "dormant model, first real writer" shape #58-66 repeatedly found. **What #67 built vs. what stays #71's job**: `VendorRepository`/`VendorService`/`VendorController` implement ONLY the foundational CRUD (create/list/get/update on name+vendorType) — `riskTier`/`annualReviewDueAt`/`terminationDataReturnConfirmedAt`/`accessRevokedAt` all exist on the model already but are deliberately untouched; #71 will extend the SAME module rather than build a parallel one. `vendorType` validated against the exact 7-value set from the schema's own doc comment. No new permission — `vendor.manage` (pre-seeded, its own description already reading "...and its risk tier") gates the whole surface. `apps/web/` gains a **"Vendors"** screen (list+create+inline-rename, no separate detail page). **Verification**: +8 api unit (`vendor.service.spec.ts`) → api unit **2014** (149 files, from 2006). New `test/vendor.e2e-spec.ts` **4/4** — permission gating; a 400 on an out-of-set `vendorType`; a real create→list(filtered)→get→update walk (a name-only PATCH leaves `vendorType` untouched); 404s for an unknown vendor. Full api unit suite 2014/2014 confirmed green; full 46-file api e2e suite green across 8 foreground sub-batches — a clean run, no transient flakes this time; both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `vendors.spec.ts` 4/4; full Playwright suite 218/218. `npm run typecheck`/`lint`/`build` (api + web) OK — no lint findings. | No migration, no seed change — `vendor.manage` was already pre-seeded. |
| 2026-09-17 | Part C #66 (Human Resources) landed — **opens Domain H, Supporting Operations (#66-74).** Two checkboxes: an employee record + licensing/certification tracking for regulated staff + training records; an automated access de-provisioning checklist on an employment-status change (same business day). `Employee`/`SecurityAwarenessTraining`/`AccessDeprovisioningChecklist` all pre-exist in the core schema (Part 8.2) with zero prior application code — the same "dormant model, first real writer" shape #58-65 found repeatedly in Domain G. Licensing/certification tracking maps to the schema's own flat fields (`licensedRole`/`confidentialityAgreementSignedAt`/`backgroundCheckCompletedAt`) — no new table invented. **`terminate()` is the first real caller of an ALREADY-REGISTERED SLA**: `pdpl-sla-timers.md`'s own registry sources "Termination access revocation (M05) | Same business day | Critical alert to IT management if still open after 24h," already transcribed in `SLA_REGISTRY` (`termination_access_revocation`) with zero prior caller — no new SLA design needed, only wiring `SlaTimerService` to the real events. **Termination is a stamp+create transaction, not a status enum** — `Employee` has no `EmploymentStatus`; `terminationDate` going null-to-set IS the transition. `EmployeeRepository.terminate()` stamps + creates the checklist in ONE `$transaction` (the `retention-case.repository.ts` shape), guard re-asserting `terminationDate: null` so a concurrent second termination 409s instead of racing. **`systemAccessRevoked` has a REAL effect**: ticking it deactivates the linked `User` and kills every live session (`SessionService.revokeAllForUser`) — proven end-to-end (a live bearer token 401s immediately) — since a timestamp-only checklist box would miss Part 8.2's entire regulatory point. **`User.employeeId` — #61's dormant FK — gets its first real writer**: an optional `userId` on create, verified not-already-linked (409), a deliberate minimal addition finally making #61's `EmployeePerformanceRecord` usable. Permission split: `employee.manage` (Admin+Manager) for the general surface; `deprovisioning.execute` (Admin ONLY, narrower) for terminate + every checklist action — terminating IS the trigger, so it sits behind the same narrow permission as executing the checklist. Zero seed change. Encryption mirrors `CustomerService` exactly (`Employee.nationalIdEnc` masked-by-default, justified reveal, list view strips the field entirely). `apps/web/` gains **"Employees"** (list+create) and an `[id]` detail screen. **Verification**: +31 api unit (`employee.config.spec.ts` 6, `employee.service.spec.ts` 25) → api unit **2006** (148 files, from 1975). New `test/employee.e2e-spec.ts` **3/3** — permission gating (Manager lacks `deprovisioning.execute`); a real full-lifecycle walk (create with linked User → reveal → train → terminate → verify the SLA timer → 409 on re-terminate → 400 on early completion → `systemAccessRevoked` deactivates the user AND 401s their live token → complete resolves the timer); a 409 on a doubly-linked userId. Full api unit suite 2006/2006 confirmed green; full 45-file api e2e suite green across 8 foreground sub-batches — two confirmed-transient environment hiccups this run (unrelated files, re-confirmed clean on isolated re-run), both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `employees.spec.ts` 4/4; full Playwright suite 214/214. `npm run typecheck`/`lint`/`build` (api + web) OK — a second occurrence of the #65 `@typescript-eslint/no-unsafe-assignment` pattern (an asymmetric Vitest matcher nested in an object literal), fixed the same way. | No migration, no seed change — `employee.manage`/`training.record`/`deprovisioning.execute` were already pre-seeded. |
| 2026-09-15 | Part C #65 (Strategic Planning Inputs) landed — **the last Domain G item built; #64 Executive Management Reporting deliberately not built yet.** "Export portfolio/market data for planning cycles." No new model/migration/scheduler — composes TWO already-built reports: portfolio = the SAME four #62 breakdowns (byLine/byInsurer/byClientSegment/byGeography, current-state, no period); market = every insurer's `InsurerPerformanceScore` (#60) for ONE period (defaulting to the previous UTC calendar month via `common/period.util.ts`, a third consumer). The first genuinely new capability shape — an "export" — but stays a plain JSON payload, no CSV/file-download precedent existed or was introduced. **This codebase has a single, zero-exception, VERIFIED rule**: a module needing another domain's data imports that module's REPOSITORY, never its SERVICE (`CustomerModule` exports only `CustomerRepository`; #63 extended this to a shared repository provided independently in two modules) — #65 needed the SAME treatment for TWO repositories at once (`PortfolioAnalysisRepository` + `InsurerPerformanceRepository`), both provided independently in `PlanningExportModule`'s own `providers`, zero `imports`/`exports` touched on either existing module. Reuses the pure derivation functions directly (`deriveLineOrInsurerBreakdown`/`reduceByClientSegment`/`reduceByGeography`, `deriveInsurerPerformanceScoreView`) — never duplicating the reduction logic, only the thin `Promise.all` + name-resolution glue every composing report already repeats (the #40 shape). Injecting the two SERVICES directly was considered and rejected — the first exception to a rule with zero exceptions across 65 built processes. **Permission is the narrowest Domain G grant**: `planning-export.generate` (pre-seeded) grants `[EXECUTIVE_MANAGEMENT]` ONLY — no Manager, no Finance; zero seed change. A POST route, not GET, matching the permission's "generate" verb (the `internal-controls.audit` shape) even though it's a pure read. **The first real writer of `AuditAction.EXPORT`** — this enum value and `AuditAnomalyDetectionService.checkBulkExport` (Part 10.3) have existed dormant since before this session; `AuditService.record()` already calls the anomaly evaluator on every write, so #65's own audit call activated this dormant detector with ZERO extra wiring. `apps/web/` gains a **"Strategic Planning Inputs"** screen (a form-triggered generate action, not an auto-loading dashboard). **Verification**: +9 api unit (`planning-export.config.spec.ts` 3, `planning-export.service.spec.ts` 6) → api unit **1975** (146 files, from 1966). New `test/planning-export.e2e-spec.ts` **4/4** — permission gating; an explicit assertion that BOTH Manager AND Finance are FORBIDDEN (proving the narrowest-grant claim); the default-previous-UTC-month resolution; a real fixture (unique line/insurer + a real `InsurerPerformanceScore` row) proving portfolio + market data compose correctly. Full api unit suite 1975/1975 confirmed green; full 44-file api e2e suite green across 8 foreground sub-batches — two confirmed-transient environment hiccups this run (unrelated files, both re-confirmed clean on isolated re-run); both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `planning-export.spec.ts` 3/3; full Playwright suite 210/210. `npm run typecheck`/`lint`/`build` (api + web) OK — one real lint catch: `@typescript-eslint/no-unsafe-assignment` on an asymmetric Vitest matcher nested inside a `toHaveBeenCalledWith` object literal, fixed by asserting the captured mock-call argument directly. | No migration, no seed change — `planning-export.generate` was already pre-seeded. |
| 2026-09-14 | Part C #63 (Profitability Analysis) landed — "commission income vs. cost-to-serve per segment/line." Like #62, no new model/migration/scheduler — but unlike #62, this REUSES the same written-policy data #40's `FinancialReportService` already loads, reduced into a genuinely different metric. **Why this isn't a duplicate of #40's `netPosition`**: #40's `netPosition = premiumWritten − claimsPaid − commissionEarned` is an underwriting-result view of the INSURER's side of the book; #63 asks whether the commission the BROKER earns is enough to cover what it costs the broker to service the book — `netProfitability = commissionIncome − costToServe`, reducing the identical raw data differently. `commissionIncomeJod` = Σ(`commissionAmount − commissionReversedAmount`) per group, the SAME net-of-clawback calc #40 uses (not #58/#61's gross simplification). `costToServeJod` = Σ net settlement of SETTLED/CLOSED claims — **a documented scoped interpretation, not a true operational cost**: no expense/staff-time/overhead model exists anywhere in this schema (Domain H/#66 HR isn't built), so claims-settlement payout stands in as the closest available cost signal, reusing (not duplicating) the SAME `claimsPaid` figure #40 already computes. Grouped by `insuranceLine`/`customerType` ONLY (no insurer/geography, unlike #62's four); worst-first sort, the #40 convention. **A new kind of promotion**: `ProfitabilityPolicyRow` + its loader were extracted OUT of `FinancialReportRepository` (#40) into a standalone `repositories/profitability-policy.repository.ts` — `finance.config.ts` re-exports the type so existing imports keep working. **Module wiring stayed zero-coupling**: the same repository class is provided independently in BOTH `FinanceModule`'s and the new `ProfitabilityAnalysisModule`'s own `providers` arrays — no `imports`/`exports` wiring between them. **Permission is a real deviation from #58-62**: `profitability-analysis.view` (pre-seeded) grants `[EXECUTIVE_MANAGEMENT, FINANCE_COLLECTIONS_OFFICER]` — NOT `BRANCH_DEPARTMENT_MANAGER`; zero seed change, the #60/#62 "no new permission" precedent a third time. A best-effort READ audit flags `isSensitiveDataAccess` whenever a settled claim contributed, the #40 rule. `apps/web/` gains a **"Profitability analysis"** screen (two breakdown tables). **Verification**: +13 api unit (`profitability-analysis.config.spec.ts` 8, `profitability-analysis.service.spec.ts` 5) → api unit **1966** (144 files, from 1953); the #40 extraction re-verified transparent (55/55 unchanged, re-confirmed after `eslint --fix`). New `test/profitability-analysis.e2e-spec.ts` **3/3** — permission gating; an explicit Branch/Department Manager FORBIDDEN assertion (documenting the role-scope deviation); a real fixture (unique line + a SETTLED Claim/Settlement + a CommissionLedgerEntry) proving all three money figures, plus a before/after delta on `bySegment`. Full api unit suite 1966/1966 confirmed green; full 43-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`, including #40's own e2e coverage re-confirmed green post-extraction. New Playwright `profitability-analysis.spec.ts` 3/3; full Playwright suite 207/207. `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `profitability-analysis.view` was already pre-seeded. |

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
