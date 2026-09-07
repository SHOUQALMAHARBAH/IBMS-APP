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
| 2026-09-07 | **CLOSES Part F item #2 of 8** — full RTL layout (navigation, forms, tables, charts genuinely mirrored, not just mirrored text), after item #1's instant language switch. Found ~60 files' worth of item #2 work already sitting uncommitted in the working tree at session start — a prior session's unfinished conversion of physical CSS (`textAlign:'left'/'right'`, `marginLeft/Right`, `borderLeft/Right`) to logical equivalents (`start`/`end`, `marginInlineStart/End`, `borderInlineStart/End`), relying on `dir="rtl"` cascading from `<html>` (item #1) plus plain `flexDirection: row` and native `<table>` column order to mirror for free, plus a new untracked `apps/web/e2e/rtl-layout.spec.ts` asserting real bounding-box mirroring (not computed-style keywords, which read back unchanged for a logical value in both directions). Reviewed the entire diff file-by-file — no mistakes found; confirmed via whole-codebase grep that zero physical-direction CSS properties remain anywhere in `apps/web`. **Charts confirmed vacuously N/A** (no chart/graph/SVG/canvas visualization exists anywhere in this app yet — only Next.js's own boilerplate public assets matched a grep for `recharts`/`chart.js`/`d3`/`<canvas>`/`<svg>`); forms and native `<table>` mirroring both confirmed already-structural, not new work. **Verification**: +1 new Playwright spec (`rtl-layout.spec.ts`, 2 tests) → full web suite **224/224** non-`@a11y` + **66/66** `@a11y` green (one transient `write UNKNOWN` process-contention failure under full-suite parallel load, re-confirmed clean 27/27 in isolation). `npm run typecheck`/`lint`/`build`/`test` (web) OK; api suite re-run as a sanity baseline (2320/2320, unaffected — web-only change). | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #2 covers/does NOT cover" before starting item #3 — item #2 is layout mirroring only, the ~80 other screens' text is still English-only. |
| 2026-09-07 | **Full-codebase code-review audit** (10 parallel `@code-reviewer` batches, all 35 api modules + the whole web frontend) found and fixed 2 BLOCKER + 8 MAJOR findings; ~20 MINOR/NIT items logged to a new root `IMPROVEMENTS.md`. **BLOCKERs**: `WorkflowTransitionService.transition()` (the ONE shared status-transition engine 30+ services depend on) committed its status write and TRANSITION audit row as two separate round-trips, not one transaction — fixed via a single `$transaction` (new `AuditService.recordInTransaction()`/`runAnomalyDetection()` pair, so anomaly detection's own best-effort writes still run after commit); the JWT access-token signing secret silently fell back to a hardcoded dev string with no production fail-fast, unlike every other secret in this codebase — fixed with a shared `jwtSecret()` helper + a new `assertJwtSecretConfigured()` boot-time check in `main.ts`. **MAJORs**: the same read-then-unconditionally-write race gap recurred in Access Recertification's `decide()`, password-reset's `resetPassword()`, and Insurance Program's `reassemble()` (a previously-accepted "single-actor pool" premise that no longer holds — Placement is a book-wide role grant) — all three now use a status-conditional `updateMany`/transactional row-lock, each with a new concurrent-race test confirmed live against `db-test`. Compliance Dashboard and KPI Dashboard both omitted `isSensitiveDataAccess: true` despite aggregating KYC/Complaint/DSR/AML/Claim data — fixed (a unit test asserting the wrong value was also corrected). `PaymentChannel`'s `label`/`bankName` were missing the `NO_FULL_ACCOUNT_NUMBER` guard every comparable free-text field elsewhere already carries. A stale premise in `meta/context/consent-management.md` ("no web UI exists for an individual claim record") was false — `ClaimSection.tsx` is exactly such a UI — now wired to `ConsentCaptureWidget` (6 of 7 touchpoints; the 7th is genuinely blocked on `InsuredPerson` having zero CRUD). **Verification**: api unit **2320/2320** (from 2316); targeted e2e (`auth`, `rbac` with its established `--testTimeout=180000`, `insurance-program`, `invoice`) all green; web typecheck/lint/build/unit/full Playwright suite green after the consent-widget change. `npm run typecheck`/`lint` (api + web) OK throughout. | No migration, no seed change. Read the new root `IMPROVEMENTS.md` for the ~20 logged MINOR/NIT items before assuming this audit's scope was exhaustive — the web-frontend batch sampled ~45 of ~90 pages, logged in its own coverage note. |
| 2026-09-07 | Opens Part F (backlog Part 11, "Bilingual UI Requirements") — item #1 of 8: "instant language switch without losing session context + a persistent per-user language preference." Worked one item at a time (the Part D/E pacing default). `User.languagePreference` (pre-existing schema field, `AR`/`EN`, `@default(AR)`, readable via `GET /auth/me`) was write-once-at-signup only — new `PATCH /auth/me/language` (self-service, no permission beyond being signed in) persists a change. **Design decision: a hand-rolled `LanguageProvider` React context (`apps/web/lib/i18n/`), not a locale-routing i18n library** (`next-intl` etc.) — "instant... without losing session context" reads as a same-URL, client-only toggle, which a routing library's URL-prefixed-locale integration doesn't give for free; see `ibms-brain/meta/designs/2026-09-bilingual-ui-i18n-architecture.md` for the full alternatives-considered writeup. The provider syncs from the account once per session, then treats local state as authoritative; every switch flips React state + `<html lang/dir>` synchronously (genuinely instant) and persists via a best-effort background PATCH (the SlaTimer-start precedent). A small, real translation dictionary backs a `t()` hook, scoped ONLY to the new switcher control + `AppNav`'s account footer — translating the other ~80 screens is items #2-5's own separate scope, not attempted here. Login/signup get no switcher yet (outside the authenticated shell) — a documented gap. **Caught a real test-authoring bug**: the new Playwright spec's `page.route("**/leads**", ...)` (no host) also matched the page's own navigation request, rendering literal `[]` instead of the app shell — fixed by scoping to the api origin, the convention every other spec already follows. **Verification**: +1 api e2e test (`auth.e2e-spec.ts`, 12/12); +3 web unit tests (new `translations.test.ts`); +3 new Playwright tests (new `language-switcher.spec.ts`) → full Playwright suite **287/287** (from 283) — 4 unrelated specs flaked once under a concurrent-process memory-pressure episode, re-confirmed clean in isolation. Full api unit suite 2316/2316 confirmed green; full 62-file api e2e suite green across all 8 foreground batches, chronic `rbac.e2e-spec.ts` flake re-confirmed clean with its established `--testTimeout=180000`. `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration (the schema field pre-existed), no seed change. Read `ibms-brain/meta/context/bilingual-ui.md` before any other Part F item — items #2-8 remain entirely unbuilt, and only the switcher + nav footer are actually bilingual today. |
| 2026-09-07 | Closed a real DSR (M04) / Legal Hold (M06) integration gap found during a meticulousness re-audit of Part D (a request to verify backlog items #52/#64 were genuinely "ready," not build something new). `POST /dsr/:id/fulfil` blocked a DELETION request from closing "fully fulfilled" while a retention flag was open using ONLY a staff attestation (`confirmNoOpenRetentionHold`) — honest when M04 shipped (M06 didn't exist, so `LegalHold` had no structured subject reference), but the reasoning went stale once M06 shipped in a later session with a real register nobody wired up. **Fix**: `LegalHold` gained optional `customerId`/`insuredPersonId` columns (migration `20260916120000`, at most one set — `hasAtMostOneSubjectReference`); `LegalHoldRepository.hasActiveHoldForSubject()` is a new live check `DsrService.fulfil()` now runs FIRST for a DELETION request — an outright 422 if an active hold names the subject, which the attestation can no longer override. The attestation still gates the one case the live check can't cover (a category's retention period not yet elapsed has no per-subject hold row). `CreateLegalHoldDto`/`ListLegalHoldsQueryDto` gained matching optional fields; the `retention-disposal` web page gained Customer ID / Insured person ID inputs + a Subject column. **Verification**: +12 api unit → api unit **2316** (185 files, from 2304). New DSR e2e test (hold blocks fulfil even with the attestation ticked → partially-fulfil still works → release → a fresh DELETION for the same customer fulfils normally, proving the check is live not cached); new retention-disposal e2e test (at-most-one 422, unknown-customerId 404, list-by-customerId). Full api unit suite 2316/2316 confirmed green; full 62-file api e2e suite green across 8 foreground sub-batches. Playwright: a pre-existing `retention-disposal.spec.ts` test needed a `.first()` fix after a second fixture row made its `Release`-button locator ambiguous (a real, caught test-authoring bug, not a product one); new subject-naming test passes; full suite green. `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (new migration `20260916120000_add_legal_hold_subject_reference`) — already applied to dev and test DBs during this build via the documented hand-apply-plus-`migrate resolve` workaround (see memory: Prisma migrate dev checksum drift). No seed change. |
| 2026-09-07 | **PART E (backlog Process #64) COMPLETE** — Sales + Policy + Claims + Financial + Compliance Dashboards (5 fresh builds) + Insurer & Employee Performance Dashboard (verify + 1 small gap closed) + the cross-cutting filter/bilingual bullet, all closed out. Worked one dashboard at a time (the Part D pacing default). **Sales**: `GET /dashboards/sales` — leads/premium(new vs renewal)/commission/cross-sell/up-sell. **Policy**: `GET /dashboards/policy` — active/expiring (live) + new-issued/cancelled (period-scoped, `Endorsement.appliedAt`-dated). **Claims**: `GET /dashboards/claims` — open/closed/outstanding/ageing/loss-ratio-by-insurer; no period range, `asOf` instead; widened backlog #30's `LOSS_RATIO_GROUP_BY`. **Financial**: `GET /dashboards/financial` — closes the exact gap #40's own DTO deferred as "a Part E dashboard refinement," reusing #40's pure builders + widening 3 repositories. **Compliance**: `GET /dashboards/compliance` — 7 sections (KYC/complaints/AML+self-approval-scan/regulatory-calendar/DSR/breach-register/DPIA), the DPO Workspace aggregate shape; no period range AND no insuranceLine/insurerId anywhere (first dashboard where 2 whole filter dimensions apply nowhere). **Insurer & Employee Performance**: a THIRD outcome shape — Part E's own permission grid already names `insurer-performance.view`+`employee-performance.view` (backlog #60/#61, not a new dashboard.*.view code) as this 6th dashboard's pair, confirming #60/#61 already built it; re-ran both suites, confirmed "4 axes"/"KPI achievement" are literal matches to existing models, then closed ONE small gap (a `branchId` filter on `GET /employee-performance`, additive) and added a lightweight combined `/dashboards/insurer-employee-performance` page. `GET /insurer-performance` deliberately untouched (a book-wide per-insurer score, not filterable by branch without recomputing a different metric). **Cross-cutting bullet resolved**: the filter half is honestly satisfied per-dashboard (each dashboard's own entry documents which of branch/line/insurer/period genuinely apply); the bilingual half is explicitly NOT satisfied anywhere in the app and is Part F's own unbuilt scope, not a Part E deliverable. No dashboard needed a migration or new permission; only Financial needed to widen existing repositories, Insurer/Employee needed one small filter addition. **Verification**: +16/+11/+14/+8/+16/+1 api unit across the six items → api unit **2304** (185 files, from 2238). New/widened e2e specs for all six, each permission-gated with a full metric walk (Claims/Financial/Compliance isolated via fresh Insurer rows or branch-scoping/BEFORE-AFTER deltas as appropriate). Full api unit suite 2304/2304 confirmed green; full 62-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing throughout — the system ran ~2x slower partway through this work, requiring a manual 180s re-run of `rbac` once to rule out regression vs. machine load (confirmed load). New Playwright specs 3/3 each (one real test-authoring bug caught and fixed in the Financial spec — a `getByText` strict-mode violation); full Playwright suite **282/282** (from 264). `npm run typecheck`/`lint`/`build` (api + web) OK throughout. **Follow-up audit** (re-checked line-by-line against the literal backlog text on a "was this meticulous?" request) found and closed ONE real UI gap: the new combined dashboard page omitted an `insurerId` filter input despite `GET /insurer-performance?insurerId=` already supporting it since #60's original build — added it (insurer table only), with a new Playwright test proving the filter reaches only that request. Re-verified the whole Part E surface: management-reporting api unit suite re-run (24 files/190 tests green), all 7 Part E-related api e2e files re-run live against the test DB (32/32 green), full Playwright suite re-run **283/283** (from 282), a11y suite separately 65/65 — 3 unrelated non-dashboard failures seen once under parallel load re-confirmed clean in isolation (pre-existing flake pattern, not a regression). | No migration, no seed change across all six items — every `dashboard.*.view` permission (and `insurer-performance.view`/`employee-performance.view`) was already pre-seeded. |
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
