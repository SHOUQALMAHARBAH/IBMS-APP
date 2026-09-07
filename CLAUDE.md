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
| 2026-09-07 | **Part F item #5 — locale-aware number/date formatting — PARTIALLY built: number/date formatting only (sub-problem #1 of 3)**, an explicit user scoping decision (Hijri calendar and multi-currency for reinsurance deferred as future work). New shared `apps/web/lib/i18n/format.ts` (`formatMoney`/`formatDate`/`formatDateTime`) replaces ~9 duplicated local `money()`/`fmtMoney()`/`fmtDateTime()` implementations across `components/**` and `app/(app)/**/page.tsx`, every call site threading the live `useLanguage()` value through. Locale tags empirically verified against Node's own ICU before being chosen: a region-qualified Arabic tag (`'ar-JO'`) silently switches to Eastern Arabic-Indic numerals for money amounts — an unwanted surprise — so bare `'ar'` (Western numerals, genuine Arabic date order) plus `'en-GB'` (`DD/MM/YYYY`, matching the existing `audit-anomaly-detection.service.ts` precedent) was used instead, confirmed with the user directly via `AskUserQuestion`. A whole-codebase grep confirmed zero remaining `toLocaleString`/`toLocaleDateString` calls and zero remaining local money/date formatter definitions anywhere in `apps/web` afterward. **Verification**: +7 web unit tests (`format.test.ts`) → web unit **16/16** (from 9); +1 new Playwright spec (`locale-formatting.spec.ts`, drives the live language switcher against a real page, proving a rendered date changes format on switch while the same money cell's digits stay identical) → full web suite **294/294** (from 287, 228 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (web) OK. No backend files touched, confirmed via `git diff --stat` (25 files, all `apps/web`). | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #5 covers/does NOT cover" before assuming item #5 is fully closed — it is NOT: Hijri calendar and multi-currency remain open future work. |
| 2026-09-07 | **Part F item #4 — Arabic-first input — PARTIALLY built: correct Arabic sorting only**, an explicit user scoping decision. The backlog bullet ("Arabic keyboards, national-ID-convention name fields, correct Arabic sorting") bundles three sub-problems of very different size — presented with that before implementing, the user chose sorting only, deferring keyboards and name-splitting as documented future work (name-splitting reads as a real schema migration touching every name field/form/consumer, far bigger than the other two). Every `localeCompare(x, 'en')` sorting a genuinely bilingual name/label field switched to `'ar'` (`finance.config.ts` ×4, `loss-ratio.config.ts`, `profitability-analysis.config.ts`); two DB-level sorts on `Insurer.name` using plain Postgres collation (`commission.repository.ts`, `rfq.repository.ts`) converted to a fetch-then-JS-sort with the same comparator. `'ar'` is HARDCODED, not the caller's own language preference — a second explicit scoping decision. Deliberately NOT touched: `sla-dashboard.config.ts` (a fixed, always-English workflow-name label) and `role.repository.ts`'s `Role.name` (a fixed enum) — confirmed by reading the actual field source, not assumed. A genuine, empirically-verified test proves the mechanism: `"إبراهيم للتأمين"` sorts before `"أحمد للتجارة"` under `'ar'` but after it under `'en'`. **Verification**: +1 unit test → api unit **2321/2321** (from 2320); targeted + adjacent e2e sweep (`commission`, `claim`, `financial-dashboard`, `sla-dashboard`, `claims-dashboard`, `profitability-analysis`) 25/25 green. `npm run typecheck`/`lint`/`test` (api) OK. No web files touched. | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #4 covers/does NOT cover" before assuming item #4 is fully closed — it is NOT: Arabic keyboards and national-ID-convention name-splitting remain open future work. |
| 2026-09-07 | **CLOSES Part F item #3 of 8** — bidirectional (bidi) text handling for mixed-content fields, after item #1 (language switch) and item #2 (RTL layout). Distinct from item #2 (whole-screen layout) and `PrivacyNoticeDisplay`'s `textAr`/`textEn` (two whole separate fields) — item #3 is about a SINGLE field that may itself mix Arabic and Latin script (a legal name, an address, an insurance line next to a Latin policy number). No concrete field list existed in the brain beyond 4 example categories in `verification-contract.md` — a schema + render-site grep survey found the real at-risk fields. Fixed across ~30 files via two native mechanisms: every mixed-content value wrapped in a `<bdi>` element (isolates bidi runs, auto-detects direction), with adjacent concatenated values (e.g. `insuranceLine · policyNumber`) each wrapped SEPARATELY so the separator stays stable; `dir="auto"` added to every capture input for a field typeable in either script. Fixed once at the shared `ProfileField` primitive rather than per-call-site. Confirmed `WatchlistEntry`/`ScreeningResult` fields are never rendered on the frontend — nothing to fix there. **Verification**: +1 new Playwright spec (`bidi-text.spec.ts`, 3 tests) → full web suite **227/227** non-`@a11y` + **66/66** `@a11y` green. `npm run typecheck`/`lint`/`build`/`test` (web) OK; no backend gate applies (web-only change). | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #3 covers/does NOT cover" before starting item #4 — item #3 is mixed-script isolation, not translation or Arabic keyboard/collation support. |
| 2026-09-07 | **CLOSES Part F item #2 of 8** — full RTL layout (navigation, forms, tables, charts genuinely mirrored, not just mirrored text), after item #1's instant language switch. Found ~60 files' worth of item #2 work already sitting uncommitted in the working tree at session start — a prior session's unfinished conversion of physical CSS (`textAlign:'left'/'right'`, `marginLeft/Right`, `borderLeft/Right`) to logical equivalents (`start`/`end`, `marginInlineStart/End`, `borderInlineStart/End`), relying on `dir="rtl"` cascading from `<html>` (item #1) plus plain `flexDirection: row` and native `<table>` column order to mirror for free, plus a new untracked `apps/web/e2e/rtl-layout.spec.ts` asserting real bounding-box mirroring (not computed-style keywords, which read back unchanged for a logical value in both directions). Reviewed the entire diff file-by-file — no mistakes found; confirmed via whole-codebase grep that zero physical-direction CSS properties remain anywhere in `apps/web`. **Charts confirmed vacuously N/A** (no chart/graph/SVG/canvas visualization exists anywhere in this app yet — only Next.js's own boilerplate public assets matched a grep for `recharts`/`chart.js`/`d3`/`<canvas>`/`<svg>`); forms and native `<table>` mirroring both confirmed already-structural, not new work. **Verification**: +1 new Playwright spec (`rtl-layout.spec.ts`, 2 tests) → full web suite **224/224** non-`@a11y` + **66/66** `@a11y` green (one transient `write UNKNOWN` process-contention failure under full-suite parallel load, re-confirmed clean 27/27 in isolation). `npm run typecheck`/`lint`/`build`/`test` (web) OK; api suite re-run as a sanity baseline (2320/2320, unaffected — web-only change). | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #2 covers/does NOT cover" before starting item #3 — item #2 is layout mirroring only, the ~80 other screens' text is still English-only. |
| 2026-09-07 | **Full-codebase code-review audit** (10 parallel `@code-reviewer` batches, all 35 api modules + the whole web frontend) found and fixed 2 BLOCKER + 8 MAJOR findings; ~20 MINOR/NIT items logged to a new root `IMPROVEMENTS.md`. **BLOCKERs**: `WorkflowTransitionService.transition()` (the ONE shared status-transition engine 30+ services depend on) committed its status write and TRANSITION audit row as two separate round-trips, not one transaction — fixed via a single `$transaction` (new `AuditService.recordInTransaction()`/`runAnomalyDetection()` pair, so anomaly detection's own best-effort writes still run after commit); the JWT access-token signing secret silently fell back to a hardcoded dev string with no production fail-fast, unlike every other secret in this codebase — fixed with a shared `jwtSecret()` helper + a new `assertJwtSecretConfigured()` boot-time check in `main.ts`. **MAJORs**: the same read-then-unconditionally-write race gap recurred in Access Recertification's `decide()`, password-reset's `resetPassword()`, and Insurance Program's `reassemble()` (a previously-accepted "single-actor pool" premise that no longer holds — Placement is a book-wide role grant) — all three now use a status-conditional `updateMany`/transactional row-lock, each with a new concurrent-race test confirmed live against `db-test`. Compliance Dashboard and KPI Dashboard both omitted `isSensitiveDataAccess: true` despite aggregating KYC/Complaint/DSR/AML/Claim data — fixed (a unit test asserting the wrong value was also corrected). `PaymentChannel`'s `label`/`bankName` were missing the `NO_FULL_ACCOUNT_NUMBER` guard every comparable free-text field elsewhere already carries. A stale premise in `meta/context/consent-management.md` ("no web UI exists for an individual claim record") was false — `ClaimSection.tsx` is exactly such a UI — now wired to `ConsentCaptureWidget` (6 of 7 touchpoints; the 7th is genuinely blocked on `InsuredPerson` having zero CRUD). **Verification**: api unit **2320/2320** (from 2316); targeted e2e (`auth`, `rbac` with its established `--testTimeout=180000`, `insurance-program`, `invoice`) all green; web typecheck/lint/build/unit/full Playwright suite green after the consent-widget change. `npm run typecheck`/`lint` (api + web) OK throughout. | No migration, no seed change. Read the new root `IMPROVEMENTS.md` for the ~20 logged MINOR/NIT items before assuming this audit's scope was exhaustive — the web-frontend batch sampled ~45 of ~90 pages, logged in its own coverage note. |
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
