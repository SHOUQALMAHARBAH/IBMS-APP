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
| 2026-09-13 | **Part III §7 — the legacy customer bulk import, and Phase 5's framing turning out to be wrong.** The spec calls Phase 5 "narrower, mostly additive". **Three of its six items needed no code at all** — verified rather than assumed, which is what §10.2 and §10.5 asked for and what the rest turned out to need too: §10.2's insurer field set was already complete from Phase 3's split; §10.5's `assertDifferentActors` was already wired; §10.3's "reject an empty rationale" guardrail was already enforced (`@Transform(trimIfString) @MinLength(10)`). What was left was one 67-site refactor and one greenfield subsystem. **The import** (`POST /imports/customers`, multipart CSV + a per-office column mapping): an office joining the platform arrives with a back-book in a spreadsheet, and the entire design question is loading it without those rows ever passing for customers who went through this system's own KYC. **Three independent statements say they did not** — `Customer.source = LEGACY_IMPORT` (new enum + column), the customer at its default `PENDING_KYC`, and a `DRAFT` `KYCRecord`; the first is provenance and survives the file later being completed properly. Every row is screened through the **same `ScreeningService.run` the intake flow uses**, and is counted as flagged when the run raises a hit **OR when no populated list could be consulted** — an unscreenable row is not a clear one. Bad rows are rejected **by line number** (counting the header as line 1, so the number matches what the office sees in their own spreadsheet) and the rest still import: 397 of 400 loaded and 3 named beats a blanket failure. The file is held **in memory and never written to disk** — there is no object storage here and this does not introduce one; a customer list spooled to a temp file is Confidential data sitting outside every control the rest of the system has, and it would outlive the request. Size and row caps are enforced at the interceptor **and again in the service**, because a limit that exists only in a decorator is one edit away from not existing. The CSV reader is hand-written (quoted fields, embedded commas/newlines, escaped quotes, CRLF, and the **UTF-8 BOM Excel writes**, which would otherwise corrupt the first heading and fail the mapping with a message blaming the office). **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2926/2926** · web 16/16 · db 15/15; api e2e **474/474 across 74 files in ONE uninterrupted run, exit 0**. | **`customer.bulk-import` is its own permission, administrator-only — do NOT fold it into `customer.create`.** Sales holds `customer.create` and creates customers all day; this writes hundreds of rows in one unreviewed pass and marks every one as never having passed KYC. An e2e test asserts the implication does not hold. **§10.1 (fuzzy matching) is DEFERRED by explicit decision, and the reason is worth reading before picking it up**: an edit-distance layer in TypeScript would catch **nothing**, because `WatchlistEntryRepository.findMatchCandidates` gates candidates on EXACT token equality in SQL — a spelling variant outside the transliteration table never becomes a candidate for anything to re-score. Doing it properly needs `pg_trgm` (available in the image, not installed), a similarity-ranked `ORDER BY`, and a raised `WATCHLIST_CANDIDATE_LIMIT`: **widening the query without the re-rank would let fuzzy noise evict a genuine hit from the 50-row window**, making the control worse. **One disclosed deviation from §7.3**: the spec names a `kycCompletionStatus` field; `Customer.status` and `KYCRecord.status` already say exactly that, and a third status column would be a worse model saying it a third time. No new table, so no new RLS policy — the migration asserts 119 rather than assuming it. No UI; this is an API-only tool. |
| 2026-09-13 | **Part IV §10.4 — the UI renders from permissions, and the 67 role checks that were a second copy of the grid.** §10.4 asks for two independent layers (the frontend shows only what the caller may do; the API re-validates regardless) with the guardrail that the UI reads **one** resolved permission set. The scattering was real and larger than first counted: **67 checks across 47 files** branching on role names — a hand-written duplicate of the permission grid living in the frontend, which fails in the worst direction. Granting an existing permission to one more role updates the API and leaves every one of those checks stale, so **the button stays hidden from someone who is now allowed to press it and nobody gets an error to chase**. `/auth/me` now returns the caller's resolved codes, sorted, from the same grid the API enforces with. **The mapping was not guessed**: the route → `@RequirePermissions` join was built mechanically (306 of 336 web api functions resolved to the permission their own endpoint enforces), then each gate converted to the code behind the control it guards, and 45 now-dead role constants deleted so the stale copy cannot be picked back up. `opportunities/[id]` is the case in miniature — **`isClaims` alone stood in for six distinct claim permissions and `isFinance` for four**. `PermissionsService` moved into its own module: `AuthModule` cannot import `RbacModule` (that already imports `AuthModule`), and duplicating the provider would have been wrong in a way nobody would notice for a minute at a time — the service holds a 60-second cache, two instances means two caches, and the `invalidateCache()` an admin write triggers clears one of them. Also added `privacy-notice.read` (touchpoint roles + DPO/Compliance) so a notice READ is no longer authorised by `consent.manage`, a WRITE permission on a different resource that happened to be held by the same roles. **Verification**: typecheck 6/6, lint 3/3 (zero warnings), build 3/3, unit api **2912/2912** · web 16/16 · db 15/15; api e2e **469/469 across 73 files in ONE uninterrupted run, exit 0**. | **`hasPermission` / `hasAnyPermission` (`apps/web/lib/auth/permissions.ts`) is now the only way a component decides what to render — never `user.roles`.** **One deliberate exception exists and must not be "tidied up"**: in `incidents`, classify and co-sign both require `incident.classify` — a maker/checker pair a single permission cannot express, enforced server-side by `assertDifferentActors`. Gating both on the shared permission would offer each user a control the server always refuses, which is the thing §10.4 exists to prevent, so those two stay role checks with the reasoning written down. **A correction for the record**: an earlier note in this session reported a live 403 on the privacy-notice widget. That was WRONG — the guard is OR (`required.some`), the widget calls `GET current` (not the list endpoint that was checked), and `consent.manage` already covered it. Nobody gains or loses access from the new permission. The conversion did briefly introduce that bug by gating on `privacy-notice.publish`; it is fixed here. **Two silent failures were caught during the conversion and are the shape to watch for**: inlined arrays left ROLE names being passed to a permission check — `tsc` cannot see it (both are `string[]`) and the check would have evaluated false for ever. |
| 2026-09-13 | **The DPO workspace's capped reads filtered AFTER the cap — and one of them had already started lying.** Chasing the last e2e failure surfaced a class defect, and auditing the rest of `DpoWorkspaceService` found it in every remaining list. Each was built by reading the **N most recent** rows and dropping the ones that did not belong **in memory**. That is fine until the table passes N; after it, an item OLDER than the window stops appearing at all — and because the window was ordered newest-first, **the first entry to vanish from a statutory-deadline queue was its oldest, the one closest to breaching.** For a PDPL tracker that is exactly inverted: the more overdue a request became, the likelier the DPO was to stop being shown it. **`ConsentRecord` had already crossed its cap — 1,132 rows against 1,000** — so `consentStatus` was reporting the active/withdrawn/declined figures over the most recent 1,000 records and stating the total as 1,000. **A compliance figure that was already wrong, not a latent risk**, and unnoticed because no test asserted on that field. Fixed: `dsrQueue`/`incidentRegister` filter by status **in SQL** (`DsrRepository.findOpenQueue`, `IncidentRepository.findOpenRegister`), so the cap bounds **open items** rather than rows scanned and an old open item cannot be pushed out by newer ones at any table size; both now order **oldest-first**, which is the other half — if the cap is ever reached it truncates the least urgent tail, never the most overdue head. `consentStatus` is three SQL counts over the whole table in one transaction; raising the cap was rejected because it only moves the cliff. `summarizeConsentStatus` and its two tests were **deleted**, not orphaned — dead code in a compliance module reads as maintained. **The three new e2e tests were verified non-vacuous, not assumed to be**: run against the previous implementation all three fail, the consent one as **"expected 1000 to be 1132"** — the defect stating its own size. **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2912/2912** · web 16/16 · db 15/15; api e2e **467/467 across all 73 files in ONE uninterrupted run, exit 0**. | **The standing rule this establishes: never filter a capped read afterwards — filter in the query, or the cap silently decides what you cannot see.** Grep for `_TAKE` before trusting any list this service returns. The caps remain, but hitting one is no longer a safety failure: the deliberate cost is that at saturation the **NEWEST** item falls outside the cap, which is the correct direction to fail in for a deadline queue. **Correcting an earlier miscount in this table's own history**: `DpoWorkspaceService` has **five** `*_TAKE` caps, not four — `CROSS_BORDER_RECENT_TAKE` plus four others, of which `DPIA_SCAN_TAKE` was already safe (its filter is in the `where`) and `INCIDENT_SCAN_TAKE` had no assertion at all. `dpo-workspace.e2e-spec.ts` now seeds a full window past each cap and deletes it again, so the file is slower but self-cleaning; **do not "simplify" that seeding away** — without it the tests pass against the broken implementation. |
| 2026-09-13 | **`NO_FULL_ACCOUNT_NUMBER` narrowed — and the false negative hiding inside it.** The guard that keeps a full card/bank number out of the 21 free-text fields beside masked-data paths rejected any run of **9+ digits**, which was wrong in BOTH directions. **The false positive:** every id here is a UUID and **3.11% of v4 UUIDs contain a run of 9+ digits** (measured over 200k, not estimated), so a staff member pasting a case/hold/transfer id was refused about **one time in 32**, and told to use an approved payment channel. The same thing made `dsr.e2e-spec.ts` fail at random — **this is almost certainly the "genuine but non-reproducing dsr failure" recorded in earlier rows**; it did not reproduce because re-running drew a different UUID. **The false negative, and the more serious half:** the rule's body used `[\s\S]*` but **its lookahead used `.*`, which does not cross newlines — so it only ever scanned the FIRST LINE**, and a card number on line two was ACCEPTED, by a control whose whole purpose is catching exactly that. Its own doc comment claimed multi-line was handled; only half of it was. Now: reject a run of **12+** digits unless it is the tail of a canonical UUID, scanning the whole value. 12 because an ISO/IEC 7812 PAN is 12-19 (Maestro starts at 12, UnionPay reaches 19) and a Jordanian IBAN's numeric body is 22; a floor of 12 ALONE would still reject ~0.35% of UUIDs (an all-digit final group), so a fixed-length lookbehind exempts exactly that one shape — digits merely appended to a UUID tail, or a real card elsewhere in the same note, still reject. **The rule had NO test at all**; 22 added including a 20,000-UUID sweep, because a single hand-picked example would neither have caught the defect nor catch a regression. **Also fixed here, a third independent pre-existing defect:** `dpo-workspace`'s cross-border assertion compared a length delta against a register capped at `CROSS_BORDER_RECENT_TAKE`; `db-test` is cumulative and passed that cap at 51 rows, so "grew by one" became **unfalsifiable and the test went permanently red** — it would have failed every run from here on, whatever anyone changed. **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2913/2913** · web 16/16 · db 15/15; api e2e **464/464 across all 73 files in ONE uninterrupted run, exit 0**. | **A run of 9-11 digits in free text is now ACCEPTED — a deliberate relaxation as well as a tightening.** A 10-digit Jordanian mobile or an 8-digit date in a complaint note no longer 400s. Two existing tests asserted a 400 on a 10-digit string; their fixtures are now genuinely account-shaped (16 digits) rather than merely long. **Never pass a raw id into one of the 21 guarded fields expecting rejection, and never assert a global count over a CAPPED list in an e2e** — both traps were live in this suite. `dsr.e2e-spec.ts` deliberately passes the raw `hold.id` again: it is deterministic BECAUSE of the exemption, and keeping a real id there is what proves that exemption through the DTO rather than only in a unit test of the regex. |
| 2026-09-13 | **Part II / Phase 4 step 12 — the auth/MFA/session rebuild, plus three §4.2 gaps found by re-reading the spec against the built code.** Four new tenant-scoped models (`Department`, `TrustedDevice`, `UserSession`, `PasswordHistoryEntry`), the forced onboarding wizard (mandatory password change, then inline MFA enrolment verified by one live code at ±1 step), trusted devices for standard roles only, idle timeout as **full session revocation** rather than a fresh code, and subdomain-to-Organization resolution. **The three gaps, none of which any test was failing over:** (1) §4.2.2 lists **Branch** among the fields the admin fills and `ProvisionUserDto` had no `branchId` at all — `User.branchId` had existed for several phases with nothing in the application able to set it; (2) §4.2.4 asks the audit entry to record "which department/branch" and it recorded **neither** — now both, **by id AND by name**, since an id alone is unreadable in an export years later and keeping only the id would let a rename silently rewrite history; (3) **neither `Department` nor `Branch` was creatable through the API** — the seed creates none and no endpoint existed, so the only source of the id that provisioning REQUIRES was a hand-written INSERT: **the requirement was satisfiable by the e2e suite and by nobody else**. New `GET/POST /admin/departments` + `/admin/branches` under the existing `user.manage` (no new permission: they serve provisioning and the same administrator performs both), create+list only — renaming or deleting an org unit has consequences for every row pointing at it (`User.departmentId` is `ON DELETE SET NULL`, which would silently empty a required field). The three e2e fixtures that reached past the API with raw Prisma now go through these endpoints. **Departments: two columns could hold one person's and NOTHING reconciled them.** `Employee.departmentId` (§4.1.2, the org chart) vs `User.departmentId` (§4.2.2, what the admin picked before an `Employee` row exists). Linking is the one moment they meet, and it copied neither and compared neither — **the day anything started writing `Employee.departmentId` the two could disagree permanently with nothing to notice**. The rule now: **the Employee record wins once it states a department**, because a person's functional grouping belongs to the person, not to their login credential. `linkUser` runs in one interactive transaction and returns a discriminated result — adopt when the employee has none, no-op when equal, **refuse the link (409) on a genuine disagreement rather than silently picking a winner**. The adopt step re-asserts `departmentId: null` in its own `where` (`race-safe-invariants.md`); `EmployeeService` pre-checks the same rule before creating anything, so a refused link leaves **no orphaned employee row**. One `effectiveDepartmentId()` accessor, so no future caller picks a column by hand. **Verification**: typecheck 6/6, lint 3/3, build 3/3, unit api **2913/2913** · web 16/16 · db 15/15; api e2e **464/464 across all 73 files in ONE uninterrupted run, exit 0**. | **Do NOT start Phase 5 or any later phase without an explicit go-ahead.** **Two additions beyond the spec's own list, each because the change is incoherent without it**: `Branch` had no write path anywhere, so requiring `branchId` without an endpoint would reproduce the exact dead-end being fixed for `Department`; and `CreateEmployeeDto` gained an optional `departmentId` because nothing could write `Employee.departmentId`, which would have left the 409 branch **unreachable — another guard that cannot fire**. **The web provisioning form was ALREADY broken against this branch's API** (it posted no `departmentId` to an endpoint that has required one since Phase 1) and now has Department + Branch dropdowns fed by the new endpoints. **No new table, so no new RLS policy** — `Department` and `Branch` both already carry `tenant_isolation` and the count stays at **119**, which migration `20261001110000` asserts rather than assumes. Still no UI beyond that one form; screens remain Phase 4 front-end work. See `docs/auth-mfa-session.md`. |
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
