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
| 2026-09-07 | **PART E (backlog Process #64) COMPLETE** — Sales + Policy + Claims + Financial + Compliance Dashboards (5 fresh builds) + Insurer & Employee Performance Dashboard (verify + 1 small gap closed) + the cross-cutting filter/bilingual bullet, all closed out. Worked one dashboard at a time (the Part D pacing default). **Sales**: `GET /dashboards/sales` — leads/premium(new vs renewal)/commission/cross-sell/up-sell. **Policy**: `GET /dashboards/policy` — active/expiring (live) + new-issued/cancelled (period-scoped, `Endorsement.appliedAt`-dated). **Claims**: `GET /dashboards/claims` — open/closed/outstanding/ageing/loss-ratio-by-insurer; no period range, `asOf` instead; widened backlog #30's `LOSS_RATIO_GROUP_BY`. **Financial**: `GET /dashboards/financial` — closes the exact gap #40's own DTO deferred as "a Part E dashboard refinement," reusing #40's pure builders + widening 3 repositories. **Compliance**: `GET /dashboards/compliance` — 7 sections (KYC/complaints/AML+self-approval-scan/regulatory-calendar/DSR/breach-register/DPIA), the DPO Workspace aggregate shape; no period range AND no insuranceLine/insurerId anywhere (first dashboard where 2 whole filter dimensions apply nowhere). **Insurer & Employee Performance**: a THIRD outcome shape — Part E's own permission grid already names `insurer-performance.view`+`employee-performance.view` (backlog #60/#61, not a new dashboard.*.view code) as this 6th dashboard's pair, confirming #60/#61 already built it; re-ran both suites, confirmed "4 axes"/"KPI achievement" are literal matches to existing models, then closed ONE small gap (a `branchId` filter on `GET /employee-performance`, additive) and added a lightweight combined `/dashboards/insurer-employee-performance` page. `GET /insurer-performance` deliberately untouched (a book-wide per-insurer score, not filterable by branch without recomputing a different metric). **Cross-cutting bullet resolved**: the filter half is honestly satisfied per-dashboard (each dashboard's own entry documents which of branch/line/insurer/period genuinely apply); the bilingual half is explicitly NOT satisfied anywhere in the app and is Part F's own unbuilt scope, not a Part E deliverable. No dashboard needed a migration or new permission; only Financial needed to widen existing repositories, Insurer/Employee needed one small filter addition. **Verification**: +16/+11/+14/+8/+16/+1 api unit across the six items → api unit **2304** (185 files, from 2238). New/widened e2e specs for all six, each permission-gated with a full metric walk (Claims/Financial/Compliance isolated via fresh Insurer rows or branch-scoping/BEFORE-AFTER deltas as appropriate). Full api unit suite 2304/2304 confirmed green; full 62-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing throughout — the system ran ~2x slower partway through this work, requiring a manual 180s re-run of `rbac` once to rule out regression vs. machine load (confirmed load). New Playwright specs 3/3 each (one real test-authoring bug caught and fixed in the Financial spec — a `getByText` strict-mode violation); full Playwright suite **282/282** (from 264). `npm run typecheck`/`lint`/`build` (api + web) OK throughout. | No migration, no seed change across all six items — every `dashboard.*.view` permission (and `insurer-performance.view`/`employee-performance.view`) was already pre-seeded. |
| 2026-09-07 | Part D items #4-9 landed — **CLOSES Part D's full 9-system checklist** (after Consent #1, DSR #2, Retention & Disposal #3). Six systems in `apps/api/src/modules/pdpl/`: Cross-Border Transfer (`cross-border-transfer.approve` DPO-only, creation IS approval, rejects "Jordan" as a destination); Data Sharing/M08 (`DataSharingApproval` maker/checker, the FIRST live caller of backlog #71's `computeDataShareReadiness()` — a regulatory channel skips only the vendor-risk check, never classification/channel); DPIA Screening/M10 (5-question form, `dpia.review` DPO-only gates submission too, any Yes → 5-business-day review, Full-DPIA escalation is a manual call with no numeric threshold — `outcome` can't use `WorkflowTransitionService` since the column isn't literally named `status`); Notices (creation IS publishing, append-only versioning via a NEW `@@unique([touchpoint, versionNumber])` migration, a new `PrivacyNoticeDisplay` widget mounted at the same 5 touchpoints + lead capture Consent already reached); Records of Processing Activities (plain mutable CRUD + an `EXPORT`-audited register dump); a DPO Workspace aggregate screen (a genuinely NEW `dpo-workspace.view` permission, reads 6 registers with zero cross-module service dependency). **Found and fixed 2 real bugs before push**: Cross-Border Transfer was mislabeled "M05" across 6 files (M05 is already a different, existing system — both it and Notices actually cite "Part 6.2" with no M01-M12 module name applying at all); `GET /privacy-notices/current` returning a bare `null` sent an EMPTY response body (NestJS's real behavior for `null`/`undefined` returns, not the JSON literal `null`) — fixed by wrapping in `{ notice: ... }`. Also corrected 3 stale `dormant: true` flags in `internal-controls.config.ts` left over from earlier sessions (`DisposalBatch`/`DataProcessingAgreement`/`DataSharingApproval` all now have real writers) plus the e2e assertion that expected the stale value. **Verification**: +67 api unit → api unit **2238** (175 files, from 2171). 6 new e2e spec files, 32 tests, all green; full 57-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. 6 new Playwright spec files, 18 tests — one real a11y bug caught and fixed (`scrollable-region-focusable` on the RoPA table's scroll wrapper, missing `tabIndex`/`role="region"`); full Playwright suite **264/264** (from 246). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:migrate:deploy` (new migration `20260915120000_add_privacy_notice_version_unique`) and `npm run db:seed` (new `dpo-workspace.view` permission, 154 total) — both already applied to dev and test DBs during this build. |
| 2026-09-07 | Part D item #3 (Data Retention & Secure Disposal, M06) landed — worked one Part D item at a time after Consent (#1) and DSR (#2). `RetentionScheduleItem`/`LegalHold`/`DisposalBatch`/`CertificateOfDestruction` all pre-existed since the initial migration but only `RetentionScheduleItem` had a single seeded row and a reader — this build is the first real writer across all three sub-systems: the retention-period table CRUD (a NEW `retention-schedule.manage` permission, `[COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER]`, since no "Legal Counsel" role exists in this RBAC model), Legal Hold place/review/release (a 6-month re-basing SLA via the DSR `applyExtension` start-then-resolve shape), and the full dual-control disposal workflow (nominate→manager-approve→dpo-approve→execute→certificate→close). **Closed a previously-flagged schema gap**: `RetentionScheduleItem.recordCategory` gained a genuine `@@unique` constraint (migration `20260914120000`); the seed script's hand-rolled find-then-create/update became a real Prisma `upsert`. **`DisposalBatch`'s "dual-control... two different users" wording only enforces HALF of what it names** — no `managerApprovedByUserId` column exists, only a timestamp; the pre-existing DB CHECK compares only `dpoApprovedByUserId` against `nominatedByUserId`, so `MANAGER_APPROVED` is a self-transition checkpoint, not a second distinct human actor. **The Legal-Hold exclusion check is re-derived from live data at every dual-control step** (nominate, manager-approve, AND dpo-approve) — the #16 Broker Recommendation precedent, since a hold placed between steps must still block execution. `execute()` remains a staff ATTESTATION (a status stamp + `method` field), never a live delete — deliberately avoiding a bypass of `AuditLogEntry`'s immutability trigger. `apps/web/` gains a **"Retention & Disposal"** screen (3 stacked sections: schedule/holds/batches, each independently permission-gated). **Verification**: +51 api unit (6 new spec files) → api unit **2171** (163 files, from 2120). New `test/retention-disposal.e2e-spec.ts` **2/2** — the full lifecycle walk (schedule create→409 duplicate→Legal Hold placed→disposal blocked while held (422)→hold released→nominate→manager-approve→403 same-manager DPO-approve attempt→distinct-DPO-approve→execute→422 close without certificate→certificate→close→schedule confirm→422 edit-after-confirm) plus a second test covering permission-denial and Legal-Hold review re-basing. Full api unit suite 2171/2171 confirmed green; full 51-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `retention-disposal.spec.ts` 3/3; full Playwright suite 246/246 (from 243). `npm run typecheck`/`lint`/`build` (api + web) OK — lint caught 5 real type-safety errors on first run (an untyped `let row` losing its Prisma type across a try/catch; two nested `expect.objectContaining()` calls; a bare `expect.any(Date)` as an object-literal property value), all fixed following the `dsr.service.spec.ts` "capture the mock call arg into a typed const" precedent rather than suppressed. | Run `npm run db:migrate:deploy` (new migration `20260914120000_add_retention_disposal_widening`) and `npm run db:seed` (new `retention-schedule.manage` permission) — both already applied to dev and test DBs during this build. |
| 2026-09-06 | Part D item #2 (Data Subject Requests, M04) — **re-verified, not built**. Worked one Part D item at a time after Consent (item #1); this checklist's own DSR clause ("logged the same business day regardless of channel, an identity-verification step, SLA computation (15/10 business days + an Access-only extension), a DPO handler assignment, a mandatory 'partially fulfilled' path when a retention flag is still open, never closeable as 'fully fulfilled'") maps onto ALREADY-BUILT M04 functionality clause-by-clause — the #47 KYC/#50 Conflict-of-Interest/#68 Internal IT "verified, not built" shape, confirmed by re-running the full suite rather than trusting memory that "this was built already." **The seed data's own permission descriptions quote this exact wording near-verbatim** (`dsr.log`: "the same business day it is received"; `dsr.close`: "never closeable while a retention flag is open") — strong evidence M04 was built directly against this same source text originally. No code changes. **Verification**: api unit 53/53 (`dsr.config.spec.ts`/`dsr.service.spec.ts`, unchanged); `test/dsr.e2e-spec.ts` 3/3 (the ACCESS full-lifecycle walk with extension + SLA timers + mandatory DPO sign-off; the DELETION retention-hold attestation + partially-fulfil path; reject + list/filter); Playwright `dsr.spec.ts` 3/3 — all re-confirmed green with zero regression from the 5+ sessions of unrelated work since M04 originally shipped. | None — no code, migration, or seed change. |
| 2026-09-06 | Part D §5.1 (Consent) touchpoint wiring landed — the first item of Part D's full 9-system checklist, worked one item at a time per user direction. The backlog names 7 explicit consent touchpoints (lead capture, onboarding/KYC, needs & risk assessment, RFQ/market placement, claims, Group Medical/Life & Motor Fleet, renewal & cross/up-sell); M03's original build (see the earlier Consent Management entry, now rotated out of this table) shipped only a generic, unwired capture screen. **5 of 7 now wired; 2 confirmed with the user (via AskUserQuestion) as a deliberate, documented gap** — Claims (no web UI for an individual claim exists anywhere in `apps/web`) and Group Medical/Life & Motor Fleet (maps to `InsuredPerson`, which has ZERO CRUD anywhere) both need a genuinely separate prerequisite module built first, not a Consent fix. **Lead capture needed a real schema change** — `ConsentRecord` gained a third optional owner column, `leadId` (migration `20260913120000`, FK to `Lead`, `ON DELETE SET NULL`), since a Lead pre-dates a Customer/InsuredPerson row entirely. Exactly-one-of-three is a NEW, Consent-local `hasExactlyOneConsentOwner` — deliberately not a generalization of the shared `common/dto.util.ts#hasExactlyOneOwner`, which DSR (M04) also depends on with a different two-way shape. `LeadRepository.create()` now creates the Lead + its lead-capture `ConsentRecord` in ONE `$transaction` (a deliberate, documented local exception to this codebase's no-`$transaction` convention, the `EmployeeRepository.terminate()` "create-together" shape); `Lead.marketingConsentGranted` (the pre-existing boolean) is unchanged, the new row is additive. `CreateLeadDto` gained a new mandatory `consentTextVersion` field — a real, intentional breaking change to `POST /leads`, not an oversight; every existing caller (5 e2e files, the web intake form) was updated. **The other 4 touchpoints (onboarding/KYC, needs & risk assessment, RFQ/market placement, cross/up-sell) needed no backend capability change** — a single new shared web component (`ConsentCaptureWidget.tsx`) mounted on their existing detail pages was the whole fix, since the gap was UI-reachability, not a missing capture mechanism; Needs Assessment/RFQ each resolve their `customerId` via an ALREADY-INJECTED sibling repository in the service layer (not a widened shared Prisma type — that approach was tried and reverted as more invasive). **Verification**: +9 api unit → api unit **2120** (from 2111). Extended `test/lead.e2e-spec.ts` (+1, now 15/15) and `test/consent-record.e2e-spec.ts` (+1, now 2/2) for the leadId path. Full api unit suite 2120/2120 confirmed green; full 50-file api e2e suite green across 8 foreground sub-batches (one confirmed-transient TOTP-timing flake in `auth.e2e-spec.ts`, re-confirmed clean in isolation), both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. Full Playwright suite **243/243** (from 242) — including a real bug caught mid-verification: the RFQ detail page crashed outright in Playwright because the shared mock RFQ fixture lacked the new `opportunity.customerId` field the page now reads unconditionally; fixed the fixture. `npm run typecheck`/`lint`/`build` (api + web) OK — one real lint catch (the same `react-hooks/set-state-in-effect` false positive `internal-controls/page.tsx` hit before; same async-IIFE fix). | No seed change. Run `npm run db:migrate:deploy` (new migration `20260913120000_add_consent_record_lead_id`) — already applied to dev and test DBs during this build. `POST /leads` callers must now supply `consentTextVersion`. |
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
