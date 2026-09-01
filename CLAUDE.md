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
| 2026-09-01 | Part C #14 (Quote Comparison) landed — **new module** `apps/api/src/modules/comparison/` (+ `repositories/comparison.repository.ts`). `POST /comparison-matrices` (`{ rfqId, scores?: [{ insurerId, insurerQualityScore?, serviceScore? }] }`, `comparison.build`/Placement) **(re)builds** the one `ComparisonMatrix` per RFQ (`rfqId @unique`) from every **current-version** `Quotation` on it — one `ComparisonMatrixRow` each; the objective dimensions (premium/deductible/`limits`/BI period/liability limit/exclusions/conditions/commission rate) live on the linked `Quotation`, so the matrix is **never price alone** (`policy-lifecycle.md` § controls), and rows are ordered **by insurer, not premium**. Shortlisted insurers with no current quote and status ≠ `DECLINED` → `ComparisonMatrix.missingInsurers` (insurer ids); a `DECLINED` one is surfaced separately (computed on read, not stored). Optional per-insurer `insurerQualityScore`/`serviceScore` (0–100, 2dp) are **manual inputs** — there is no Insurer-scoring module (Process 61); `planComparison` (`comparison.config.ts`, pure) 422s on nothing-to-compare / a score for an insurer with no current quote / out-of-range / duplicate. `GET /comparison-matrices?rfqId=` (404 friendly when unbuilt) + `GET /:id` (**new seeded perm `comparison.read`**, Sales/Placement/Manager/Exec). `ComparisonRepository.buildOrRebuild` does upsert-matrix + `deleteMany` + `createMany` rows in ONE Prisma `$transaction` (local exception, like `QuotationRepository.reviseChain`); `@@unique([comparisonMatrixId, quotationId])` (migration `20260901160000` — Prisma-expressible, no raw SQL) backstops a doubled row (`race-safe-invariants.md`). Migration also adds `ComparisonMatrix.builtByUserId` + FK/filter indexes. A build **best-effort** advances `Opportunity QUOTES_RECEIVED → COMPARISON_BUILT` (logged, never thrown — not authoritative). **`ComparisonMatrix` is NOT a `WorkflowTransitionService` entity** (no status) and has **no maker/checker** (a derived artefact; the gate is downstream at #16). Audit row = counts only; its `CREATE` (first build) vs `UPDATE` (rebuild) action comes from a flag `buildOrRebuild` computes **inside the transaction**. The `missing`/`declined` flagged-insurer buckets are **recomputed live on every read** from the current shortlist vs. the matrix rows (so they stay disjoint after a post-build status change); `ComparisonMatrix.missingInsurers` stores the build-time snapshot for the audit counts only. `QuotationModule` now `exports: [QuotationRepository]`; `BuildComparisonDto` is the first `@ValidateNested`+`@Type` DTO (needed under `whitelist: true`). `apps/web/app/(app)/rfqs/[id]/`: a "Comparison" section (`components/comparison/ComparisonSection.tsx` — wide scrollable table + missing/declined callouts + a "· superseded" marker on a row whose quote was revised since the build + Placement-only build/rebuild + optional score grid); no new nav item. **`@code-reviewer` (mandatory — workflow logic + "never price alone" controls rule + carries `Quotation` money) → APPROVE WITH MINORS, no blockers, no lex violations**; minors fixed (live-recompute missing/declined buckets, CREATE/UPDATE flag from inside the tx, "· superseded" row marker, drop a redundant cast, `normalizeScore` money-reuse comment). Carried: no `apps/api` e2e for the comparison module (from #11–13). See README § Known gaps, Part C #14. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the new `comparison.read` permission |
| 2026-09-01 | Access-recertification writes batched (backlog A.2/A.8 follow-up) — `AccessRecertificationService.startCycle` did `createItem` + `audit.record` (2 sequential round-trips) **per active subject**, and `listItemsForReviewer` one `users.getRoleNames()` **per item** (via `Promise.all`, N concurrent queries). Once the shared e2e test DB had ~14 spec files' worth of `makeUser` rows this blew the 30s e2e timeout with a `PrismaClientUnknownRequestError` (`test/rbac.e2e-spec.ts:203`/`:264` — the flake earlier logged as "pre-existing, unrelated"). Now O(1) round-trips: **`AccessRecertificationRepository.createManyItems`** (one `INSERT … RETURNING` via `createManyAndReturn`), **`AuditService.recordMany`** (one `createManyAndReturn` for a batch + per-row anomaly detection — a sync no-op for CREATE/non-sensitive rows; same append-only guarantees as `record()`), **`UserRepository.getRoleNamesByIds`** (one query, keyed by id; `getRoleNames` singular kept for `auth`/`session`). Behaviour identical (same items / reviewer assignment / audit rows). `rbac.e2e-spec.ts` 5/5 in ~18s (was ~69s w/ 2 timeouts); full api e2e **98/98**. `vitest-e2e.config.ts` flake comment updated. | None — no migration, no seed change |
| 2026-09-01 | Part C #15 (Negotiation) landed — **no new module**; negotiation *is* `POST /quotations/:id/revise` from #13 (a round = a NEW `Quotation` version, predecessor kept verbatim). #15 makes the backlog's **"never deleted or replaced"** a real DB-layer guarantee + gives a round a rationale and a history surface. Migration `20260901180000_add_quotation_negotiation` (hand-authored + `migrate deploy`; applied to `db` + `db-test`): `Quotation.negotiationNotes TEXT` + a `BEFORE DELETE`/`BEFORE UPDATE` trigger `prevent_quotation_version_mutation` (same pattern as `prevent_audit_log_entry_mutation`, `20260826083942`) — rejects any `DELETE` of a `Quotation` row, any `UPDATE` of an already-superseded version (`isCurrentVersion = false`), and any `UPDATE` of a live version other than the supersede flip (`isCurrentVersion` true→false, what `reviseChain` issues). Same documented residual risk as the audit trigger (shared `ibms` Postgres role can `SET session_replication_role = replica`; a least-privilege app role is separate infra). Verified: a hand-run 4-case `psql` script against `db-test` + `test/quotation.e2e-spec.ts` (**new** — the quotation module's first e2e, closes that carried gap). `negotiationNotes` (the broker's ask/concession for the round) added to **`ReviseQuotationDto` only** (a v1 `capture` is not a negotiation round); Confidential — `quotationAuditSnapshot` carries only a `hasNegotiationNotes` boolean, never the text. New pure `buildNegotiationHistory` (`quotation.config.ts`): every quotation read's `QuotationChainView` now also carries `history: NegotiationRound[]` — round 0 = opening quote, each later round has `premiumDeltaFromPrevious` (sign-preserved, via `money.util.ts` `subtractMoney`/`formatMoney`), `changedTermFields` (nine versioned terms; a `limits` key reorder counts), and that round's notes. `Quotation` still **NOT** a `WorkflowTransitionService` entity, **no maker/checker** (the gate is the Broker Recommendation #16). `quotation.negotiate` already seeded at #13 (description updated) — **no new permission**, no new nav item. `apps/web/app/(app)/rfqs/[id]/`: the "Quotations" version-history table gains Round / Δ premium / Terms-changed columns + inline round rationale; the revise form gains a "Negotiation notes" textarea. **`@code-reviewer` (mandatory — workflow logic + financial calc + Confidential data + DB migration/trigger) → APPROVE WITH MINORS, no blockers, no MAJOR, no lex violation** (all six mandatory lex checks pass); both MINORs fixed — (1) `premiumDeltaFromPrevious` → `null` on a currency change (no cross-currency subtraction); (2) the supersede-flip trigger now asserts column-by-column that only `isCurrentVersion` moved (`to_jsonb(NEW) - 'isCurrentVersion' IS DISTINCT FROM to_jsonb(OLD) - …`) — function re-applied to `db`/`db-test` + `_prisma_migrations` checksum reconciled (`migrate status` clean); NITs fixed (history diffs against `previousVersionId`; web Δ-sign by string inspection; e2e now does a 2nd consecutive revise + asserts the column-freeze). See README § Known gaps, Part C #15. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`); `db:seed` optional (permission *description* change only — no new permission) |
| 2026-09-01 | Part C #16 (Broker Recommendation) landed — **new module** `apps/api/src/modules/recommendation/` (+ `repositories/recommendation.repository.ts`). Models `Recommendation` / `ConflictOfInterestDisclosure` + the `Recommendation_maker_checker_distinct` CHECK already existed — first consumer. **NOT a `WorkflowTransitionService` entity** (no `status` column — lifecycle is nullable timestamps DRAFTED→APPROVED→SENT; the parent `Opportunity` carries the same progression through the engine, `COMPARISON_BUILT→RECOMMENDATION_DRAFTED→SENT_TO_CLIENT`, best-effort). `POST /recommendations` (`recommendation.draft`/Placement) — one per Opportunity (`opportunityId @unique`→409), points at one **current-version** `Quotation` on one of its RFQs (422), Opportunity must be **at** `COMPARISON_BUILT`; `normalizeRecommendationRationale` (`recommendation.config.ts`, pure) requires a non-empty note for **all six** factors (coverage/price/financialStrength/claimsService/deductible/policyConditions — "never price alone"; unknown key rejected). Two snapshots at draft: `approvalRequired` (recommended premium `>` `Opportunity.targetPremiumThreshold`) and `conflictOfInterestFlagged` (`detectConflictOfInterest`, pure — a comparable competing quote within a **drafted/unsourced 10%** premium band on a commission rate `≥` a **drafted/unsourced 2 pp** lower; `/brain-gap` candidates). `PATCH /opportunities/:id/target-premium-threshold` (**new perm `opportunity.set-target-threshold`/Manager,Exec**) sets/clears it. `POST /recommendations/:id/approve` (`recommendation.approve`/Manager) — 422 not-required, **maker/checker** `assertDifferentActors` (403) + the CHECK, status-conditional `updateMany` (0 rows→409). `POST /recommendations/:id/conflict-of-interest-disclosure` (`conflict-of-interest.disclose`/Placement,Compliance) — 422 not-flagged, one per rec (409), acknowledger `≠` drafter (403); `canReachAnyCustomer` adds `COMPLIANCE_OFFICER`. `POST /recommendations/:id/send` (**new perm `recommendation.send`/Placement**) — 422 while `blockedFromSend` non-empty, 409 sent, status-conditional stamp + best-effort advance. `GET /recommendations?opportunityId=\|customerId=` + `/:id` (**new perm `recommendation.read`**/Sales,Placement,Manager,Exec). Migration `20260901200000_add_broker_recommendation` (hand-authored + `migrate deploy`; `db` + `db-test`): `rationaleFactors JSONB NOT NULL` (add-default/drop-default), `approvalRequired`/`conflictOfInterestFlagged` bools, `coiCompetingQuotationId`/`coiCommissionDiffPercent`/`sentByUserId`, 2 indexes. `Recommendation.coiCommissionDiffPercent` added to `NON_MONEY_DECIMAL_FIELDS` (a rate). Audit snapshot = metadata + money + flags, **never** `rationale`/`rationaleFactors`/`disclosureText` (booleans). Rate arithmetic via `money.util.ts` `toMoney` at `Decimal(5,2)` scale (not `subtractMoney`). `apps/web/app/(app)/opportunities/[id]/`: a "Broker recommendation" section (Manager threshold control, Placement draft form, Manager Approve, Placement/Compliance COI form, Send with block reasons). **`@code-reviewer` (mandatory — approval/workflow logic + financial calc + Confidential data + migration) → CHANGES REQUESTED → resolved.** The MAJOR: the send-gates trusted the draft-time snapshot, so a threshold set — or a comparable competitor quoting — *after* the draft bypassed the gate. Fixed: `RecommendationService.effectiveGates(rec)` re-derives both gates from **live** data (current `Opportunity.targetPremiumThreshold`; `detectConflictOfInterest` re-run over the current current-version quotes on the recommended quote's **RFQ line**) OR'd with the snapshot — a gate can be added late but never silently cleared; `approve`/`disclose`/every read use it too (+2 unit tests, +1 e2e). MINORs: COI disclosure audit `entityId` now the disclosure row's own id; COI competitors RFQ-line-scoped (not the whole Opportunity); `conflict-of-interest.disclose` kept `[PLACEMENT, COMPLIANCE]` with a documented rationale (additive seed can't revoke; `assertDifferentActors` is the structural control) — `/brain-gap` filed to add a Recommendation-drafter → COI-acknowledger row to `maker-checker-segregation.md`. NITs: `send` reads status/threshold off the loaded `rec` (dropped a round-trip). **`/brain-gap` filed + pushed** (`ibms-brain` `eef39d1`): `policy-lifecycle.md` now quantifies "comparable" (10% band) / "materially higher" (2 pp), the deterministic tie-break, the no-rate-→-not-flagged rule, RFQ-line scoping, and the live-recompute-at-send requirement. See README § Known gaps, Part C #16. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the 3 new permissions (`opportunity.set-target-threshold`, `recommendation.read`, `recommendation.send`) |
| 2026-09-02 | Part C #17 (Client Decision Handling) landed — **new module** `apps/api/src/modules/client-decision/` (+ `repositories/client-decision.repository.ts`). The `ClientDecision` model + `ClientDecisionType` (six values) already existed. **NOT a `WorkflowTransitionService` entity** (`decision` is a one-shot enum, not a state machine) and **no maker/checker** (recording the client's stated decision is factual single-actor Sales/Placement work). `POST /client-decisions` (`{ opportunityId, decision, evidenceType, evidenceRef, notes? }`, `client-decision.capture`/Sales,Placement) — one per Opportunity (`opportunityId @unique` → pre-check 409 + `P2002` → 409); precondition checked against **`Recommendation.sentToClientAt != null`** (authoritative — Opp status can lag a #16 best-effort advance; 422 else). `evidenceType` ∈ `signature\|e-signature\|email_confirmation` + non-empty `evidenceRef` required (Part 4.1); `notes` optional + Confidential (audit = `hasNotes` bool). **Six → three routing** (`routeFor`, `client-decision.config.ts`, pure & total): `ACCEPT→PLACEMENT`, `REJECT→CLOSED_LOST`, four `REQUEST_*→RENEGOTIATE`. Route applied as an Opportunity engine walk — `ROUTE_PATH_FROM` indexes the fixed path `[SENT_TO_CLIENT, CLIENT_DECISION, <route>]` so it starts from wherever the Opp sits (RECOMMENDATION_DRAFTED → 3 hops / SENT_TO_CLIENT → 2 / CLIENT_DECISION → 1 / else → logged, not routed). **Best-effort** (logged, never thrown — the `ClientDecision` row + `routeFor` is authoritative; view carries `route`/`routeLabel`/`routingComplete`). `GET /client-decisions?opportunityId=\|customerId=` + `/:id` (**new perm `client-decision.read`**/Sales,Placement,Manager,Exec). Migration `20260902120000_add_client_decision_capture` (hand-authored + `migrate deploy`; `db` + `db-test`): `ClientDecision.notes TEXT` + `capturedByUserId TEXT`. `RecommendationModule` now `exports: [RecommendationRepository]`. `apps/web/app/(app)/opportunities/[id]/`: a "Client decision" section (Sales/Placement form once a recommendation is sent, read-only after). **`@code-reviewer` (mandatory — workflow/routing logic) → APPROVE WITH MINORS, no blockers, no MAJOR, no lex violation.** Minors fixed: (1) `routeOpportunity` re-reads the **live** `Opportunity.status` before every hop (self-healing — a hop a concurrent actor already applied is skipped, not an abort; stops only on a real `transition` failure / reaching the route / an off-path status); (2) collapsed a stacked double "Process 17 —" schema `///` block. NITs: redundant `evidenceRef.trim()` dropped, stale e2e comment fixed. See README § Known gaps, Part C #17. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the new `client-decision.read` permission |

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
