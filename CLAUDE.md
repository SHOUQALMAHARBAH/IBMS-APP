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
| 2026-09-18 | **Custom office-scoped RBAC, PHASE 1 of 5 — roles became per-office data, and authorization stopped resolving by name. Two latent cross-tenant leaks were live the moment the constraint changed, and a third bug locked every user out of everything until it was found.** `Role.name` was globally `UNIQUE`; it is now `@@unique([organizationId, name])`, plus `organizationId`/`nameAr`/`nameEn` and RLS. That constraint change is what made the old lookups a leak rather than a style problem: `PermissionRepository.findCodesForRoles` filtered `role: { name: { in } }`, which once two offices can each define a "Manager" returns BOTH rows and hands the caller their **UNION**; and `PermissionsService` cached under `[...roleNames].sort().join(',')`, serving one office's answer to the other for up to a minute. Both now key on `roleId` (uuids, unique across every office), and `AuthenticatedUser` carries `roleIds` beside the names it keeps for display. **The third bug is the one worth reading.** The first migration gave `RolePermission` an RLS policy scoped through a JOIN to `Role`, specifically to avoid denormalizing `organizationId` where a drifted copy would be the row granting access. That policy can never be satisfied: `tenantScopeExtension` sets `app.current_org_id` **only for models that CARRY `organizationId`**, so `current_setting` was always NULL, every permission read returned empty, and users authenticated fine and then 403'd everywhere — `/auth/me` showed `roles: ["SALES_RELATIONSHIP_OFFICER"]` beside `permissions: 0`. A second migration adds the column and answers the drift worry **structurally** instead: a composite FK `(roleId, organizationId)` → `Role(id, organizationId)` makes a disagreeing grant fail to INSERT, proven by attempting one. **MIGRATION preserved access exactly.** The 11 shared rows are ADOPTED by the lowest-id organization using each and COPIED for the others — so the adopting office's `UserRoleAssignment` rows never move — and an office gets only the roles it actually used: `default` keeps 11, `demo-office-b` gets exactly its 8, with no DPO/Executive/External-Auditor row it never had. The blocking gate was a per-user effective-permission diff before vs after: **empty, 31/31 users, byte-identical md5**. **Verification**: typecheck 6/6, lint 3/3, build 3/3; unit **api 2983 (+13) · web 69 · db 24**; api e2e **75/75 spec files** green across seven batches (`tenant-isolation` 33/33, +6 new), contract 4/4.  **CI then caught a second thing every local gate had missed: `prisma/seed.ts` was typechecked by NOTHING.** `packages/db/tsconfig.json` sets `"include": ["src"]`, so the seed and its seed-data modules were outside the program — `npm run typecheck` passed 6/6 across the monorepo while the seed still wrote the pre-migration `Role` shape and could not run at all. It failed on the one CI step no local script covers, on a database fresh enough to need a CREATE rather than an upsert-existing. A new typecheck-only `packages/db/tsconfig.seed.json` (a second config, because the build's `rootDir: "src"` makes widening the existing `include` a TS6059 error) is now wired into `db`'s `typecheck` — and it immediately caught a real defect in the very fix that motivated it: the edit that added `nameEn`/`nameAr` to `RoleSeed` had dropped `description`, which ran fine because types are erased. Verified by dropping and recreating a scratch database, migrating and seeding it from empty, twice. | **An RLS policy on a table the extension does not scope is not defence in depth — it is an outage waiting for a deploy.** The scoped set is derived from the DMMF as "carries `organizationId`", so a policy reading `app.current_org_id` on any other table matches nothing, forever. `tenant-scope.extension.spec.ts` now guards this: every RLS-protected model must be in `TENANT_SCOPED_MODELS`. **`tenant-scope.extension.ts` itself was never touched** — adding the column is what brings a model under Layer 1, which is the whole argument for deriving the set from the schema. **Two lists still FAIL OPEN and are Phase 2's first job**: `ALWAYS_MFA_ROLES` and `PRIVILEGED_ROLES` match on role name, so a custom role silently qualifies for the trusted-device MFA skip. Not yet exploitable — no custom role can exist until Phase 3's Role screen — so **Phase 2 must land before Phase 3**. The five visibility lists fail CLOSED by contrast, and the recertification reviewer pool would refuse to start a cycle for a custom-role-only office. **`maker-checker.util.ts` is untouched and needs no change**: 62 call sites compare user IDs, backed by 17 DB CHECK constraints, so multi-role cannot weaken separation. **`RoleName` the enum TYPE is deliberately kept** (nothing references it) — dropping it and the legacy rows is deferred a release so rollback stays cheap. **The seed is now typechecked — keep it that way.** `packages/db` runs a second `tsc` against `tsconfig.seed.json`; every remaining phase touches both the schema and the seed, and without it a broken seed reaches CI looking locally green. **Also run `npm run db:format` before pushing any schema change**: CI's gate is "formatting leaves no diff" and no local script runs it, which cost one red round-trip on a single line of field alignment. **Verify a seed change on an EMPTY database**, not the dev one — an upsert against rows a migration already created exercises the update path and never the create path, which is exactly the half that was broken. Still to come: Phase 2 (convert the 12 role-name-keyed decision points), Phase 3 (`status`/`isSystem`, Role CRUD + matrix, OFFICE_ADMINISTRATOR), Phase 4 (unified User/Employee screen), Phase 5 (migration rehearsal + the remaining tests). |
| 2026-09-17 | **The backup restore drill had failed every scheduled run since 2026-08-31 — three stacked faults, each hidden behind the one before it, and the third was the drill lying about what it verified.** **Fault 1 — the seed crashed.** Nothing in this job ever ran `prisma generate`: `npm ci` has no postinstall hook, and unlike `ci.yml` this workflow runs no turbo task (turbo's graph builds `@ibms/db`, which is where `ci.yml` quietly gets its client). `RoleName` was `undefined` and the seed died on `Cannot read properties of undefined (reading 'SALES_RELATIONSHIP_OFFICER')`. Fixed with a standalone `npx prisma generate` — no dotenv wrapper and no `DATABASE_URL` (generate only reads the schema); `npm run db:generate` would NOT work here because that script is `dotenv -e ../../.env` and this workflow only writes `.env.test`. **Fault 2 — there was no passphrase.** The repository has **zero** Actions secrets, so `BACKUP_DRILL_ENCRYPTION_KEY` was never set and the drill step would have exited 1 even once the seed was fixed. Fixing only fault 1 would have moved the red one step later. Now generates an EPHEMERAL per-run passphrase, secret still overriding when present. **Fault 3, the real find — the verification compared ESTIMATES and called the drift data loss.** It summed `pg_stat_user_tables.n_live_tup` after an `ANALYZE`, with a comment asserting that made the comparison "exact, not approximate". `ANALYZE` SAMPLES; `n_live_tup` stays an estimate. Proved rather than assumed, on ONE database with no restore involved: estimate **4,142,466** vs true count **4,141,630** — an 836-row phantom. Replaced with an exact per-table `count(*)` via `query_to_xml`, placed AFTER `END_EPOCH` so verification time is never charged against the RTO target; verified there are no partitioned or inherited tables (0 and 0, 130 base tables) that could double-count. **Verification**: the drill now runs locally end to end — **PASS**, 4,141,630 original vs 4,141,630 restored, 638s against the 900s RTO target, exit 0. | **Fixing the first failure in a stack tells you nothing about the second.** Three weeks of red were three different bugs; the third only became visible once the first two were fixed and the drill could reach its own summary. Check what comes AFTER the failing step before calling it fixed. **A comment asserting a property is not the property** — "ANALYZE makes this exact" was wrong, and one query against a single database disproved it in seconds. **Do not weaken a check that might be catching something real**: the estimate-vs-exact measurement is what established the FAIL was the metric and not the restore, and the fixed drill then matched that exact number on both sides. **The repo has NO Actions secrets** — any workflow written to require one has never run. **An ephemeral passphrase is the right key for this drill**, not a missing long-lived one: it proves the round trip against a throwaway seeded database and keeps a real credential out of a job with no real data to protect. |
| 2026-09-17 | **The Claims Officer could not reach the one desk its role exists for — the second role-routing gap of the same shape, closed the same way.** Part G item 7 logged it; this closes it. The role holds `claim.read` / `register` / `document` / `assess` / `settle.approve` / `close` — its entire job — but every route to a claim went through `/opportunities/[id]`, behind an `opportunity.read` it does **not** hold. **The API was the deeper half of the gap**: `GET /claims` demanded exactly one of `policyId`/`customerId` and 422'd otherwise, so "what claims am I responsible for" was not an ASKABLE question — no screen could have existed. New unscoped queue branch filters on the SAME `CLAIM_CROSS_OWNER_ROLES` rule the scoped branches enforce per row, expressed as a query filter so the window bounds MATCHING rows, not rows scanned (the `DpoWorkspaceService` defect). Both scopes together is still a 422. **The endpoint now returns the same `{items,total,page,pageSize}` envelope on every branch** — the `/policies` precedent — and that is what broke 15 tests: every mock still returned a bare array, so `listClaimsForPolicy`'s new `.items` unwrap yielded `undefined`. **I nearly reported that run as green**: I read `tail` output, saw "21 passed", and missed the failure count above the window. **New `/claims` is a QUEUE, not an index** — each row carries status, an unresolved-insurer-alert badge and a documentation-incomplete badge, so it answers "what needs me next" rather than only linking on (the UX directive's no-waypoint-pages rule). `/claims/[id]` renders the SAME `ClaimCard` the opportunity screen does, extracted to `components/claim/` so the two cannot drift; `ClaimSection` fell 1187 -> 336 lines and its own tests pass unmodified, which is the proof the extraction was behaviour-free. **Verification**: typecheck 6/6, lint 3/3, build 3/3; unit **api 2970 (+7) · web 69 · db 24**; i18n parity 58/58; `claim.e2e-spec` **11/11**; contract 4/4; web e2e **411/411 (+8)**; a11y **69/69 (+1)**. | **A tail is not a test result.** `tail -12` on a Playwright run shows the last test NAMES, not the summary — the "15 failed" line sat above it. Grep for `failed` or read the exit code; never report green off a truncated window. **Changing a response SHAPE is a fixture migration, not a code change** — one endpoint, one envelope, and every mock in every spec that answers it has to move together. **`useParams()`, never the `params` prop** — Next 16 makes that prop a Promise, and every other dynamic route here already reads the hook. **`getByText` / `getByRole(name)` match case-insensitive SUBSTRINGS** — a status label also exists as an `<option>` in the filter, so scope badge assertions to their `data-*` hook. **Only `alertOpen` is filterable** — documentation-completeness and awaiting-second-approval are DERIVED in the view, and filtering a bounded page on them in memory would let the page size decide what the caller cannot see. **`/claims/[id]` has no notify form** by design: raising a claim starts from the policy. **The queue shows the policy number, not the customer** — `CLAIM_INCLUDE` has no customer join, and adding one would put PII into every claim read in the app. |
| 2026-09-17 | **Part G is COMPLETE — and item 7, the "just take screenshots" item, found four real defects, three of which no test would ever have reported.** New `e2e/part-g-core-screens.spec.ts`: 8 tests, **32 captures** — 4 screens x 2 languages x 4 states (loading/empty/error/populated), a separate file from Part F item #8's sweep because that one captures ONE language per screen and has no `/leads` capture at all. **One role drives all four screens.** `SALES_RELATIONSHIP_OFFICER` is the only seeded role holding `lead.list.read` + `policy.read` + `claim.read` + `renewal.read` + `opportunity.read`, and using it is the point: item 7 says the screens WORK, and a fixture stitched from several roles proves the pages render without proving any real user can walk the chain. **Defect 1, found because the error state could not be photographed**: `ClaimSection`'s catch sets `setPolicy(null)`, and the render short-circuits on `!policy` BEFORE its own `loadError` alert — so a failed claims read rendered NOTHING and the error block was unreachable dead code. **Defects 2 and 3 were found by LOOKING at the Arabic captures, not by any assertion**: `/renewal-cases` rendered its transition buttons as `{next}`, the bare `RenewalStatus` code, so `LAPSED` / `QUOTES_OBTAINED` / `IN_PROGRESS` sat in the middle of an Arabic table — with `ENUM_LABEL.RenewalStatus` already imported and already used two lines above; and the Arabic claim card carried **nine hardcoded English fragments** (`Loss`, `Estimated loss`, `adjuster`, `large claim`, `Estimated`/`approved`/`deductible`/`net`, `Client payment confirmed`) plus an English `title` on a disabled button — and `claimEstimatedLossLabel` already existed, uncalled. **Defect 4 was found by the compiler, after I chose to type the fixtures**: annotating them `Lead[]` / `Policy` / `Claim` / `RenewalCase` / `OpportunityWithContext` turned up FOUR wrong shapes a plain literal hid — `LeadSource` is lowercase (`referral`, not `REFERRAL`), `Policy` carries a nested `customer: { legalName }` not a flat `customerLegalName` (so the populated capture would have shown a dash where the customer belongs), and `context` lives on `OpportunityWithContext`, not `Opportunity`. A fifth, `status: "PENDING"`, is not a `RenewalStatus` at all and took the whole table down via `RENEWAL_NEXT_STATUSES[status].map`. **Verification**: typecheck 6/6, lint 3/3, build 3/3; unit **api 2963 · web 69 · db 24**; i18n parity 58/58; web e2e **403/403 (+8)**; a11y **68/68**. No `apps/api` file touched, so the api e2e suite is not implicated. | **A screenshot is evidence; a passing test is not.** Two of item 7's four defects were invisible to every assertion in the suite and obvious within seconds of opening the PNG — if you capture evidence and never look at it, you have bought the cost and none of the value. **Type your e2e fixtures against the real interface.** Five wrong shapes, one of which silently blanked a field in the evidence itself, cost one `tsc` run to find. An untyped mock asserts only that you can type JSON. **`getByRole(name)` and `getByText` match case-insensitive SUBSTRINGS.** `"Claims"` matched the consent widget's `"Claims consent"` heading, which would have made the populated assertion pass against the wrong element; `exact: true` fixes it. The same trap broke the first English-leak guard, which matched the adjuster FIRM's name — **a label is translated, a name is not**, so assert the Arabic label is PRESENT rather than the English word absent. **There is still no standalone Claims screen** — a `CLAIMS_OFFICER` holds `claim.read` and has no screen listing their own claims, reachable only via `/opportunities/[id]`, which needs an `opportunity.read` they do not hold. Same shape as the Policy Checking Officer gap; logged in README § Known gaps, NOT fixed, because a claims queue is a feature. |
| 2026-09-17 | **Part G, six of seven items — and the one the checklist was most confident about turned out to be the one that was false.** Every item is now a test that FAILS when the property stops holding, and every guard was proven by planting a regression and watching it fire — a guard nobody has seen fail is a guard nobody has tested. **Item 5 is the find.** "No float in money, enforced by a build-pipeline check" read as already met, because `money-fields.inventory.spec.ts` exists and is about money columns. It is not that check: it inventories **`Decimal`** columns, so a `Float` is invisible to it BY CONSTRUCTION. Planting `plantedFloatAmount Float` on `Invoice` passed all seven of its tests. New `float-money.inventory.spec.ts` is the missing half — every `Float` in the schema must be named with a reason, currently three (`ScreeningMatch.matchScore`, `ScreeningMatch.reviewThreshold`, `SlaPolicy.warningThreshold`), plus a second check that nothing money-NAMED can be allow-listed even deliberately. That spec also caught **my own** mis-attribution on its first run — `reviewThreshold` is on `ScreeningMatch`, not `ScreeningProviderConfig`. **Item 3's guard initially failed to catch its own planted bypass**: the `data:` extractor required a newline before the closing brace, so a single-line `data: { status: 'CLOSED' }` yielded an empty payload and passed. Replaced with real brace matching (`braceBody()`), which names file and line. The codebase itself was already clean — all four apparent violations are status-CONDITIONAL updates (`status` in `where`, a different field in `data`), which is the race-safe pattern, not a bypass. **Item 2 needed no new tests, and my first answer said otherwise.** Two "gaps" were keyword-search false negatives: DSR closure IS tested — its comment says "close by the SAME DPO officer", never the word self-approval — and access recertification IS covered, by a UNIT test, correctly, because the service's own comment records that the state is structurally unreachable through the API. `internal-audit-finding` and `user-admin` only MENTION `assertDifferentActors` in comments; neither is an enforcement point. **Item 4 found three real discrepancies**: `MfaCredential.secretEnc` is encrypted but through `MfaService.encryptSecret` under its own `MFA_ENCRYPTION_KEY`, so it went into a new `ENCRYPTED_ELSEWHERE` constant and **must never join `ENCRYPTED_FIELDS`**, which DRIVES `encryptEntityFields` — a field in both is encrypted twice and the decrypt returns ciphertext; `OrganizationEmailIntegration.oauthRefreshTokenEnc` was encrypted correctly with no `-- ENCRYPT` marker to say so, which an auditor reading the schema would have missed; `webauthnPublicKeyEnc` is marked and written by NOTHING, left as an open client question rather than guessed at. **Item 6**: all fourteen source-document deadlines are pinned by name, and `claim_followup_insurer_response` escalates through its own `ClaimFollowUpAlert` + nightly `ClaimFollowUpScheduler` rather than the generic `SlaTimer` engine — a real escalation job, which is what the item asks, but a documented variation. **Item 1**: Prisma has no `format --check`, so CI runs `db:format` and fails on any resulting diff. **Verification**: typecheck 6/6, lint 3/3, build 3/3; unit **api 2963 (+16) · web 69 · db 24**. | **A guard you have never seen fail is not evidence** — plant the regression, watch it fire, then remove it. Item 3's brace bug and item 5's whole existence were both found that way and neither was visible by reading. **`money-fields.inventory.spec.ts` does NOT stop a float** — it is a `Decimal` inventory; `float-money.inventory.spec.ts` is the one that does, and a new `Float` column must be added to its allow-list with a reason or the build fails. **`ENCRYPTED_FIELDS` is not the list of encrypted columns** — it is the list this module encrypts. A column encrypted elsewhere goes in `ENCRYPTED_ELSEWHERE`; putting it in both double-encrypts it. **A keyword search is not an audit** — twice this pass a grep for the obvious term reported a gap that did not exist, because the test said the same thing in different words. Open the file. **`webauthnPublicKeyEnc` is an open question for the client** (placeholder for planned WebAuthn, or dead column) — listed as knowingly-unwritten so the guard passes honestly; the moment anything writes it, revisit that entry. **Part G item 7 is the only one left** — core screens Lead→Policy→Claim→Renewal, both languages, four states, screenshots. It is a fresh session's work (up to 32 captures); the Renewal module and `/renewal-cases` screen DO exist, whatever older README rows say. |
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
response tracking, a nightly business-day follow-up alert sweep). This paragraph predates
Domain B #12–22, Domains C–H and Parts D–F, all of which have since been built —
**root `README.md` § Scope status is the authority, not this summary.** Part F's
bilingual UI is complete: all 93 screens — the 89 under `app/(app)/` and the four
`(auth)` screens that render before sign-in — read from
`apps/web/lib/i18n/translations/`, including the 403 permission-denied branch
(see § What's New). Part G's final verification
checklist is complete — all seven items closed and guarded. See § Known gaps for
each built item's deferred edges.

**Custom office-scoped RBAC is IN PROGRESS — Phase 1 of 5 has landed.** The fixed
11-role catalogue is gone as an architecture: `Role` carries `organizationId`, a role
name is unique per office rather than globally, and authorization resolves permissions
from `roleId` — never from a role name, because two offices may each define a
"Manager" with different grants. `Permission` stays a single global catalogue; only the
grants are per-office. The legacy 11 survive as ordinary per-office rows carrying their
old machine names, so nobody's access changed.

Before touching anything role-related, read the two standing constraints: **role NAME
is no longer an identity** (`PermissionRepository.findCodesForRoles` and
`PermissionsService` both take ids, deliberately — a name-keyed lookup is a
cross-tenant leak), and **an RLS policy is only enforceable on a model carrying
`organizationId`**, because that is how `tenantScopeExtension` decides whether to set
`app.current_org_id` at all. Phases 2–5 (converting the remaining role-name-keyed
decision points, Role CRUD + permission matrix, the unified User/Employee screen,
migration rehearsal) are not built; two of those decision points currently fail OPEN
and are named in § What's New.

## Common commands

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate:dev
npm run db:seed       # per-office roles + the global permission catalogue — RBAC needs these
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

# Demo data for two Organizations, through the real HTTP API — DEV DB only,
# never .env.test. Sign in with the password, then pair an authenticator at
# Settings -> Security. See apps/api/scripts/README-SEED-DEMO.md.
npm run seed:demo -w api
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
