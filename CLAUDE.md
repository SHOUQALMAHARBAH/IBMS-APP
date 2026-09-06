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
| 2026-09-20 | Part C #72-73 (Business Continuity & Disaster Recovery) landed — a plan for every scenario the source names explicitly (system outage, site/office loss, cyberattack/ransomware, key-staff unavailability, insurer-side service interruption); a documented RTO/RPO + last-tested date + next-test-due date per plan. `BcpDrPlan` pre-exists with zero prior application code — the same "dormant model, first real writer" shape #58-71 repeatedly found. `bcp-dr.manage` was already pre-seeded — no seed change needed. **`meta/lex/backup-rpo-rto.md` already covers ONE narrow, already-tested slice of scenario #1 (`system_outage`)** — the database backup/restore drill (weekly CI, real pass/fail on row-count parity + a timed RTO check); its own draft RPO/RTO figures pre-date this process and are not restated. The other four scenarios have NO code-level automation anywhere in this repo — `BcpDrPlan` is a plain record of a plan's existence and test history, not a system that executes the plan. **No sourced test-cadence figure exists for BCP/DR plans generally** — unlike #71's Vendor annual review (an explicit pre-seeded cadence), `nextTestDueAt` is a plain caller-supplied field, never auto-computed; this process is deliberately NOT wired into `SLA_REGISTRY` at all, since BCP/DR cadence is a CBJ operational-resilience concern, a different regulatory domain from the PDPL-sourced SLAs that registry tracks. **Checkbox 1 is answered by a genuine coverage/gap check** — `GET /bcp-dr-plans/coverage` returns all five named scenarios every time with a `hasPlan` flag, not a plain list a caller must verify by eye. `planDocumentId` (a bare scalar) is validated against a real `Document` via `DocumentRepository.findById()`, reachable now that #70 built real Document CRUD. `apps/web/` gains a **"BCP / DR plans"** screen (coverage view with gaps flagged, a create form, per-plan record-test action). **Verification**: +16 api unit → api unit **2102** (156 files, from 2086). New `test/bcp-dr-plan.e2e-spec.ts` **6/6** — permission gating; a 400 on an out-of-set scenario; a 404 on a bad `planDocumentId`; a real create→list(filtered)→get→update→record-test walk with a real linked Document (scenario proven immutable); 404s for an unknown plan; the five-scenario coverage view. Full api unit suite 2102/2102 confirmed green; full 49-file api e2e suite green across 7 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `bcp-dr-plans.spec.ts` 5/5; full Playwright suite 237/237 (from 232). `npm run typecheck`/`lint`/`build` (api + web) OK. | No migration, no seed change — `bcp-dr.manage` was already pre-seeded. |
| 2026-09-20 | Part C #71 (Vendor Management, M07) landed — risk tiering (low/medium/high) before any data share or access grant; a mandatory Data Processing Agreement for Medium/High tier + DPO approval for High tier before the first share; mandatory annual review + confirmation of data return/destruction on termination + access revocation within 2 business days. #67 (Procurement) built the foundational `Vendor` CRUD and explicitly deferred `riskTier`/`annualReviewDueAt`/`terminationDataReturnConfirmedAt`/`accessRevokedAt` to this process — same model, same module, extended not duplicated. **Checkbox 1 has no live call site to enforce against** — `DataSharingApproval` (M08) has zero prior writer and no model represents a generic "access grant" at all; built `computeDataShareReadiness()` as a pure, queryable rule instead of inventing the M08 workflow — an honest gate with no live enforcement call site yet. **`DataProcessingAgreement`'s maker/checker pair already had a DB `CHECK` constraint since the A.5 work, zero prior writer** — this process is that first real writer; `dpa.approve` (DPO only) was already pre-seeded as a DISTINCT permission from `vendor.manage`. **Not the M06 Disposal dual control** — that's a separate, still-unbuilt batch-destruction process; this process's own DPA maker/checker pair is a different, already-named pair. **`vendor_termination_access_revocation` (2 business days) needed a genuinely NEW SLA registry entry** — unlike this same process's own `vendor_annual_review` (already pre-seeded), the lex table had no row for it at all; added to both the lex table and the registry, sourced from the backlog's own text. `Vendor` has no explicit "terminated" status — termination is `terminationDataReturnConfirmedAt` going null-to-set, gated by a mandatory explicit attestation; `accessRevokedAt` is a separate, subsequent stamp requiring termination first. Risk tiering auto-schedules the annual-review SLA on the first Medium/High tiering only. No new permission, no migration — both `vendor.manage`/`dpa.approve` were pre-seeded. `apps/web/` gains a **vendor detail screen** (risk tiering, readiness check, DPA lifecycle, termination/revocation). **Verification**: +42 api unit → api unit **2086** (154 files, from 2044). Extended `test/vendor.e2e-spec.ts` to **8/8** (from 4) — the full risk-tiering→review walk; the full DPA maker/checker lifecycle + readiness gate (403 self-approval, 409 double-approval); Low-tier readiness with no DPA; termination→revocation with order-guarding and double-execution 409s. Full api unit suite 2086/2086 confirmed green; full 48-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `vendor-detail.spec.ts` 5/5; full Playwright suite 232/232 (from 227). `npm run typecheck`/`lint`/`build` (api + web) OK — one real a11y catch (an unlabeled risk-tier `<select>`), fixed. | No migration, no seed change — `vendor.manage`/`dpa.approve` were already pre-seeded. |
| 2026-09-20 | Part C #70 (Document Management) landed — full version control (previous/next version) + mandatory classification + a deletion lock disabled by default except via a logged privileged override (`deletionOverrideByUserId`); plus enforcing the "highest classification present" rule (`PRIV-STD-02` §6.7) when a file/record mixes classification levels. `Document` (Part 4.2, the electronic Insurance File) pre-exists with THREE prior writers (Policy issuance/attach #18-19, Claim documentation #25, Customer onboarding #3-4), each only ever creating a version-1 row — `versionNumber`/`previousVersionId` and `deletionLocked`/`deletionOverrideByUserId` had sat dormant since before this process; `audit-trail.repository.ts`'s own `findDocumentVersionChain` doc comment already said "no application code creates a second version yet" — a READ-side capability (#57's External Auditor lens) had existed for LONGER than any writer. **Version control mirrors `QuotationService.revise` exactly**: `id` must be the chain's own current (leaf) version — a superseded id 422s; a genuine concurrent double-version loses `previousVersionId`'s own `@unique` constraint and 409s. A new version's `category`/`policyId`/`customerId` are inherited from its predecessor — only `fileName`/`storageRef`/`classification` can change per version. **Deletion is a single-actor privileged override, NOT the M06 Disposal dual control** — that's a separate, still-unbuilt process (`DisposalBatch`, Department Manager + DPO); #70's own singular field and its pre-seeded single-code permission (`document.delete-override`, `[ADMIN, DPO]`) both anticipate the narrower shape instead. **A document can only be deleted from the leaf of its own chain — an APPLICATION-level guard, not a DB one**: `Document_previousVersionId_fkey` is `ON DELETE SET NULL`, not `RESTRICT` — a documented, deliberate limitation; a document still linked to a `ClaimDocument` also can't be deleted, backstopped there by a real DB `RESTRICT`. The "highest classification present" rollup is scoped to `Document.policyId` only, matching the schema's own "every Policy resolves to ONE electronic Insurance File" framing. `#70`'s new `document.manage` routes deliberately don't duplicate `#57`'s existing `document-history.read` compliance-forensics lens — a plain operational browse instead, since the people who upload/version documents mostly can't reach that route. No new permission, no migration — both permissions were pre-seeded (Domain H's "seed before code" pattern holding again after #69 broke it). `apps/web/` gains a **"Documents"** screen (policy-scoped lookup, per-row version/unlock/delete actions, a classification-summary lookup). **Verification**: +21 api unit (`document.config.spec.ts` 6, `document.service.spec.ts` 15) → api unit **2044** (152 files, from 2023). New `test/document.e2e-spec.ts` **6/6** — permission gating (`document.manage` vs `document.delete-override` checked separately); create-version → 422 on a superseded id; the full lock/unlock/delete lifecycle; 409 deleting a document with a newer version even once unlocked; 409 deleting a document still attached to a claim; the classification-summary rollup + a 404 for an unknown policy. Full api unit suite 2044/2044 confirmed green; full 48-file api e2e suite green across 8 foreground sub-batches — one confirmed-transient environment hiccup and one confirmed-transient TOTP-timing flake this run (both unrelated files, re-confirmed clean on isolated re-run), both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `documents.spec.ts` 5/5; full Playwright suite 227/227 (from 222). `npm run typecheck`/`lint`/`build` (api + web) OK — two real lint catches (unescaped apostrophes in the web page's prose; a TS literal-type inference gap in the Playwright spec's mutable fixture), both fixed. | No migration, no seed change — `document.manage`/`document.delete-override` were already pre-seeded. |
| 2026-09-19 | Part C #69 (Cybersecurity) landed — backlog's own annotation: "fully covered by Part A + `IncidentReport` + `InformationAsset`." Verified rather than accepted (the #68 discipline applied again) — and this claim was **overstated more than #68's case**. Part A's cybersecurity-relevant items (A.1 Auth/Sessions, A.3 Encryption/Key Management, A.4 Immutable Audit Trail, A.9 Data Masking, A.10 Infra/Deployment) are real but each carries its own already-tracked gap (hardware-token MFA, a real KMS/HSM, encryption-at-rest, unwired `assertSecureChannel`/`assertExportAllowed` callers, "scaffolded, not achieved" env separation) — all already in this README's own § Known gaps, none restated. `IncidentReport` (#55/M09) is genuinely real — a working "unified security + personal-data breach workflow" per its own doc comment — but carries no dedicated cyber/category field, just free-text `title`/`description` + a `severity` string. **`InformationAsset` (ISO 27001 Clause 8.1 asset inventory) was the one genuine gap: completely dormant, zero prior application code anywhere** — the same "dormant model, first real writer" shape #58-67 repeatedly found. Built its foundational CRUD: create/list(filtered by `assetType`/`classification`)/get/update on the model's own four fields — the #67 `Vendor` "minimal CRUD only" scope. `assetType` has no DB enum but is validated app-side against the model's own doc-comment 6-value set (`ASSET_TYPES`); `ownerUserId` is a bare scalar with no Prisma relation (the `Opportunity.createdByUserId` shape), validated against a real `User` via `UserRepository.findById()` in the service layer (404 if not found) — the #66 `Employee.userId` link-validation precedent. **This is Domain H's FIRST item to break the "seed before code" pattern** — #66/#67 both found their permissions already pre-seeded; `information-asset.manage` (`[SYSTEM_SECURITY_ADMINISTRATOR, COMPLIANCE_OFFICER]`) had no pre-seeded grant, requiring a genuine seed-data change and a re-seed of both dev and test databases (151 → 152 permissions). `apps/web/` gains an **"Information Assets"** screen (list + create + inline rename, the `vendors` page shape). **Verification**: +9 api unit (`information-asset.service.spec.ts`) → api unit **2023** (150 files, from 2014). New `test/information-asset.e2e-spec.ts` **7/7** — permission gating; a 400 rejecting an out-of-set `assetType`; a 400 rejecting a `classification` outside the `DataClassification` enum; a 404 creating an asset owned by a non-existent user; a real create→list(filtered)→get→update walk; a 404 reassigning to a non-existent owner on update; 404s for an unknown asset on GET/PATCH. Full api unit suite 2023/2023 confirmed green; full 47-file api e2e suite green across 8 foreground sub-batches, both chronic flakes (`rbac`, `up-sell`) passing with `--testTimeout=90000`. New Playwright `information-assets.spec.ts` 4/4; full Playwright suite 222/222 (from 218). `npm run typecheck`/`lint`/`build` (api + web) OK. | Run `npm run db:seed` (new `information-asset.manage` permission; already applied to dev and test DBs during this build). No migration. |
| 2026-09-19 | Part C #68 (Internal Information Technology) **verified, not built** — the backlog's own annotation claims it's already covered by A.10 (environment separation) and "Part 10.5" (change management with security sign-off before deployment), no standalone data table needed. This process did NOT take that claim at face value. **"No standalone data table" holds up** — #68 names no business-entity concern, so this is a genuine #47/#50 "verified-covered" shape, not a skipped build. **But the coverage claim is overstated on the other two counts**: (1) A.10's Dev/Test/UAT/Prod separation is THIS SAME README's own § Known gaps admission of "scaffolded, not achieved" — three local docker-compose Postgres instances, no real UAT/Prod deployment target; (2) "Part 10.5" as a distinct control has NO independent definition anywhere in this repo or `ibms-brain` — grepped exhaustively, it appears nowhere except inside the #68 annotation itself; it's the backlog author's own gloss on A.10's combined "Part 10.4/10.5" citation. The closest real artifact (DAST in CI) is explicitly non-blocking, and no deployment pipeline exists for a sign-off gate to attach to. No separate build was made — this verification pass IS the process's completion — but its coverage reads as "the same infra gaps A.10 already tracks," not "done." | Nothing to run — no code changed. README.md updated with the full verification (§ Known gaps cross-reference, not a duplicate); no `ibms-brain` change (this is ibms-app's own infra-status fact, not generalizable brain content). |

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
