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
| 2026-09-14 | **`npm run seed:demo` — demo data for two Organizations, driven through the real HTTP API.** Seeds employees, leads at every funnel stage, ~500 customers, and full sales-to-policy pipelines (risk profile → needs assessment → programme → opportunity → RFQ → quotation → comparison → recommendation → client decision → placed/issued/checked/delivered policy) plus invoices, claims, complaints, incidents and vendors — every row through the same endpoints, DTO validation, permission checks and workflow rules a real user's click goes through, so nothing it creates could not have been created by hand. Full run: **1,292 rows, 0 failures, 219s**; all 30 pipeline policies reach `ACTIVE`. **Six defects were found by EXECUTING it and fixed before it was committed, and the two that mattered were invisible to review** — the DTO field names, enum values and all 26 actor→permission pairs were correct from the start. (1) **It could not have run at all**: `MfaRequiredGuard` is a global `APP_GUARD` rejecting any user with `mfaEnabled = false` — **every role, not just the always-MFA three** — while `login` returns an MFA *challenge* rather than a session when it is true. No single value works; the account must log in without MFA and enrol over that session, which is exactly what every e2e spec's `makeUser` does and why they all do it. (2) **It would have locked every demo account out permanently**: the enrolment secret is generated in-process and never shown to anyone, so leaving `mfaEnabled = true` left a six-digit prompt nobody can answer, on the very accounts a demo depends on. Also: the RFQ line was picked from the INSURER's list rather than the lines the Opportunity's programme actually designed (~1 pipeline in 3 died there); `"Property All Risks (Fire)"` is not a coverage line at all (`COVERAGE_LINES` is the canonical set — a near-miss name is a line that does not exist); policies incepted in the FUTURE while losses were dated in the PAST, so no claim could fall inside cover; and re-runs 409'd re-linking actor accounts already tied to an `Employee`, which made the script's own "safe to re-run" claim false. **Verification**: smoke + full run above, 5/5 tenant-isolation checks against the seeded data (cross-office `GET` by id → **404, never 403**, with a "sees its own → 200" control so the 404s mean something), typecheck 6/6, lint 3/3, build 3/3, unit api 2926/2926 · web 16/16 · db 15/15, api e2e **483/483 across 74 files**. | **It targets the DEV database (`.env`), never `.env.test` — `npm run test:e2e` is unaffected, and the run confirmed it: 74 files, not 75.** The script lives in `scripts/` under `*.script.ts` with its own vitest config, so the e2e suite's `test/**/*.e2e-spec.ts` glob cannot collect it — two independent reasons, deliberately. **Demo accounts are handed back with MFA OFF**: sign in with the password alone, then pair an authenticator at **Settings → Security**. Every other screen 403s until you do — that is §4.3.2's forced enrolment working, not a fault, and `/auth/me` plus the two enrolment endpoints are the only routes reachable before then, which is what makes it possible at all. **Never leave a seeded account with `mfaEnabled = true` and no paired authenticator.** The script sets `SCHEDULED_JOBS=disabled` itself before boot — `.env` does not carry that flag the way `.env.test` does, so all 19 cron jobs would otherwise fire mid-run, including a real multi-megabyte sanctions download. `seed-demo-report.json` is **gitignored**: it is run output and records the demo accounts and their shared password. Scale is env-configurable (`DEMO_CUSTOMERS_PER_ORG` etc.) — smoke-test small before a full run. See `apps/api/scripts/README-SEED-DEMO.md`. |
| 2026-09-13 | **Phase 6 — the Part V checklist run end to end across two Organizations, and what "already covered" turned out to mean.** Every item was checked against what is ACTUALLY exercised rather than against what the checklist claims, and **every gap found was a coverage gap, not a behaviour gap** — the system held everywhere it was probed. **Item 7 had no coverage at all**: Phase 4 built `TenantMatchGuard`, but `auth-mfa-session` only ever tested subdomain RESOLUTION, never the mismatch the guard exists for. Now five assertions — office A's token refused on office B's subdomain, the same token accepted on its own, a host naming no office skipped (every local/CI/e2e request looks like that, and refusing them would prove nothing), an unknown-but-well-formed subdomain skipped rather than refused (refusing would turn the guard into a way to probe which office labels are registered, which §4.10.4 rules out), and the mismatch recorded as a security event against the SESSION's own office. **Item 11** uploads a CSV carrying office B's real id in three differently-named columns, then reads back **as the OWNER — which sees every office** — so it asserts where the row actually LANDED, not merely where the caller can see it; plus the stronger statement that a mapping naming `organizationId` as an importable field is refused outright. **Three cross-cutting items were weaker than they looked.** Item 1 was unit-covered only, and the existing fuzzy e2e tests a DIFFERENT shape (a subject carrying an extra name the entry lacks), not the romanisation case the checklist names — a real OFAC entry spelled "Mohammed" is now matched by a customer spelled "Muhammad" through the real screening path. **Item 2 was not proven at all**: the pre-existing batch test's customer has an unapproved KYC file and is deliberately SKIPPED, so the counter stays 0 — it proved the endpoint runs and is permission-gated, not that anybody gets re-screened. Item 3 had no test whatsoever. **Item 5 is the one worth reading twice**: the pre-existing dual-control test proves a manager cannot approve their own destruction batch, but proves it with a **403 for holding no `retention.dispose.approve` at all** — that is the PERMISSION GATE, not maker/checker, so §10.5's actual edge case (one person holding BOTH titles, and therefore holding the permission) was never exercised. It is now, and it holds: `assertDifferentActors` refuses it. **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2926/2926** · web 16/16 · db 15/15; api e2e **483/483 across all 74 files in ONE uninterrupted run, exit 0**. Test-only change; no production code touched. | **Part V now stands at 11/12 multi-tenancy (was 9), 12/12 auth, 4/5 cross-cutting.** **The transferable lesson: when two different refusals share a status code, asserting the STATUS proves nothing.** Item 5's maker/checker refusal is a 403 exactly like the permission refusal above it in the same file, so the test asserts the message text — without that it would have passed while testing the wrong control, which is precisely what the pre-existing test had been doing. **Two items remain unticked and neither is a defect to chase.** Item 10 needs a real OAuth consent that cannot be faked — everything around it (per-office sender, the never-fall-back rule, mailbox isolation) is proven. **Item 5's fallback half is a logged KNOWN GAP** (`[~]` in the spec, 2026-09-13): `dpoAlternateApproverUserId` has **zero consumers**, so in the edge case it exists for the batch cannot be approved by anyone — an AVAILABILITY gap, never a safety one, since the failure is a stuck batch and never a wrongly-approved one. Deliberately NOT patched inside a regression pass: letting a non-DPO approve changes a dual-control path and raises design questions the spec does not answer (who may be an alternate, how they get the permission without widening it for everyone, whether an alternate may also be the nominator). **Dummy-data seeding (20 employees / 500 customers) is now UNBLOCKED — the foundation it was waiting on is verified — but is NOT started. Do not self-select it.** |
| 2026-09-13 | **Part III §7 — the legacy customer bulk import, and Phase 5's framing turning out to be wrong.** The spec calls Phase 5 "narrower, mostly additive". **Three of its six items needed no code at all** — verified rather than assumed, which is what §10.2 and §10.5 asked for and what the rest turned out to need too: §10.2's insurer field set was already complete from Phase 3's split; §10.5's `assertDifferentActors` was already wired; §10.3's "reject an empty rationale" guardrail was already enforced (`@Transform(trimIfString) @MinLength(10)`). What was left was one 67-site refactor and one greenfield subsystem. **The import** (`POST /imports/customers`, multipart CSV + a per-office column mapping): an office joining the platform arrives with a back-book in a spreadsheet, and the entire design question is loading it without those rows ever passing for customers who went through this system's own KYC. **Three independent statements say they did not** — `Customer.source = LEGACY_IMPORT` (new enum + column), the customer at its default `PENDING_KYC`, and a `DRAFT` `KYCRecord`; the first is provenance and survives the file later being completed properly. Every row is screened through the **same `ScreeningService.run` the intake flow uses**, and is counted as flagged when the run raises a hit **OR when no populated list could be consulted** — an unscreenable row is not a clear one. Bad rows are rejected **by line number** (counting the header as line 1, so the number matches what the office sees in their own spreadsheet) and the rest still import: 397 of 400 loaded and 3 named beats a blanket failure. The file is held **in memory and never written to disk** — there is no object storage here and this does not introduce one; a customer list spooled to a temp file is Confidential data sitting outside every control the rest of the system has, and it would outlive the request. Size and row caps are enforced at the interceptor **and again in the service**, because a limit that exists only in a decorator is one edit away from not existing. The CSV reader is hand-written (quoted fields, embedded commas/newlines, escaped quotes, CRLF, and the **UTF-8 BOM Excel writes**, which would otherwise corrupt the first heading and fail the mapping with a message blaming the office). **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2926/2926** · web 16/16 · db 15/15; api e2e **474/474 across 74 files in ONE uninterrupted run, exit 0**. | **`customer.bulk-import` is its own permission, administrator-only — do NOT fold it into `customer.create`.** Sales holds `customer.create` and creates customers all day; this writes hundreds of rows in one unreviewed pass and marks every one as never having passed KYC. An e2e test asserts the implication does not hold. **§10.1 (fuzzy matching) is DEFERRED by explicit decision, and the reason is worth reading before picking it up**: an edit-distance layer in TypeScript would catch **nothing**, because `WatchlistEntryRepository.findMatchCandidates` gates candidates on EXACT token equality in SQL — a spelling variant outside the transliteration table never becomes a candidate for anything to re-score. Doing it properly needs `pg_trgm` (available in the image, not installed), a similarity-ranked `ORDER BY`, and a raised `WATCHLIST_CANDIDATE_LIMIT`: **widening the query without the re-rank would let fuzzy noise evict a genuine hit from the 50-row window**, making the control worse. **One disclosed deviation from §7.3**: the spec names a `kycCompletionStatus` field; `Customer.status` and `KYCRecord.status` already say exactly that, and a third status column would be a worse model saying it a third time. No new table, so no new RLS policy — the migration asserts 119 rather than assuming it. No UI; this is an API-only tool. |
| 2026-09-13 | **Part IV §10.4 — the UI renders from permissions, and the 67 role checks that were a second copy of the grid.** §10.4 asks for two independent layers (the frontend shows only what the caller may do; the API re-validates regardless) with the guardrail that the UI reads **one** resolved permission set. The scattering was real and larger than first counted: **67 checks across 47 files** branching on role names — a hand-written duplicate of the permission grid living in the frontend, which fails in the worst direction. Granting an existing permission to one more role updates the API and leaves every one of those checks stale, so **the button stays hidden from someone who is now allowed to press it and nobody gets an error to chase**. `/auth/me` now returns the caller's resolved codes, sorted, from the same grid the API enforces with. **The mapping was not guessed**: the route → `@RequirePermissions` join was built mechanically (306 of 336 web api functions resolved to the permission their own endpoint enforces), then each gate converted to the code behind the control it guards, and 45 now-dead role constants deleted so the stale copy cannot be picked back up. `opportunities/[id]` is the case in miniature — **`isClaims` alone stood in for six distinct claim permissions and `isFinance` for four**. `PermissionsService` moved into its own module: `AuthModule` cannot import `RbacModule` (that already imports `AuthModule`), and duplicating the provider would have been wrong in a way nobody would notice for a minute at a time — the service holds a 60-second cache, two instances means two caches, and the `invalidateCache()` an admin write triggers clears one of them. Also added `privacy-notice.read` (touchpoint roles + DPO/Compliance) so a notice READ is no longer authorised by `consent.manage`, a WRITE permission on a different resource that happened to be held by the same roles. **Verification**: typecheck 6/6, lint 3/3 (zero warnings), build 3/3, unit api **2912/2912** · web 16/16 · db 15/15; api e2e **469/469 across 73 files in ONE uninterrupted run, exit 0**. | **`hasPermission` / `hasAnyPermission` (`apps/web/lib/auth/permissions.ts`) is now the only way a component decides what to render — never `user.roles`.** **One deliberate exception exists and must not be "tidied up"**: in `incidents`, classify and co-sign both require `incident.classify` — a maker/checker pair a single permission cannot express, enforced server-side by `assertDifferentActors`. Gating both on the shared permission would offer each user a control the server always refuses, which is the thing §10.4 exists to prevent, so those two stay role checks with the reasoning written down. **A correction for the record**: an earlier note in this session reported a live 403 on the privacy-notice widget. That was WRONG — the guard is OR (`required.some`), the widget calls `GET current` (not the list endpoint that was checked), and `consent.manage` already covered it. Nobody gains or loses access from the new permission. The conversion did briefly introduce that bug by gating on `privacy-notice.publish`; it is fixed here. **Two silent failures were caught during the conversion and are the shape to watch for**: inlined arrays left ROLE names being passed to a permission check — `tsc` cannot see it (both are `string[]`) and the check would have evaluated false for ever. |
| 2026-09-13 | **The DPO workspace's capped reads filtered AFTER the cap — and one of them had already started lying.** Chasing the last e2e failure surfaced a class defect, and auditing the rest of `DpoWorkspaceService` found it in every remaining list. Each was built by reading the **N most recent** rows and dropping the ones that did not belong **in memory**. That is fine until the table passes N; after it, an item OLDER than the window stops appearing at all — and because the window was ordered newest-first, **the first entry to vanish from a statutory-deadline queue was its oldest, the one closest to breaching.** For a PDPL tracker that is exactly inverted: the more overdue a request became, the likelier the DPO was to stop being shown it. **`ConsentRecord` had already crossed its cap — 1,132 rows against 1,000** — so `consentStatus` was reporting the active/withdrawn/declined figures over the most recent 1,000 records and stating the total as 1,000. **A compliance figure that was already wrong, not a latent risk**, and unnoticed because no test asserted on that field. Fixed: `dsrQueue`/`incidentRegister` filter by status **in SQL** (`DsrRepository.findOpenQueue`, `IncidentRepository.findOpenRegister`), so the cap bounds **open items** rather than rows scanned and an old open item cannot be pushed out by newer ones at any table size; both now order **oldest-first**, which is the other half — if the cap is ever reached it truncates the least urgent tail, never the most overdue head. `consentStatus` is three SQL counts over the whole table in one transaction; raising the cap was rejected because it only moves the cliff. `summarizeConsentStatus` and its two tests were **deleted**, not orphaned — dead code in a compliance module reads as maintained. **The three new e2e tests were verified non-vacuous, not assumed to be**: run against the previous implementation all three fail, the consent one as **"expected 1000 to be 1132"** — the defect stating its own size. **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2912/2912** · web 16/16 · db 15/15; api e2e **467/467 across all 73 files in ONE uninterrupted run, exit 0**. | **The standing rule this establishes: never filter a capped read afterwards — filter in the query, or the cap silently decides what you cannot see.** Grep for `_TAKE` before trusting any list this service returns. The caps remain, but hitting one is no longer a safety failure: the deliberate cost is that at saturation the **NEWEST** item falls outside the cap, which is the correct direction to fail in for a deadline queue. **Correcting an earlier miscount in this table's own history**: `DpoWorkspaceService` has **five** `*_TAKE` caps, not four — `CROSS_BORDER_RECENT_TAKE` plus four others, of which `DPIA_SCAN_TAKE` was already safe (its filter is in the `where`) and `INCIDENT_SCAN_TAKE` had no assertion at all. `dpo-workspace.e2e-spec.ts` now seeds a full window past each cap and deletes it again, so the file is slower but self-cleaning; **do not "simplify" that seeding away** — without it the tests pass against the broken implementation. |
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
