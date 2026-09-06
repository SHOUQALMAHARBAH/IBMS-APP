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
| 2026-09-06 | Part D §5.1 (Consent) touchpoint wiring landed — the first item of Part D's full 9-system checklist, worked one item at a time per user direction. The backlog names 7 explicit consent touchpoints (lead capture, onboarding/KYC, needs & risk assessment, RFQ/market placement, claims, Group Medical/Life & Motor Fleet, renewal & cross/up-sell); M03's original build (see the earlier Consent Management entry, now rotated out of this table) shipped only a generic, unwired capture screen. **5 of 7 now wired; 2 confirmed with the user (via AskUserQuestion) as a deliberate, documented gap** — Claims (no web UI for an individual claim exists anywhere in `apps/web`) and Group Medical/Life & Motor Fleet (maps to `InsuredPerson`, which has ZERO CRUD anywhere) both need a genuinely separate prerequisite module built first, not a Consent fix. **Lead capture needed a real schema change** — `ConsentRecord` gained a third optional owner column, `leadId` (migration `20260913120000`, FK to `Lead`, `ON DELETE SET NULL`), since a Lead pre-dates a Customer/InsuredPerson row entirely. Exactly-one-of-three is a NEW, Consent-local `hasExactlyOneConsentOwner` — deliberately not a generalization of the shared `common/dto.util.ts#hasExactlyOneOwner`, which DSR (M04) also depends on with a different two-way shape. `LeadRepository.create()` now creates the Lead + its lead-capture `ConsentRecord` in ONE `$transaction` (a deliberate, documented local exception to this codebase's no-`$transaction` convention, the `EmployeeRepository.terminate()` "create-together" shape); `Lead.marketingConsentGranted` (the pre-existing boolean) is unchanged, the new row is additive. `CreateLeadDto` gained a new mandatory `consentTextVersion` field — a real, intentional breaking change to `POST /leads`, not an oversight; every existing caller (5 e2e files, the web intake form) was updated. **The other 4 touchpoints (onboarding/KYC, needs & risk assessment, RFQ/market placement, cross/up-sell) needed no backend capability change** — a single new shared web component (`ConsentCaptureWidget.tsx`) mounted on their existing detail pages was the whole fix, since the gap was UI-reachability, not a missing capture mechanism; Needs Assessment/RFQ each resolve their `customerId` via an ALREADY-INJECTED sibling repository in the service layer (not a widened shared Prisma type — that approach was tried and reverted as more invasive). **Verification**: +9 api unit → api unit **2120** (from 2111). Extended `test/lead.e2e-spec.ts` (+1, now 15/15) and `test/consent-record.e2e-spec.ts` (+1, now 2/2) for the leadId path. Full api unit suite 2120/2120 confirmed green; full 50-file api e2e suite green across 8 foreground sub-batches (one confirmed-transient TOTP-timing flake in `auth.e2e-spec.ts`, re-confirmed clean in isolation), both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. Full Playwright suite **243/243** (from 242) — including a real bug caught mid-verification: the RFQ detail page crashed outright in Playwright because the shared mock RFQ fixture lacked the new `opportunity.customerId` field the page now reads unconditionally; fixed the fixture. `npm run typecheck`/`lint`/`build` (api + web) OK — one real lint catch (the same `react-hooks/set-state-in-effect` false positive `internal-controls/page.tsx` hit before; same async-IIFE fix). | No seed change. Run `npm run db:migrate:deploy` (new migration `20260913120000_add_consent_record_lead_id`) — already applied to dev and test DBs during this build. `POST /leads` callers must now supply `consentTextVersion`. |
| 2026-09-06 | **Fix**: CI's `backend` job was failing on `packages/db/prisma/seed-data/permissions.spec.ts` — "External Auditor is read-only by construction" (every EXTERNAL_AUDITOR-granted code must end in `.read`/`.view`) was violated by `internal-controls.audit` (Process 56), the one outlier among every other EXTERNAL_AUDITOR grant in the seed. That route (`GET /internal-controls/self-approval-audit`) was always a plain read with no mutation — the permission's NAME was the bug, not the test, so it was renamed to `internal-controls.view` rather than weakening the invariant. No behaviour change: same route, same roles (`[COMPLIANCE_OFFICER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`). Updated every reference across api (controller/module doc comments, the #60/#65 "Run audit now" precedent citations in `compute-insurer-performance.dto.ts`/`planning-export.controller.ts`), web (`internal-controls` page copy + its Playwright spec), and docs (`README.md`, `ibms-brain/meta/context/internal-controls-audit.md`+2 citing files). Re-seeded dev and test DBs and manually deleted the orphaned old `internal-controls.audit` `Permission`/`RolePermission` rows the additive seed script leaves behind on a code rename (152 permissions either way). **Second, independent CI failure found once the first was fixed and the `backend` job finally reached its `Integration tests` step for the first time this session**: `test/watchlist-sync.e2e-spec.ts` fabricates exactly 1 record per source, but `WatchlistSyncService.syncSource` refuses to trust a parse of fewer than `WATCHLIST_MIN_ABSOLUTE_RECORDS` (10) records when there is no PRIOR successful sync for that source — a deliberate plausibility floor (a WAF/interstitial page must not parse to near-nothing "for free" on day one). CI's Postgres service starts genuinely empty every run, so it always takes that no-prior-sync branch; this test had only ever "passed" locally against this session's own long-lived, cumulative `db-test`, where an earlier low-count successful run from a PRIOR execution of this same test lowered the effective floor via the ratio-based branch instead — a local-environment artifact masking a bug that was never actually exercised against a fresh database until CI got far enough to run it. Fixed the fixture, not the service — added 9 harmless filler records per source (OFAC CSV rows / UN XML `<INDIVIDUAL>` blocks) alongside the one record each assertion actually targets, matching what a real first sync would plausibly return. **Verification**: `permissions.spec.ts` 15/15 (was 14/15); full api unit suite 2111/2111; `internal-controls.e2e-spec.ts` 2/2 and `watchlist-sync.e2e-spec.ts` 1/1 against a test DB with `WatchlistEntry`/`WatchlistSyncRun` cleared first (simulating CI's fresh database — the bug does not reproduce against the polluted long-lived DB); `internal-controls.spec.ts` Playwright 4/4 against a fresh `next build`; `npm run lint`/`typecheck` (api + web) clean. GitHub Actions run 34048574498 (before this second fix) confirmed the first fix alone got the `backend` job's `Unit tests` step green and isolated this as the ONLY remaining `Integration tests` failure (219/220 e2e tests passed); this fixture fix has not yet had its own CI run confirmed at the time of this entry. | Run `npm run db:seed` / `npm run db:test:seed` (permission code rename, not a count change) — a persistent local DB from before this fix also has a stale `internal-controls.audit` row the additive seed won't remove; delete it by hand (`DELETE FROM "RolePermission" WHERE "permissionId" IN (SELECT id FROM "Permission" WHERE code = 'internal-controls.audit'); DELETE FROM "Permission" WHERE code = 'internal-controls.audit';`) if you seeded before this commit. No seed/DB action needed for the watchlist-sync fixture fix. |
| 2026-09-20 | Part C #74 (Knowledge Management) landed — **closes Domain H (Supporting Operations, #66-74)**. One checkbox: "a bilingual knowledge base: product knowledge, insurer appetite, rate guides, regulatory updates." `KnowledgeBaseArticle` pre-exists with zero prior application code — the same "dormant model, first real writer" shape #58-73 repeatedly found, closing the domain on the same pattern it opened with. `kb.publish` was already pre-seeded. **"Bilingual" here is OPTIONAL-per-article, not mandatory-both** — the sibling `DocumentTemplate` model has `nameEn`/`nameAr`/`bodyEn`/`bodyAr` ALL `NOT NULL`; `KnowledgeBaseArticle` is the opposite — only `title` is mandatory, `titleAr`/`bodyEn`/`bodyAr` are all nullable, so an article may exist in English only, Arabic only, or both. **Creation IS publishing** — `publishedAt` defaults to `now()` at the DB level with no nullable "draft" state, matching the pre-seeded permission's own verb. **`kb.publish` gates the WHOLE surface, not just publish** — with a real, documented consequence: only `[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER, PLACEMENT_TECHNICAL_OFFICER]` can even READ the knowledge base via this API, since no broader read permission was pre-seeded; a genuinely useful company-wide knowledge base would want wider read access, but this is a real, deliberate scope limit of the backlog's own permission grid. `category` is mutable via `PATCH`, unlike #72-73's `BcpDrPlan.scenario` (deliberately immutable) — the same domain making different mutability calls for a similarly-shaped field depending on what it represents. No maker/checker, no SLA timer, no cross-entity FK validation — the simplest Domain H CRUD built this session. No new permission, no migration. `apps/web/` gains a **"Knowledge Base"** screen (bilingual list with RTL-aware Arabic columns/inputs, a publish form, inline title/titleAr edit). **Verification**: +9 api unit → api unit **2111** (157 files, from 2102). New `test/knowledge-base-article.e2e-spec.ts` **5/5** — permission gating; a 400 on an out-of-set category; a real create(English-only)→list(filtered)→get→update(add Arabic translation) walk; a fully bilingual create in one call; 404s for an unknown article. Full api unit suite 2111/2111 confirmed green; full 50-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `knowledge-base.spec.ts` 5/5; full Playwright suite 242/242 (from 237). `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `kb.publish` was already pre-seeded. |
| 2026-09-20 | Part C #72-73 (Business Continuity & Disaster Recovery) landed — a plan for every scenario the source names explicitly (system outage, site/office loss, cyberattack/ransomware, key-staff unavailability, insurer-side service interruption); a documented RTO/RPO + last-tested date + next-test-due date per plan. `BcpDrPlan` pre-exists with zero prior application code — the same "dormant model, first real writer" shape #58-71 repeatedly found. `bcp-dr.manage` was already pre-seeded — no seed change needed. **`meta/lex/backup-rpo-rto.md` already covers ONE narrow, already-tested slice of scenario #1 (`system_outage`)** — the database backup/restore drill (weekly CI, real pass/fail on row-count parity + a timed RTO check); its own draft RPO/RTO figures pre-date this process and are not restated. The other four scenarios have NO code-level automation anywhere in this repo — `BcpDrPlan` is a plain record of a plan's existence and test history, not a system that executes the plan. **No sourced test-cadence figure exists for BCP/DR plans generally** — unlike #71's Vendor annual review (an explicit pre-seeded cadence), `nextTestDueAt` is a plain caller-supplied field, never auto-computed; this process is deliberately NOT wired into `SLA_REGISTRY` at all, since BCP/DR cadence is a CBJ operational-resilience concern, a different regulatory domain from the PDPL-sourced SLAs that registry tracks. **Checkbox 1 is answered by a genuine coverage/gap check** — `GET /bcp-dr-plans/coverage` returns all five named scenarios every time with a `hasPlan` flag, not a plain list a caller must verify by eye. `planDocumentId` (a bare scalar) is validated against a real `Document` via `DocumentRepository.findById()`, reachable now that #70 built real Document CRUD. `apps/web/` gains a **"BCP / DR plans"** screen (coverage view with gaps flagged, a create form, per-plan record-test action). **Verification**: +16 api unit → api unit **2102** (156 files, from 2086). New `test/bcp-dr-plan.e2e-spec.ts` **6/6** — permission gating; a 400 on an out-of-set scenario; a 404 on a bad `planDocumentId`; a real create→list(filtered)→get→update→record-test walk with a real linked Document (scenario proven immutable); 404s for an unknown plan; the five-scenario coverage view. Full api unit suite 2102/2102 confirmed green; full 49-file api e2e suite green across 7 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `bcp-dr-plans.spec.ts` 5/5; full Playwright suite 237/237 (from 232). `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `bcp-dr.manage` was already pre-seeded. |
| 2026-09-20 | Part C #71 (Vendor Management, M07) landed — risk tiering (low/medium/high) before any data share or access grant; a mandatory Data Processing Agreement for Medium/High tier + DPO approval for High tier before the first share; mandatory annual review + confirmation of data return/destruction on termination + access revocation within 2 business days. #67 (Procurement) built the foundational `Vendor` CRUD and explicitly deferred `riskTier`/`annualReviewDueAt`/`terminationDataReturnConfirmedAt`/`accessRevokedAt` to this process — same model, same module, extended not duplicated. **Checkbox 1 has no live call site to enforce against** — `DataSharingApproval` (M08) has zero prior writer and no model represents a generic "access grant" at all; built `computeDataShareReadiness()` as a pure, queryable rule instead of inventing the M08 workflow — an honest gate with no live enforcement call site yet. **`DataProcessingAgreement`'s maker/checker pair already had a DB `CHECK` constraint since the A.5 work, zero prior writer** — this process is that first real writer; `dpa.approve` (DPO only) was already pre-seeded as a DISTINCT permission from `vendor.manage`. **Not the M06 Disposal dual control** — that's a separate, still-unbuilt batch-destruction process; this process's own DPA maker/checker pair is a different, already-named pair. **`vendor_termination_access_revocation` (2 business days) needed a genuinely NEW SLA registry entry** — unlike this same process's own `vendor_annual_review` (already pre-seeded), the lex table had no row for it at all; added to both the lex table and the registry, sourced from the backlog's own text. `Vendor` has no explicit "terminated" status — termination is `terminationDataReturnConfirmedAt` going null-to-set, gated by a mandatory explicit attestation; `accessRevokedAt` is a separate, subsequent stamp requiring termination first. Risk tiering auto-schedules the annual-review SLA on the first Medium/High tiering only. No new permission, no migration — both `vendor.manage`/`dpa.approve` were pre-seeded. `apps/web/` gains a **vendor detail screen** (risk tiering, readiness check, DPA lifecycle, termination/revocation). **Verification**: +42 api unit → api unit **2086** (154 files, from 2044). Extended `test/vendor.e2e-spec.ts` to **8/8** (from 4) — the full risk-tiering→review walk; the full DPA maker/checker lifecycle + readiness gate (403 self-approval, 409 double-approval); Low-tier readiness with no DPA; termination→revocation with order-guarding and double-execution 409s. Full api unit suite 2086/2086 confirmed green; full 48-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `vendor-detail.spec.ts` 5/5; full Playwright suite 232/232 (from 227). `npm run typecheck`/`lint`/`build` (api + web) OK — one real a11y catch (an unlabeled risk-tier `<select>`), fixed. | No migration, no seed change — `vendor.manage`/`dpa.approve` were already pre-seeded. |
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
