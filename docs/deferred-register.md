# The deferred register

**Every module closes with this list.** Owner's standing instruction, 2026-10-13:

> A single list, derived from the code and not from memory, of everything that module declared
> unimplemented or deferred, each with its article or decision number and its location. Measured,
> not recalled — because deferred work that lives in someone's head is not deferred, it is
> forgotten work whose due date has not arrived yet.

**Where an item is declared unimplemented in code, this register's entry and the code's comment
must say the same thing. If they diverge, THE CODE IS RIGHT AND THIS FILE IS STALE** — and that
divergence is itself worth checking for.

**A deferral with a specific point of first contact in the code is recorded in BOTH places.** The
register serves whoever is PLANNING; a note at the point of contact serves whoever is about to
write the thing the deferral makes invalid, and needs the warning before the code exists rather
than after. The foreign-currency item is the worked example: it is here, and on the `CURRENCIES`
list that whoever writes `amount > THRESHOLD` will be reading.

---

## How to re-measure this, rather than trusting it

```bash
grep -rn --include=*.ts --include=*.tsx --include=*.sql --include=*.prisma --include=*.md \
  -iE "NOT (YET )?IMPLEMENTED|unimplemented|is NOT BUILT|not built in this module|belongs to (a )?later module|module 1[0-9]" \
  apps packages docs README.md | grep -v node_modules | grep -v /dist/ | grep -v /.next/
```

A register entry with no matching declaration in code is stale. A declaration in code with no
register entry is the gap this file exists to close.

---

## Module 0-ب — provider registration

**Status at the module's close, 2026-10-14 — and this line was itself stale until now**, which is
the reason it carries a date: it said "items (d), (e), (f) and (g) are not built" long after three of
those four were.

| Item | State |
|---|---|
| (a) a provider user signs in | **built** |
| (b) the provider administers itself | **built** — six self-administration codes |
| (c) the eight reference tables | **built** — with a nullable Arabic description on the rule-bearing ones |
| (d) register a brokerage office | **built** — `POST /provider/brokerage-offices`, plus decision 88's reopen |
| (e) register an insurance company | **built** — service, screen and resolver |
| (f) invite the first administrator | **BUILT, BOTH HALVES** — the brokerage invite (`POST /provider/brokerage-offices/:id/administrator`), and the company half: registration now creates `INSURANCE_COMPANY_ADMINISTRATOR`, `POST /provider/insurance-companies/:id/administrator` invites it, and `/company-record` is the company's read-only screen. The stop condition was answered rather than dissolved — it ships the honest SIX self-administration codes, and entry 26 records why that is the whole set |
| (g) PLATFORM scope on this module's codes | **built, and it was already satisfied** — the two provider codes carry it, the two office codes correctly do not, and the literal over-reading is refused by the permission grid guard by name |

**Item (f) shipped the honest six** — the owner's decision, taken. What remains open is the owner's alone: whether the close's demonstration offices and companies are written to **dev**, which is effectively irreversible once a user exists inside one (an audit row makes the organization permanently undeletable — measured, see entry 33's neighbourhood and
`company-administrator-invitation.e2e-spec.ts`'s header).

### Declared and verifiable now

| # | Item | Article / decision | Declared in code at | Why deferred |
|---|---|---|---|---|
| 1 | **Art. 13/b/2 — the 50,000 JOD branch-expansion capital** | CBJ Instr. 9/2026 art. 13/b/1–4 | `broker-license-scope.config.ts` header | The system models **no physical branch offices**. Art. 13's فروع are physical branches; art. 4/a's are insurance lines — the same word, different nouns. A guard built on the branch count this file holds would tell every office with six or more *lines* that it needs 50,000 JOD. The four conditions are also **conjunctive**, so a capital-only guard would be wrong even once branches exist. |
| 2 | **Role scope guards WRITES and not READS** | Module 0 item (h), decision | `docs/decision-role-scope.md` § 4.2 | `prisma.policy` is reached from 31 non-spec files, most of them dashboards and finance reports. A read filter would silently narrow an office's own totals to one insurance type and present them as the office's figures. A wrong number that looks right is worse than a refusal. |
| 3 | **The provider administrator's self-grant is bounded by practice, not by schema** | Module 0 item (j) gap closure | `packages/db/prisma/seed.ts` (`ensureProviderOrganization`), README § Known gaps CLOSED | Nothing structurally stops a provider administrator granting their own role `customer.create` — they hold `role.update` and the catalogue is global. What bounds it is a provider that starts with exactly **nine** codes (measured 2026-10-14 on both databases — it was seven until item (e) added `provider.insurer.register`; the figure is read from the database, not from this register) and a seed check, inside a transaction, that fails if the set changes. A GRANT-level closure, not a schema-level one. |
| 4 | **`InsurerMaster` is vestigial for WRITES only** | Decision 63 | `schema.prisma` (`InsurerMaster`), `docs/decision-insurer-field-split.md` § 4 | No registration creates one, but it is **read in 24 non-build source files** — including `insurer-identity.ts`, which decides what an insurer is *called*. Neither revived as the registry nor deleted. Removal is a later module's. |
| 5 | **Insurer directory search is by NAME only** | — | `docs/insurer-directory.md` | Searching by line of business is not implemented there; the provider dashboard is a separate surface. |
| 6 | **The dev seed drift** | Measured, Part E (E1) | *(development data — not repaired)* | `seed.ts` grants to the DEFAULT office's roles only, so codes added after an office was created never reach it. **RE-MEASURED 2026-10-14 AND THE OFFICE IS GONE:** dev now holds exactly TWO organizations — `default` (brokerage office) and `provider` — so the demo office this entry measured no longer exists, and the seeded `OFFICE_ADMINISTRATOR` holds **47 of 47, missing 0, extra 0**. The drift is not repaired, it is *absent*, because the drifted office was removed by a reseed. The entry stays because **the mechanism is unchanged**: the seed still grants to the DEFAULT office's roles only, so the next office created outside the registration route will drift the same way. (Earlier measurement, kept: the demo office's `OFFICE_ADMINISTRATOR` held 36 of 45.) Item (d) must compute a new office's grant set from the catalogue and copy from no office; the existing dev drift is development data and is recorded, not repaired. |
| 7 | **AML art. 17/a retention is NOT built** | AML/CTF Law 20/2021 art. 17/a | `packages/db/prisma/seed-data/retention-schedule.ts` header | `RetentionScheduleItem` holds exactly ONE row — a 120-month `AuditLogEntry` draft. There is no AML retention rule for customer due-diligence records, account files or transactions. The citation was corrected; correcting a citation is not building the rule. |
| 8 | **No Arabic-name backfill** | Part E (E3) | `migrations/20261119100000_…/migration.sql` | Measured zero rows lacking one, so the column tightened. If a future database holds such a row the migration **fails** rather than inventing a legal name nobody can source. |
| 9 | **Art. 3/a/1's person-level rule** | CBJ Instr. 9/2026 art. 3/a/1 | *(not yet declared in code — see "Owed" below)* | A corporate broker may hold both types only if the *same* manager, practitioner or employee does not handle both. Module 0 modelled the office-level rule and not the person-level one. |
| 10 | **`RegulatoryAction` cannot express a PARTIAL sanction** | CBJ Instr. 9/2026 art. 21/b/5–6 | `migrations/20261122100000_…/migration.sql` header | Art. 21/b/5 suspends or cancels «في جميع فروع التأمين ... أو بأي منها» — in ALL the insurance lines or ANY OF THEM — and 21/b/6 does the same for an office branch inside or outside the Kingdom. Every act in this table is TOTAL. **The direction is stated because it is not the safe one**: a partial suspension recorded as total reports an office as unable to write business it is lawfully still licensed for, which runs AGAINST the brokerage — the same direction as the empty holiday calendar. Nothing in this module claims the act model is complete. |
| 11 | **Whether art. 14/c reaches an art. 21/b suspension is UNSETTLED, and is not inferred** | CBJ Instr. 9/2026 arts. 14/b, 14/c, 21/b | `license-standing.config.ts`, and the migration header | 14/b scopes itself to «الفقرة (أ) من هذه المادة»; 14/c carries no such phrase. The text reads either way. Today it only matters for a 21/b suspension that states no period, since one that names its own end date expires on its own. **A question for the regulator, deliberately not resolved by reading** — correction 0.1 of this module was stripping a rule asserted under an article that did not carry it, and inventing the opposite here would be the same mistake with the sign flipped. |
| 12 | **`BrokerLicense.status = 'lapsed'` is a SECOND HOME for what `RegulatoryAction` now models** | decision 71 | `broker-license.config.ts`, `license-standing.config.ts` | The manual marker predates the act table and is IN USE — measured: 0 rows on dev, 19 on db-test, with `BrokerLicenseRepository.markLapsed` reachable from the service. The derivation reads it as SUSPENDED with a NULL decision reference (its own documentation says it means a CBJ suspension), so nothing is currently wrong — but two homes for "has the regulator stopped this office" is one too many. **The collapse order is: record acts for whatever the marker was standing in for, THEN drop the column** — never the reverse, which would lose the fact before it was recorded anywhere. |
| 13 | **The eight reference tables cannot RETIRE a row** | item (c), item (d) | `reference-data.service.ts` | They carry `code`, both names, `descriptionAr` and `displayOrder` — and no `isActive`. Found by the compiler: the first version of the reference service carried a paragraph explaining how retired rows are handled. A column is NOT invented, because the question it raises is a decision: what happens on the screen of an office whose stored legal form has been retired — does it still render, and does it still validate? |
| 16 | **There is no API-WIDE way to CLEAR an optional value** — decision 93 gave the rating its own narrow exit, the general convention is still owed | decision 93 (the exit); the convention is unowned | `insurer-crud.dto.ts`; the exit is `DELETE /insurers/:id/financial-strength-rating` | **The narrow exit EXISTS**: one action clears the financial-strength rating and its as-of date in one write, because they are a pair by `Insurer_rating_carries_its_date` and clearing one alone either violates it or strands the other. What is still owed is the GENERAL fix — **an explicit `null` means clear, absent means no change, an empty string is refused** — which is an API-wide pass and was deliberately not invented for one field, since that would be a third way of saying "remove a value" in a codebase that already has two. The DTO's length rule and `emptyStringToUndefined` are untouched. Found while writing decision 90's merged-state test, which first tried to clear a date and got a **400, not a 422**: an empty string is refused by the DTO's length rule before any service rule runs, and `emptyStringToUndefined` turns an empty date into "no change" rather than into a clear. So a rating entered in error stays forever, and so does its date. **Pre-existing, not introduced by item (e)** — the rating column has behaved this way since Process 31 — and NOT patched here, because "clear" needs a convention this API does not have (an explicit `null`, a `DELETE` sub-route, or a sentinel), and inventing one for a single field would be a third way of saying "remove a value" in a codebase that already has two. |
| 15 | **A `Document` reference can cross offices at the DATABASE level, on four tables** | multi-tenancy Phase 2 | *(measured 2026-10-13; no single declaration site — see below)* | Measured: `Document` carries `organizationId` and has **no `(id, organizationId)` unique**, so none of its four referrers can carry the composite tenant foreign key the rest of this schema uses — `BrokerLicense.certificateDocumentId` (module 0 item (c)), `ClaimDocument.documentId`, `Document.previousVersionId` and `RegulatoryAction.documentId` (item (d)). **Bounded, not open**: `Document` is tenant-scoped and RLS-protected, so the application cannot read another office's document to obtain its id; the composite FK is the defence-in-depth for the raw-query and forgotten-`where` case, which is precisely what the other thirteen exist for. **Deliberately NOT fixed on one table alone** — adding it to `RegulatoryAction` only would make the newest table look guarded while three older ones are not, and leave the next reader believing the pattern is handled. It is ONE coherent change (one unique on `Document`, four composite FKs) belonging to whoever next touches document tenancy. |
| 29 | **`AuditService.record` MUST NOT be called inside a `$transaction` callback, and MUST NOT be called inside `runAs` for a cross-tenant write** | item (f) | `office-administrator-invitation.service.ts`, beside the call; the working precedent is `office-registration.service.ts` | Two placements, two different failures, both found by running it. **Inside `$transaction`:** every invite was a 500 — `new row violates row-level security policy for table "AuditLogEntry"`. `AuditService` uses its OWN client, not the `tx` handed to the callback, so inside an interactive transaction it runs on a DIFFERENT CONNECTION where that transaction's `app.current_org_id` was never set. **Inside `runAs` but after the commit:** it SUCCEEDS, which is worse. The row lands in the OFFICE's tenant, and an office carrying one audit row can NEVER BE DELETED — `AuditLogEntry_organizationId_fkey` is `ON DELETE RESTRICT` and DELETE on the table is refused outright by the `audit_log_entry_no_delete` trigger. **Two offices were stranded in db-test proving it**, and clearing them needed the trigger disabled and re-enabled by hand. The row's actor is also a PROVIDER user, so the office's own tenant-scoped actor lookup could never resolve it. **The correct placement is OUTSIDE `runAs`, in the provider's log** — which is what `office-registration.service.ts` already does one file away, and why registered offices are deletable at all. |
| 30 | **The permission-descriptions MIRROR accumulates superseded drafts, and the gate's own advice would destroy the owner's text** | — | `docs/permission-catalogue-for-descriptions.txt`; `npm run db:permission-descriptions:check` | Measured 2026-10-15: the mirror held FOUR stale `ar:` lines — `provider.office-state.read`, `provider.office.register`, `insurer.company.link`, `insurer.company.unlink` — every one an agent's earlier draft, and in every case the dictionary held the OWNER's newer text. The gate names them one at a time and says *"Move each one into permissions.ts under its `perm:<code>` key"*. **Doing that mechanically would have overwritten all four of her lines with mine, one message after she wrote them.** The gate cannot tell a line she typed into the mirror from a stale generated copy, and its advice is only correct for the first. **The safe procedure, used here:** audit EVERY mismatch at once before removing anything, keep any line whose code the dictionary does not have (that one is hers), delete only lines that disagree with an existing dictionary entry, regenerate, and verify her text survived. A one-at-a-time response to this gate is how her work gets lost. |
| 31 | **THE PROVIDER OPERATOR CANNOT BE REACHED ON DEV WITHOUT AN ACTION ONLY THE OWNER SHOULD TAKE** | Part F — my own walk | `docs/module-0b-my-own-walk.md`; the seed's own log line | Measured: `operator@ibms.local` has **no usable password** (`randomBytes(32)` hashed by the seed, so nothing knows one), and the only route in is a password reset — which `ENABLE_DEV_RESET_TOKEN` would have made possible for me. **I stopped deliberately**: setting that password changes the owner's credentials on the database she is about to walk, which is the same class as the held `demo:release` and the standing rule that neither release script touches a password. The repository's credential-safety hook also blocked it, as a FALSE POSITIVE (the command wrote nothing to disk), and the right response was still not to route around it — a gate worked around is a gate that stops catching things. **So the authenticated walk is hers, and it costs TWO steps before any screen appears**: request the reset, then pair an authenticator, because `PLATFORM_OPERATOR` is `requiresMfaAlways`. Worth knowing before she sits down rather than during. |
| 32 | **FOUR TypeScript files under `scripts/` ARE LINTED AND TYPECHECKED BY NOTHING — and one of them has already produced this repository's only high-severity CodeQL alert** | found 2026-10-15 while editing one of them | `scripts/generate-reference-values.ts`, `generate-permission-descriptions-input.ts`, `generate-sla-policy-seed.ts`, `export-permission-catalogue.ts`; the precedent and the fix are `packages/db/tsconfig.seed.json` | Measured: **there is no root `tsconfig.json` at all**, and both `npm run lint` and `npm run typecheck` are `turbo run`, which runs per-workspace tasks only — so nothing in the monorepo's gates reaches the repo root. These four run through `tsx`, which **strips types rather than checking them**, the same trap this repository has already recorded three times for swc/vitest and once for `sample:release`. **This is not hypothetical for this class**: `export-permission-catalogue.ts:107` carried the one CodeQL high-severity alert on this project's history, and the pipe-escaping defect behind it is exactly the kind a reviewer catches and a non-existent gate does not. **The fix is known, small, and already has a precedent in this repo** — `packages/db` added a typecheck-only `tsconfig.seed.json` for exactly this reason, because the build's `rootDir` made widening the existing `include` a TS6059 error. A `tsconfig.scripts.json` wired into a root `typecheck` task is the same move. **NOT done here**: adding a gate changes the build, which is outside both this close and the three-item short pass the owner bounded. The edit that found it was verified the only way available — the script RAN and produced output cross-checked against an independent `grep -c OWED`, and an ad-hoc `npx tsc --noEmit --strict` on the file exited 0. **A verification that has to be improvised per edit is the symptom; the gate is the fix.** |
| 33 | **A permission code added by the SEED does not reach dev until the seed is re-run; one added by a MIGRATION does — and that asymmetry left item (f)'s invite route unusable on the owner's own walkthrough database** | found 2026-10-15 while verifying the pre-flight list's figures | `packages/db/prisma/seed-data/permissions.ts:1893`; `provider.controller.ts:52`; **FIXED on dev by `npm run db:seed`** | Measured before touching anything: **dev held 225 catalogue rows, db-test 226**, and the provider's role held **9 codes on dev against the 10 `office-administrator.e2e-spec.ts` pins**. The missing one was `provider.office.administrator.invite`, and `POST /provider/brokerage-offices/:id/administrator` is gated on it — so on the database the owner is about to walk, **the provider could not invite an office administrator: a 403 on the only path item (f) built, leaving item (d) built and unusable**, which is the exact failure the brief named item (f) to prevent, reappearing one layer down. **THE ASYMMETRY IS THE FINDING AND IT IS WHY THIS WAS INVISIBLE:** the retention split's two codes WERE on dev, because they arrived in migration `20261128110000`, which is applied to both databases by the same command that proves the schema. Item (f)'s code arrived in the SEED, which nobody had re-run on dev. **Two codes added in the same close, one present and one absent, on one database.** No gate can see it: `db:checksums`, `db:divergence` and `db:privileges` all compare the SCHEMA, and a catalogue row is DATA. **Fixed, with the delta measured rather than assumed** — full row counts captured before and after, and the diff is exactly `Permission 225→226` and `RolePermission 518→519`, with users, roles, organizations, licences, holidays, insurers, branches and audit rows all unchanged; the seed's own log confirms `operator@ibms.local already exists — password untouched`, so no credential moved. **The durable lesson: after adding a permission, re-run the seed on DEV, not only on db-test** — the five regenerations this repository already requires are all about generated FILES, and none of them touches the dev database. |
| 34 | **`GET /customers/search` COULD RETURN NOTHING FOR A CUSTOMER THE SEARCHER OWNS — FIXED 2026-10-15; kept because the measurement and the reasoning are the reusable part** | found 2026-10-15 by a local full api e2e run; **FIXED in `ef6adce`** — the owner filter and a total order moved ONTO the inner query, so the bound selects from exactly the rows the caller may see. Tenancy was never the problem and is untouched; what was missing was the OWNER filter, which RLS knows nothing about. Proven by planting the defect back: `expected [] to include '<uuid>'` on exactly the two search tests, 26 passing, then restored at 28/28 | `apps/api/src/repositories/customer.repository.ts#searchForPicker` | `searchForPicker` runs a raw `tsquery` over the WHOLE table with `LIMIT <take>` and **no `ORDER BY` and no owner filter**, then re-applies tenancy and `ownerUserId` to the ids that came back. So the bound is spent on rows the caller may not see, and whichever rows survive is plan-dependent. **MEASURED on db-test:** 1,592 customers, of which **14 match the term across 14 DISTINCT owners**, against an inner `LIMIT 10` — so **4 of those 14 officers get an EMPTY result for a customer they own**, and which four can change between identical requests. It is not a page-overflow artefact: the response is `[]`, not ten other people's rows. **This is the owner's own feature failing for the role it was built for** — "one field finds a customer" came from her sitting down and saying *this is right but it is not practical* — and it degrades as an office's book grows. **The method's own comment already argues the fix for the OUTER query and the inner one never got it**: *"A TOTAL order. `legalName` alone is not one... which of them a bounded search truncated away would change between identical requests."* **NOT FIXED HERE, deliberately.** The comment beside the owner filter says it sits outside the `OR` *"deliberately... a registration-number match would ignore it and hand a Sales officer a customer belonging to a colleague — a search that discloses more than the list it is a shortcut to."* Moving the filter inward is therefore a change to a disclosure boundary, not a tuning fix, and this close's discipline for that shape is to measure the price and leave the decision to the owner. **CI CANNOT SEE IT**: CI builds db-test from nothing, so the term matches one row with one owner and the bound is never reached. **SCOPED BY MEASUREMENT, AND IT IS ONE METHOD RATHER THAN A CLASS.** All six picker searches were read: `insurer`, `policy`, `user`, `branch` each use a single Prisma `findMany` with `orderBy` + `take`, and `employee` uses `searchByName` the same way — bound and filter in ONE query, so the defect cannot occur. `policy` carries an `ownerUserId` filter and is still safe for exactly that reason. Then every repository was swept for a raw `LIMIT ${...}`: four hold SIX sites between them (`customer` ×2, `insurer-directory`, `invoice` ×2, `watchlist-entry`) and each was read to its closing brace — `insurer-directory.findPage` and both `invoice` loaders return or map their rows directly with no second filtered read. **So `searchForPicker` is the only instance.** **AND A SECOND INSTANCE I REPORTED WAS WRONG, corrected before it reached this register:** I read `findByCanonicalPersonName` as raw-LIMIT-then-`status: 'ACTIVE'`, which would have made the duplicate-name WARNING under-report. It is a single raw query — organization, customer type, the canonical key, a deterministic `ORDER BY "createdAt" ASC` and the LIMIT all inside it — and the `findMany({ where: { status: 'ACTIVE' } })` I attributed to it is **`findActive()`, the next method down**, used by the screening batch. A 25-line grep window crossed a method boundary: the same window-artefact class this repository already records for head-truncated greps. **A FIX EXISTS THAT DOES NOT TOUCH THE DISCLOSURE BOUNDARY, and it is already in this codebase:** `watchlist-entry.repository.ts#findMatchCandidates` runs a bounded raw query and then REPORTS its own truncation (`truncated: rows.length > WATCHLIST_CANDIDATE_LIMIT`), so a caller can never mistake a cut result for a complete one. Reporting truncation, raising the inner bound, or giving the inner query a total order are all available without moving the owner filter inward — which is the option that would change what a Sales officer can see. **Which of those is right is the owner's call; the measurement is here so it can be made without re-deriving it.** |
| 35 | **TWO api e2e TESTS HAD BEEN FAILING ON EVERY LOCAL RUN SINCE THE FIRST ONE, so the local full-suite gate was never clean and nobody knew — FIXED, recorded because the consequence is systemic** | found 2026-10-15; **FIXED** | `apps/api/test/auth-mfa-session.e2e-spec.ts` | Both onboarding tests created an employee with **fixed Arabic name parts** (`طارق ناصر كريم الزعبي`) while making only the national id run-unique. `POST /employees` pre-checks the CANONICAL PERSON NAME and answers 409, so the name passed the first time it ever ran against the cumulative db-test and **409'd forever after**. **This repository recorded that exact lesson on 2026-10-11** — *"a cumulative-database e2e needs run-unique PERSON NAMES, not just unique ids"* — for a different spec; this file never got the fix. **THE SYSTEMIC PART IS THE COST, not the fixture.** The repository's stated workflow is targeted-locally and full-in-CI, which depends on a local full run being usable when a change's blast radius is wide. A suite with permanent known failures stops being read: three blast-radius misses in this module went to CI red, and a clean local full run is exactly what would have caught them. **FIXED by composing the name from a run-unique `tag` AND composing the assertion from the same fixture**, so the two cannot diverge; the second fixture got the same treatment because its own 409 assertion is about a *taken employee link* and a duplicate-person 409 would masquerade as it. **Proven: two consecutive clean runs at 28/28, then the fixed name PLANTED back — which reproduces `expected 201 "Created", got 409 "Conflict"` on exactly that one test with 27 passing — then reverted, re-grepped and 28/28 again.** The local full run also showed a third failure, `up-sell.e2e-spec.ts`'s dismiss test at **218 seconds**, which passes in isolation: a load timeout under the parallel full run, recorded as an artefact rather than a defect. **AND THE TARGET IS "NO UNEXPLAINED FAILURES", NOT "CLEAN" — stated because this entry would otherwise contradict itself.** Entry 34's test is deliberately LEFT FAILING, so a full local run shows **two expected failures** until that decision is made. Leaving it red perpetuates the exact erosion this entry is about, and SKIPPING it would hide a real product defect — so the readable target is two known failures, both named here, and any third is a finding. **What was NOT demonstrated: a complete local full run since the fix.** TWO attempts were killed with effectively no output (10 bytes, then 57) while an earlier piped run had completed, so this is an ENVIRONMENT LIMIT rather than bad luck and a third attempt is not the answer. The evidence is therefore the targeted runs above and not a full-suite pass; saying otherwise would be the kind of claim this register exists to prevent. **What DOES cover the full suite is CI, verified by reading the workflow rather than trusting the contract**: the `backend` job's "Integration tests" step is `npx turbo run test:e2e --filter=api...`, UNFILTERED, and it is green on every commit of this close. What CI cannot show is the CUMULATIVE-database behaviour — it builds db-test from nothing — which is precisely and only what this entry and entry 34 are about. |
| 36 | **THE LINK'S READ-ONLY EFFECT WAS SCREEN-ONLY — the API accepted the write** | found 2026-10-15 while checking the owner's Arabic against the code; **FIXED 2026-10-16** at the owner's instruction — "a guard that lives only in the screen is not a guard" | `insurer-identity.ts#officeMayEditCompanyFacts`, `insurer.service.ts#update` | Linking an office's `Insurer` record to a registered company sets `insuranceCompanyId`, and `officeMayEditCompanyFacts` then returns false — but that value is **projected onto the VIEW and consumed by the screen**. `insurer.service.ts#update` refuses only a RENAME (`insurerMasterId !== null`) and applies the rating rule; it does **not** refuse the company columns when `insuranceCompanyId` is set. So the office's copy is read-only in the UI while the server still honours a direct `PATCH`. **A hidden control the API still honours is not a boundary** — the rule module 0 item (j) established with three layers (the matrix hides the code, `setPermissions` refuses it, the route checks the organization type), and this is one layer. **FOUND BY A WORDING CHECK, WHICH IS THE PART WORTH KEEPING:** the owner supplied her own Arabic for `insurer.company.link` / `.unlink`, and the agent drafts she replaced CLAIMED the copy "becomes read-only" / "becomes editable again". Checking her text against the code to see whether it described less than the code does revealed the opposite — **her lines were more accurate, and adopting them removed an overclaim.** **CLOSED.** `insurer.service.ts#update` now calls `officeMayEditCompanyFacts(row)` — THE SAME FUNCTION THE VIEW CALLS, never a second predicate, because a second spelling of the condition is a second answer to "may this office type over a registered company's details" and the copy is the one that drifts. The touched keys are DERIVED from `companyFrom(dto)` rather than listed, so a company fact added to the DTO later is covered the moment it appears there; `legalName`/`legalNameAr` are added explicitly because the name has its own column and is not a member of `InsurerCompanyFields`. The refusal is a 422 NAMING the fields and the way out (unlink first) — not a 403, which would be wrong twice over: the caller holds the permission and the record is theirs; what changed is WHO ANSWERS for those columns. **THE RELATIONSHIP TERMS STAY EDITABLE, and that is asserted rather than assumed** — a refusal that also caught `rfqContactEmail` or the credit terms would be a worse defect than the original, because an office would have to unlink a company to record its own commission terms. **AND THE REASON IT SURVIVED IS MEASURED: the link route had NO api e2e of any kind.** `POST /insurers/:id/company-link` and its DELETE were addressed by no test in the suite — a greyed-out field is not evidence about a server. Four tests now sit in `insurer-crud.e2e-spec.ts` (refuse a company fact, refuse a rename, accept the relationship terms, unlink-gives-them-back so the refusal is proven to be the LINK rather than a permanent lock), and the first asserts the write DID NOT HAPPEN as well as the status, since a 422 proves what the route answered and not what it stored. **Proven by planting `if (false)`: exactly the two refusal tests die, 31 pass, and the two that prove narrowness still pass.** 33/33 twice consecutively on the cumulative db-test, the `INSURANCE_COMPANY` fixture swept on entry and exit, db-test left holding 1 brokerage office and 1 provider. |
| 37 | **db-test carries 35 leftover `RetentionScheduleItem` rows from e2e runs — test litter inside a compliance table** | found 2026-10-15 while measuring the retention clock; **NOT CLEARED** | *(development data)* | Measured: dev holds exactly ONE row (`AuditLogEntry`, 120 months, a long DRAFT/UNCONFIRMED `legalBasis` that already cites art. 17/a correctly and says the figure is a guess). db-test holds **36** — that one plus 35 named `E2E-Category-*`, `E2E-Review-*`, `dual-role-*` and `self-confirm-*`. Harmless to any assertion today, and recorded for two reasons: a compliance table full of fixture rows is the kind of thing somebody later reads as a configured retention policy, and the pattern says those specs create rows they never remove. **Not cleared here** because deleting rows from a table whose whole subject is retention is a decision about development data, not a cleanup to do silently. |
| 38 | **The company's own-record RESPONSE SHAPE had no proof against the real producer** | item (f) company half; **CLOSED 2026-10-16** at the owner's instruction, on her sentence — "the test that matters is the one proving the response does not carry what we excluded. That test defends the owner's decision, not the code." | `company-administrator-invitation.e2e-spec.ts` header; `company-record.spec.ts` | Authenticating as an invited company administrator writes `AuditLogEntry` rows into that organization's own tenant. `AuditLogEntry_organizationId_fkey` is `ON DELETE RESTRICT` and DELETE on the table is refused outright by the `audit_log_entry_no_delete` trigger, so **ONE login makes the organization permanent** and db-test would accumulate one company per run — two brokerage offices were stranded proving exactly this, and clearing them needed the trigger disabled and re-enabled by hand. **So the split is deliberate**: the api e2e covers the invite and every refusal (which need no company, or need one that is never signed into), and the populated screen is covered by Playwright against a mocked response — 8 tests including the four deliberate absences and the record-state clause asserted VISIBLE. **What is therefore NOT proven end to end** is that the api's response shape matches what the screen reads, which is the hand-copied-interface drift class this repository has shipped twice. **CLOSED by the first of those two, with the stranding limit unchanged rather than worked around.** `company-record-shape.e2e-spec.ts` calls `CompanyRecordService` inside `orgContext.runAs`, which `last-administrator-lock.e2e-spec.ts` already establishes as "the same code path a request takes after `JwtStrategy` has established the office": real service, real Prisma, real database, real RLS context, **no login** — so the fixture company is deleted at the end and db-test gains nothing. **THE CENTRE IS AN EXACT KEY SET AT BOTH LEVELS, because a leak arrives as an ADDITION** — five top-level keys and twenty-two identity keys, so a sixth is a decision rather than a diff, where every `toHaveProperty` in the world keeps passing while somebody adds a convenient field to a response a COMPANY reads. Beside it, a per-noun sweep names what the shape may never mention however it is spelled. **Proven by planting a leak** — `financialStrengthRating: 'A-'` into `identity` — which kills TWO tests, the key set and the sweep, catching it from both directions; 6/6 twice after reverting. **THE NOUN LIST'S FIRST RUN WAS TOO BLUNT, AND THAT CORRECTION IS THE REUSABLE PART:** a bare `insurer` failed immediately — on `insurerLicenseNumber`, the company's OWN licence number and the most legitimate field on the whole response. A sweep coarse enough to flag that is a sweep somebody deletes the first time it goes red, so the nouns now name the office-owned FIELDS (`financialStrengthRating`, `creditTerms`, the three contact sets, `linesOffered`, `insuranceCompanyId`) rather than the subject area. **WHAT IS STILL NOT PROVEN, stated because the gap is the whole point of this entry:** the HTTP transport — the controller's serialisation, the guard chain, the status code. The invitation spec covers the route's reachability and its refusals and Playwright covers the screen against a mocked body; what is closed is the MIDDLE, that the shape those two agree about is the shape the service actually produces. One further artificiality is named in the file rather than left to be found: the audit row is routed to the DEFAULT OFFICE (`runAs(officeId)`, with the ACTOR's `organizationId` set to the company) because naming the company would strand it — which means `Document` is read from the wrong tenant, so the fixture asserts the `certificate: null` branch. That is a real state a newly registered company is in, and the KEY SET is identical either way because the key is present and null rather than absent. |
| 39 | **THE ELEVEN ENUM MEMBERS HAD AN ARABIC DESCRIPTION AND NOWHERE TO PUT IT — CLOSED 2026-10-16 as option (3)**, the owner's decision in her own words: "twenty-two keys nothing renders is the shape the enforcement inventory exists to reject." | the owner's 46 descriptions, 2026-10-15; **ALL 46 LANDED** | `reference-tables.ts` (the 35 that landed); `translations/enums.ts` (labels only); `regOfficeBrokerageKindNote` (the one precedent) | The eight reference tables each carry a nullable `descriptionAr` that the registration client already reads — marked *"present only where the VALUE CARRIES A RULE"* — so the owner's 35 reference descriptions went straight in and are **44 of 44 described on BOTH databases**, with the export's owed figure falling 46 → 11. **The four enums have no such column.** `BrokerageKind`, `RegulatoryActionKind`, `RegulatoryActionBasis` and `IntegrationMethod` carry only LABELS, in `translations/enums.ts`, and nothing in the product renders a description for an enum member. **THREE HOMES ARE POSSIBLE AND EACH COSTS SOMETHING, so this is a decision rather than a task.** (1) i18n keys beside the labels — cheap, but the AR/EN parity guard then demands English I would write, and 22 keys nothing renders are dead keys, which is the shape the enforcement inventory exists to refuse. (2) A screen note per field, which is the ONE precedent that exists: item 16 already put `regOfficeBrokerageKindNote` under the brokerage-kind select, in both languages, saying exactly what the owner's two `BrokerageKind` lines say — so that pair is arguably already delivered in substance, on screen, where a person choosing the value reads it. (3) A provider-maintained table per enum, which is the `reference-tables` shape and the honest home if these values are ever to be described systematically — and is also how item (c) decided enum-versus-table in the first place: *an enum when the value is closed and code may branch on it; a provider-maintained table when rows are added over time.* These four are closed and branched on, so (3) would mean a description table beside an enum rather than instead of it. **CHOSEN: (3), A DESCRIPTION TABLE BESIDE EACH ENUM**, with (1) ruled out in the words above. Migration `20261130100000_value_descriptions` creates `BrokerageKindDescription`, `RegulatoryActionKindDescription`, `RegulatoryActionBasisDescription` and `IntegrationMethodDescription`, each keyed by a `member` column typed as THE ENUM ITSELF — so a description for a member that does not exist is UNREPRESENTABLE rather than merely wrong, and Postgres refuses it. What a database cannot express is COMPLETENESS, which is the one property left for a guard: `enum-descriptions.spec.ts` reads the GENERATED Prisma enums — never a hand-written member list, which would be a second home for the same fact, and the `AuditAction` parity guard next door exists because of exactly that — and asserts an EXACT SET per enum, four enums, eleven members, Arabic script and a length floor. **THE TEXT'S EDITABLE HOME IS `seed-data/enum-descriptions.ts`, NOT THE MIGRATION:** entry 33 established that data arriving only through the seed never reaches a database nobody reseeds, so the migration INSERTs the eleven — but an applied migration cannot be edited without drifting its checksum, so the text needs a home somebody can correct and the seed upserts from it. Both databases carry 11 rows and 8 `*_description_required` CHECKs. **THE TWO LEGALLY-CONSEQUENTIAL LINES WERE CHECKED AGAINST THE CODE AND NEEDED NO CORRECTION:** `BROKER_REQUEST` and `SANCTION`, against `license-standing.config.ts`, where `deemedCancelled` is keyed on `basis === 'BROKER_REQUEST'` alone — her Arabic says the two-year deemed cancellation applies to a broker-request suspension and that art. 14/c's application to a SANCTION is unsettled in the text and is not computed, which is exactly what the code does. **AND (2) IS KEPT AS WELL AS (3), on her instruction:** `regOfficeBrokerageKindNote` stays under the brokerage-kind select. Both `BrokerageKind` lines carry the clause «ولا يقرأه» — *and nothing reads it* — and a test asserts that clause is present, so a future change quietly promoting the field to meaning something fails by name here rather than appearing as a description that has become false. **The export's owed figure is now 0 of 55.** |
| 27 | **`sanctions-pep.screen` PROMISES PEP SCREENING AND THERE IS NO PEP LIST — and the overclaim is in the STORED RECORDS, not only in the name** | deferred 2026-09-28; measured 2026-10-15 | `screening.service.ts` (`SCREENING_TYPES`, the result loop); the code's own catalogue description | **What the name says:** sanctions AND PEP screening. **What it gates:** 17 routes across screening, watchlist sync and screening configuration. **What the code does:** `SCREENING_TYPES = ['SANCTIONS','PEP','AML']` and the loop writes one `ScreeningResult` per type **with the same outcome, the same `listSource`, the same provider and the same dataset version** — the type is a LABEL on the row and narrows nothing. Measured on db-test: the watchlist holds **only `OFAC_SDN` (1) and `UN_CONSOLIDATED` (30)**, both sanctions lists, and there are **389 rows saying `PEP` and 389 saying `AML`** beside 390 saying `SANCTIONS`. So a PEP result is a sanctions result relabelled. **The risk rating states it too** — its reason reads *"all sanctions/PEP/AML screening results were CLEAR"*, a sentence asserting three screenings on the strength of one. And `UltimateBeneficialOwner.isPep` is a MANUALLY DECLARED KYC flag that the service deliberately never treats as a screening input, so it is not the missing source either. **This is the same class as every other finding in this close — a claim the code does not support — except it is in stored compliance records and in a rating's stated reason rather than in a comment, which is why renaming the code alone would not fix it.** Nothing changed; the decision follows the measurement. |
| 28 | **`aml.monitor` names a control over transactions and gates a queue over records already written** | deferred 2026-09-28; measured 2026-10-15 | `transaction-monitoring.controller.ts`; and § 1.58 obligation 2 | **What the name says:** AML monitoring. **What it gates:** 5 routes on the transaction-monitoring ALERT queue — listing, reading and resolving alerts raised by a periodic sweep. **What is absent, and it is the recorded obligation:** nothing in `invoice.service.ts`, `refund.service.ts`, `commission-ledger.service.ts` or `collection.service.ts` consults screening at all, so **no transaction is screened before it is processed** — the AMLU's "before processing any transaction" requirement. So the code grants oversight of a detective sweep while its name promises a monitored transaction path. **Renaming is the LAST option considered, not the first** (the owner's instruction): the code is held across roles in every office, and a rename touches every one of them. The honest alternatives are to correct the DESCRIPTION, which is read at the moment of granting, or to build the gate the name implies — which is module 15's and is deferred with the AML work. |
| 26 | **THERE IS NOTHING FOR AN INSURANCE COMPANY TO DO IN THIS SYSTEM — so `INSURANCE_COMPANY_ADMINISTRATOR` can only hold self-administration** | item (f); decision 63 | measured 2026-10-14; the comparison set is `PROVIDER_CODES` in `packages/db/prisma/seed.ts` | **Raised BEFORE writing item (f), because the brief's instruction — "build its code set by SELECTING from the catalogue, do not copy the 45 and delete what looks surplus" — selects almost nothing.** Three measurements. (1) **No authorization path reads `INSURANCE_COMPANY`**: the only non-spec reads are the link service validating a target and the registration service writing it; every type-based access check in the api is for `PROVIDER` (four sites). (2) **All 224 codes across all 12 modules are brokerage-office functions** — `insurance-operations`, `commercial-front-office`, `admin`, `compliance-risk`, `supporting-operations`, `pdpl`, `finance`, `management-reporting`, `claims`, `customer-service`, `sla`, `customer`. There is no company-facing module. (3) Every office model is tenant-scoped, so a company organization has **zero rows in all of them by construction** — the same closure the provider has. **So the honest selection is the SIX self-administration codes and nothing else** (`user.manage`, `role.read`, `role.create`, `role.update`, `role.deactivate`, `permission.read`) — exactly the six the provider holds beside its three provider capabilities, and labelled as self-administration in `PROVIDER_CODES` already. A company administrator could sign in, enrol MFA, and administer its own users and roles; **those users would then have nothing to open.** Granting any office code instead would open a screen with nothing on it, which is the § 1.44 shape and which the enforcement inventory refuses for a code nothing reads. **The question for the owner is whether item (f) ships that honest six now, or waits for a company-facing capability to exist** — this is not a technical choice: it decides whether the platform has a company-facing product at all. |
| 20 | **`brokerageKind` (sheet field 11) IS STORED AND NOTHING READS IT — and the column's own comment claims a mechanism that does not exist** | sheet field 11; CBJ Instr. 9/2026 scope | `schema.prisma` (`Organization.brokerageKind`); the finding is `docs/module-0b-per-field-report.md` § C.1 | Measured 2026-10-14: every non-spec occurrence is a write, a DTO validator or a label — **nothing branches on it**. The column's doc comment states *"where this reads `REINSURANCE`, Instructions No. 9 of 2026 do not govern the office and their guards must not fire"*, and **they fire**: art. 3/a's one-type refusal, art. 4/a's capital warning and art. 10/a's pack are keyed on `type = BROKERAGE_OFFICE`. So **a natural-person reinsurance broker would be REFUSED a second insurance type under an article that, on this reading, does not govern it** — and the direction is the unsafe one, running against the office. **Not fixed, deliberately**: whether those instructions govern a reinsurance broker is a reading of the regulation, and this module's correction 0.1 was exactly the mistake of enforcing a rule under an article that did not carry it. What is wrong *today* is the comment claiming a mechanism, so the claim is recorded rather than left for a future reader to trust. |
| 21 | **`Organization.brokerLicenseNumber` is a dead duplicate of the term's number** | module 0 item (c) | `schema.prisma`; report § C.3 | The licence number lives on the **term** (`BrokerLicense.licenseNumber`), because a licence is a series. The organization-level column predates the series and is now a second home for one fact. Left in place rather than dropped **in the same pass that added thirty-five columns** — one migration answering two questions is how a drop gets reviewed as an afterthought. |
| 22 | **A sample account's password and `mustChangePassword` CANNOT be restored by the seed** | — | `packages/db/prisma/seed.ts` (the `SAMPLE_USERS` upsert) | Measured 2026-10-14 by reading the upsert: its `update` branch sets **`fullName` only** — no `passwordHash`, no `mustChangePassword`. So the moment anyone completes the change-password step for a `sample.*` account, `npm run db:seed` will not put it back, and there is no `sample:reset`. **This is the defect the demo script already fixed** (2026-10-11: *"it only hashed on create, so a rotated password printed credentials that did not work"*); the sample path still has it. **Not fixed unilaterally**, because re-hashing on every seed run would silently overwrite a password a person deliberately set — and this repository's own rule says exactly that about `mustChangePassword`: *"a state an administrator may have set deliberately, and clearing it would quietly undo their decision."* The repair is a decision: a `sample:reset` script, or an explicitly-flagged seed behaviour. |
| 23 | **There is no office "B" on dev, and the one brokerage office has ZERO branches and ZERO departments** | decision 95 item 2 | *(development data — measured, not repaired)* | Measured 2026-10-14 on dev: `default [BROKERAGE_OFFICE]` — 12 roles, 12 users, **0 branches, 0 departments** — and `provider [PROVIDER]`. Nothing else. So decision 95's "verify office B with no branches" has **no office B to verify**, and the finding generalises in the worse direction: **no branch-filter or branch-scoped step can be demonstrated on dev at all**, by any office. db-test is unaffected (101 branches, 71 departments). Recorded rather than repaired because seeding branches into dev is a decision about what the owner's walkthrough should contain, not a defect to patch. |
| 24 | **`requiresHardwareToken` enforces NOTHING, and its banner can never clear** | Part E measurement 4 | `auth.service.ts#mfaPolicySatisfied`; `operations.ts` (`secHardwareKeyPending`) | Measured 2026-10-14: the attribute is read in **exactly one place**, producing the `/auth/me` flag `mfaPolicySatisfied`, consumed in **exactly one place** (`settings/security`). It **has never blocked a login** — the code says so. **So neither option in the brief is the right one**, and the measurement is why: there is nothing to "turn off" that enforces anything, and the banner's text is **already accurate in both languages** (*"that enrollment path isn't available yet — an authenticator-app code satisfies the mandatory-MFA requirement for now"*). What is real is that it **never clears**, for **seven roles** (the provider role plus six seeded brokerage roles — measured), so the open question is whether a permanently-unsatisfiable requirement should be *displayed as a pending enrolment* at all, or stated as a planned one. **That is a wording decision about what the system says, so it is the owner's** — turning the attribute off would weaken a recorded intent and `role-security-attributes.e2e-spec.ts` pins which roles carry it. |
| 25 | **Twelve source-reading guards had no timeout and raced vitest's 5000ms default — FIXED, recorded because the diagnosis is reusable** | — | the thirteen specs' own headers; the measurement is in `role-scope.inventory.spec.ts` | **Two DIFFERENT guards failed in two consecutive local full `vitest run` passes** (`employee-cbj-approval.guard.spec.ts`, then `capital-never-refuses.inventory.spec.ts` with an explicit *Test timed out in 5000ms*) — which is the signature of a shared budget problem rather than of either spec. Each reads the whole api source tree; `role-scope.inventory.spec.ts` had already measured the cost (6915ms under a parallel run) and given itself a 30s timeout, and the twelve others never inherited it. Fixed **file-scoped** via `vi.setConfig`, **never globally**: `apps/api` sets no `testTimeout`, and raising it there would also raise the budget for 3,297 ordinary tests where 5s IS a real signal. **CI never saw this** (its unit step reported one failure, the role-scope one) — pre-existing, surfaced by running the gate CI runs. |
| 17 | **The association-membership proof carries NO PERSON KEY** | CBJ Instr. 9/2026 arts. 10/a/3, 18/a; decision 88 rule 7 | `migrations/20261127100000_…/migration.sql` header, `registration-pack.config.ts` | Art. 10/a/3 attaches the proof to PERSONS — the natural broker, the insurance-business manager, the practitioner — and **none of them exists in the system at the moment an office is registered**. So it is held as a document in the office's registration pack with no person foreign key, and the migration asserts `Organization` references `Employee` nowhere so one cannot be added quietly. The per-person link belongs to the employees module. Same shape as the minimum-staff guard the owner asked for at registration and then withdrew: do not build a relation whose other side cannot exist — § 1.62, which this project has shipped once already. Art. 18/a repeats the requirement in the periodic returns, so it RECURS annually and the eventual per-person record needs a date, not a boolean. |
| 18 | **Both art. 10/a documents are filed under `DocumentCategory.OTHER`** | decision 88 | `office-registration.service.ts#fileRegistrationPackDocuments` | A dedicated category was deliberately NOT added. Two reasons, and the second is the real one: `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it, so it needs its own migration — and more importantly it would be a decision about **how an inspection query partitions documents**, which decision 88 did not take. Nothing is currently wrong: the POINTER on `Organization` identifies which art. 10/a document this is, and it identifies it EXACTLY, which a category never could — a category says “this is a lease”, the pointer says “this is THIS OFFICE'S art. 10/a/2 document”. **What is not possible is a cross-office query by category**, e.g. “list every lease we hold”, which would have to read the two pointer columns instead. |
| 19 | **“The registration pack is complete” means both documents are RECORDED, never that either file can be fetched** | pre-existing product limitation, surfaced here | `provider.ts` (`regOfficePackScope`, both languages); the precedent is `broker-license-term.dto.ts` | This product has **no object storage anywhere**, so a `Document` records a file — name, `storageRef`, category, classification, uploader — and `storageRef` names a location nothing can fetch. **Found by auditing my own wording against decision 88 rule 4's mirror.** Rule 4 forbids the marker making a finding about the OFFICE; the owner's standing rule — what the system SAYS stays accurate — forbids it overclaiming about US, and the first version read “both documents are held in the system”, which this system cannot support. Corrected to “recorded … the file name, where it is filed, and who filed it”, with the scope note stating what “recorded” means, and **pinned by a Playwright assertion plus a plant that restores the overclaim and kills exactly that test**. The limitation is NOT fixed here — object storage is a product decision, not a module 0-ب one. |
| 14 | **The office-administrator grant set has TWO homes, guarded rather than collapsed** | item (d), owner's instruction | `office-administrator-grants.ts`, `office-administrator-grants.parity.spec.ts` | The seed grid names the role per code; the api declares the list the registration resolves. One home is not available today: `prisma/seed-data/` sits outside `@ibms/db`'s export surface, and `packages/db/tsconfig.json`'s `rootDir: "src"` blocks the reverse import. **The collapse is available and is a real refactor**: move the list to `packages/db/src/`, export it as a package subpath, and derive the grid's membership from it — 45 entries change. Until then the parity guard fails in BOTH directions, which is this repository's established answer to a hand-written mirror. |
| 40 | **THE FORTY-FOUR ARABIC DESCRIPTIONS THE OWNER WROTE REACHED NO SCREEN — FIXED 2026-10-16, and it is the same defect she had just refused for the enums** | found 2026-10-16 while correcting a stale comment; **FIXED** | `components/ui/SelectedValueDescription.tsx`; both registration screens' `picker` | Measured: `descriptionAr` was sent by `reference-data.service.ts`, typed on `office-registration-api.ts`, and the ONLY occurrences of the field anywhere in `apps/web` were Playwright fixtures and that type declaration. **No screen read it.** So the owner's own rule for the enum members — "twenty-two keys nothing renders is the shape the enforcement inventory exists to reject" — was already true of the forty-four reference lines she had written an hour earlier, which is why this was fixed in the same pass rather than recorded. **ONE COMPONENT, because the wording and the markup must have one home**, rendered under the select for the value ACTUALLY CHOSEN: her stated reason for the descriptions existing decides the placement — "a person who believes his choice changes the system's behaviour, and later finds it does not, stops trusting every list after it" — and the moment that belief forms is the moment a value is picked. Rendering a whole list's descriptions at once would put eight paragraphs on a registration form and be read by nobody, which fails the same way silence does. **It carries NO `role`**: three of the eight lists say plainly that nothing follows from the choice, and announcing a reassurance through an `alert` region makes it read as a problem. **THE LOAD-BEARING ASSERTION IS THAT IT FOLLOWS THE SELECTION** — a second legal form was added to the fixture for exactly that, because with one option an implementation rendering `rows[0].descriptionAr` passes every other assertion and is wrong for every option but the first. Two plants, each killing exactly that one test out of 15. **And both of its Arabic needles were wrong on the first run, which is worth keeping:** «م١٠/أ/١/أ» was in BOTH fixtures so the negative could never hold, and «الوسيط الاعتباري» does not occur at all because the rendered text reads «للوسيط», where the preposition assimilates the article. An Arabic assertion has to be checked against the rendered bytes, not composed from the words one expects to be there. |
| 41 | **THREE MALFORMED MARKDOWN TABLE ROWS REMAIN, each losing a cell, and they are PRE-EXISTING content rather than this module's** | found 2026-10-16 by the register's own table checker; **10 of 13 FIXED, 3 DECLARED** | `README.md:1067`, `docs/b7-consistency-record.md:123` and `:141` | `scripts/measurements/markdown-table-columns.py` now checks every table in `CLAUDE.md`, `README.md` and `docs/**`, and its companion `markdown-table-escape-pipes.py` repairs the mechanical case. Of 13 malformed rows across 196 tables, 10 were pipes inside backtick spans — GFM's table parser treats those as cell separators, which is the whole defect — and are fixed; every added character is an escaped pipe and nothing else, verified with `git diff --word-diff`. **The remaining three carry an unescaped pipe OUTSIDE any code span, so repairing them is a judgement about where a cell boundary belongs** — the two `b7` rows have a fifth cell that looks like a closure note appended later — and rewriting somebody's prose to satisfy a checker is the move the checker's own header forbids. Not touched, because they are in documents this module is not about. **THE CHECKER'S FIRST VERSION WAS WRONG IN A WAY THAT MATTERED, AND THAT IS THE REUSABLE PART:** it treated ANY line containing a pipe as a table row, which produced three false positives — ordinary prose bullets whose backtick span contains pipes and WRAPS across lines. That was not merely noise: `\|` inside a code span OUTSIDE a table renders the BACKSLASH LITERALLY, since escapes do not apply inside code spans and only GFM's table parser strips them, so the fixer would have written visible backslashes into eight lines of README prose. Measured, reverted, and the rule corrected to GFM's own — a header is only a header when the next line is a separator. The fixer now IMPORTS the checker's table detection rather than restating it, because the first version answered "what is a table" twice and only one copy got corrected. |
| 42 | **`requiresMfaAlways` IS ENFORCED — the finding asked for was that it is not, and the measurement says otherwise. What is true is narrower and worth keeping** | asked 2026-10-16 as a fifth unread attribute beside `brokerageKind`; **MEASURED AND CORRECTED** | `trusted-device.service.ts:71` and `:98`; `mfa-required.guard.ts` | **THE REQUESTED FINDING WAS THAT NOTHING READS IT, AND THAT IS FALSE.** Swept every non-spec reference: `maySkipMfa` returns `false` and `trust` returns `null` when the attribute is set, so a role carrying it can neither skip an MFA challenge on a trusted device nor have a trust created in the first place. That is real enforcement of the strictest kind, and the function's own comment records why the column replaced a role-NAME list: *"the name list this replaced could not recognise a role an office invented, so a custom role skipped the prompt it should never have been offered." So it is NOT the `brokerageKind` shape (entry 20, stored and read by nothing) and not the `requiresHardwareToken` shape (entry 24, read in one place and enforcing nothing). **WHAT IS ACTUALLY TRUE is a boundary worth knowing before anyone reasons from the attribute's NAME:** `MfaRequiredGuard` — the ENROLMENT gate — never consults it. It refuses every request from every role until `mfaEnabled` is set AND an active credential exists, so enrolment is universal and the attribute decides only whether an already-enrolled user may skip the per-login CHALLENGE on a remembered device. A reader who takes `requiresMfaAlways = false` to mean *this role is not required to use MFA* is wrong, and that reading is what sent this measurement looking in the guard. **NOTHING IS CHANGED**, on the owner's instruction and because there is nothing to fix: the guard being universal is the correct behaviour, and `seed-demo.script.ts`'s own header already states it — *"`MfaRequiredGuard` is a global APP_GUARD that throws `MFA_REQUIRED` on `!user.mfaEnabled` for EVERY role, not just the three always-MFA ones."* Recorded so the next reader does not re-derive it, and so the attribute is not withdrawn on the belief that it enforces nothing. |
| 43 | **NO ORGANIZATION ON DEV HAS A BRANCH — the recorded blocker said office B had none, and the measured state is broader** | the walkthrough's entry 5 blocker, re-measured 2026-10-16; **MEASURED, NOT REPAIRED** | *(development data)*; `/settings/org-units`, `org-structure.controller.ts:101` | **MEASURED, AND THE OLD WORDING IS SUPERSEDED RATHER THAN QUALIFIED.** `SELECT count(*)` on `Branch` and on `Department` is **0 and 0 across the whole database** — not just in office B. Office B does not exist at all any more: a reseed removed it, and dev holds exactly `default` (BROKERAGE_OFFICE, 12 users, 0 branches) and `provider` (PROVIDER, 1 user, 0 branches). **So three things recorded about this were true when written and are now false**: that the gap is office B's, that office `default` holds two branches called "Insurance" and "Manegar", and that `demo:release` is what unblocks it. **`seed:demo` CREATES NO BRANCH EITHER**, which is the part that would otherwise be assumed away: its only `/branches` call is `/employees/:id/cbj-approval/branches`, which is the CBJ INSURANCE branches — a different noun, entry 1's subject — so running it produces an office with approved staff and no physical locations. **IT IS A STEP, NOT A GAP:** `POST /branches` exists and `/settings/org-units` creates one, so the branch filter on `/employees` becomes demonstrable after one branch is created in any office. Both documents now say that instead of declaring it unshowable. **Not repaired here** because seeding a branch is development data and an office's own structure, which is the same reason entries 6 and 37 are recorded rather than cleared. |

### Pending the item that creates them

These are the owner's items whose declaration site does not exist yet. Each lands with its item.

| Item | Article / decision | Lands with |
|---|---|---|
| Per-branch last-activity tracking | art. 21/a/10 | a later module |
| **`RegulatoryAction` cannot express that one act's document SUPERSEDED another's.** `documentId` carries `onDelete: Restrict`, which is right — the document is the evidence and must not vanish from under the record — but it means a corrected or replaced scan can only be ADDED, and a new row reads as a SECOND regulatory act rather than a correction of the first. Measured: the model has no `supersededBy`, `replaces` or equivalent field. **No field is invented now.** When it is needed it is a link between two acts, not a mutable column, because append-only is the whole point | decision 71 (append-only) | a later module |
| **Foreign-currency amounts have no conversion path** — every threshold in Instructions No. 9 of 2026 is in JOD (art. 4/a slabs, art. 13/b/2's 50,000, art. 15/d's 2,000), so an amount in USD or EUR cannot be tested against any of them. Comparing bare numbers would reach a regulatory conclusion from an invalid comparison. Conversion needs a RATE **and the DATE it was taken** — a rate without its date is useless to an audit. Declared on the `CURRENCIES` list in `reference-tables.ts`. **ASK AT MODULE 14's OPENING, NOT DURING IT:** whether offices actually write policies in foreign currency. The owner has deliberately left open whether this is a central part of that module or a footnote, and the answer SIZES the build rather than correcting it afterwards. If they do not, it shrinks to a reinsurance reference and stays small either way. | arts. 4/a, 13/b/2, 15/d | **module 14** |
| The warned-act mechanism, and the issuance gate that depends on it | arts. 15/d, 19/a/3, 16/y/8 | module 1 (specified in the module 0-ب brief's appendix; **must not be half-built earlier**) |
| The legal-values table | decision; م١٥/ي reads from it | module 1 |
| **Art. 15/i and 15/k against the IBAN field.** 15/i is the dedicated client-funds account with a SEVEN-WORKING-DAY cap on remitting premiums to the insurer and THREE for paying claims to the client (verified from the scan, printed page 18). 15/k forbids using that account for anything else and specifically forbids pledging it or taking interest through it. `Organization.ibanEnc` now exists and carries NEITHER rule: nothing marks an account as the client-funds account, and nothing counts days against either cap | arts. 15/i, 15/k | **module 14** — the column exists since item (d); the rules need the money module |
| **The broker–insurer agreement's remittance period must be READ from the legal-values table, never seeded at 30 days.** The dictionary's own correction 6 says the sheet's `30` example contradicts art. 15/i and must not be seeded | art. 15/i | module 1 (the legal-values table) / module 14 |
| **THE UNIT THE art. 4/a SLABS COUNT BRANCHES IN IS UNVERIFIED, and the figure is a money requirement.** The slabs count branches within a type (≤6, ≤12, >12), so the counting unit decides how much capital an office must hold — and `requiredCapitalForScope` counts rows of OUR 32-line catalogue. An **unattributed** reply to a question put to the Central Bank states those 32 are a COMMERCIAL PRODUCT catalogue while the Bank licenses against a shorter REGULATORY classification (its example: our several liability lines falling under one branch, "general liability"), which is consistent with the 18-general-and-8-life list in the Bank's own published broker re-registration form. **NOTHING IS BUILT ON IT**: no reference number, no signature, it does not contain the form or list asked for, and its closing line directs us to submit a formal written request for the annexes. **The catalogue is NOT touched** — merging or renaming a line changes what every existing licence means. **No mapping column is added either** — an empty column with no reader is the `dpoAlternateApproverUserId` precedent, which existed for exactly this kind of problem, acquired no reader, and is now marked superseded. What IS done now is the declared note on BOTH surfaces that display the figure (`/regulatory-compliance` and `/provider-register-office`, one shared i18n key so a reader moving between them does not meet two accounts of how settled it is), because the owner's rule is that the system does not state as settled what is not. **The mapping column arrives with the official list that populates it.** **THE ANNEX IS NOT REQUESTED AND THE FIGURE STAYS DECLARED — owner's decision, 2026-10-15, with the REOPENING TRIGGER written here rather than left to judgement:** *the moment anything depends on that figure beyond a warning — a REFUSAL, a REPORT SENT TO A REGULATOR, or a value COPIED INTO AN OFFICIAL DOCUMENT — the annex is requested BEFORE that is built, not after.* A warning may stand on an unverified counting unit because it asks a person to check; a refusal, a filing and a signed document each convert the same unverified unit into an assertion the office cannot inspect. So the trigger is the CONSEQUENCE, not the calendar: no module owns this, and whichever one first reaches for one of those three is the one that must stop and ask. | CBJ Instr. 9/2026 art. 4/a | **no module — the three consequences above are the trigger**; if the annex arrives unprompted it would fit beside module 1's legal-values table, the provider-owned home for regulator-set values, but that is where it would FIT rather than where it is promised |
| **A SHORT ARABIC NAME for each permission** — decision 94, recorded and deliberately not built. The dictionary holds exactly ONE string per code (the description) and the Role screen shows the code beside it. A name needs a second key across 219 codes plus the screen reading it. The owner will meet it during her own walk and decide it SEEING the screen rather than imagining it | decision 94 | **the roles-and-permissions pass**, not this module |
| Takaful terminology templates | decision (business model is a table; nothing may branch on it) | **item (e)** |
| The real mail sender | owner's decision B2 | **item (f)** — a temporary on-demand script stands in |
| `INSURANCE_COMPANY_ADMINISTRATOR` | owner's decision | **item (f)** |

---

## An attribution, recorded at the owner's instruction — the art. 4/a physical-branch reading

**The false legal reading was the OWNER'S, and she corrected it herself on 2026-10-15.** It is recorded here rather than left in a conversation because this project holds everyone to naming the source of a claim, and an error about a legal text is exactly the kind that must be attributable.

What she asserted, as settled: that art. 4/a's tier counts the office's PHYSICAL branches. The text reads *5,000 dinars per insurance type, up to 6 branches within the one type*, so the branches counted are INSURANCE branches inside a type. `requiredCapitalForScope` read it that way from the start and `office-registration.service.ts`'s comment already flagged two defensible readings; **no code was wrong and none changed.**

**MY OWN ERROR WAS NARROWER AND IS NOT ERASED BY HERS.** I ran a measurement whose premise it could not test — it could only compute consequences OF it — and reported those consequences as a defect: that an office with thirteen branches is judged at 5,000 where the law requires 10,000, and that the system would report "sufficient" when it is not. The honest form was to say the reading itself was the thing I could not verify, BEFORE computing anything from it. A premise handed over as settled is still a premise.

**WHAT SURVIVES IS A DIFFERENT QUESTION, and it is still open:** GRANULARITY. The derivation counts rows of OUR 32-line catalogue, and an unattributed reply to the Central Bank states those 32 are a COMMERCIAL product catalogue while the Bank licenses against a shorter REGULATORY classification. That concern never rested on the physical-branch reading and is recorded in its own row above.

---

## A standing rule the FOURTH blast-radius miss earned — A COUNT IS NOT A SET

**When a change touches a shared list, grep for its MEMBERS as well as for its figure.**

Earned on item (f)'s company half. The new PLATFORM code moved the catalogue to 227, and the sweep below was run — correctly — for the COUNT. CI then failed on a pin that is a SET:

```
AssertionError: expected [ ...(5) ] to deeply equal [ 'provider.insurer.register', ...(3) ]
  prisma/seed-data/permissions.spec.ts > has at least one PLATFORM code, so the branch above is not vacuous
```

That file WAS in the swept list; the pattern was wrong, not the coverage. And the pin is a set deliberately — its own comment says `toHaveLength(2)` "would be satisfied by any two, including one swapped for a code nobody decided should cross offices", which is the same argument this register makes everywhere else about counts surviving substitutions.

**The grep that works is for the MEMBER, not the total.** For a provider code:

```
grep -rnE "'provider[.][a-z.-]+'" --include=*.ts --include=*.tsx --include=*.sh apps packages scripts
```

Run that way it names five files that pin the set — `permissions.ts`, `permissions.spec.ts`, `seed.ts`, `office-administrator.e2e-spec.ts`, `permission-descriptions.test.ts` — against the dozen that merely mention one code. Four of the five had already been updated; the fifth is what CI caught.

---

## A standing rule the third blast-radius miss earned

**When a change touches a SHARED LIST, the blast radius is every spec that COUNTS it — and finding
those is a grep for the COUNT, not for the topic.**

Earned three times in one session, the same mistake each time:

| # | I measured | What mattered |
|---|---|---|
| 1 | which specs test the provider module | which guard SCANS all api source for a shape (`role-scope.inventory.spec.ts`) |
| 2 | what DECLARES the provider's codes | what ASSERTS them (`office-administrator.e2e-spec.ts`'s exact set) |
| 3 | which specs touch retention | which specs COUNT the maker/checker registry (`internal-controls`, `compliance-dashboard`) |

Each time the local run was green and CI was red, and each time the correct search was mechanical and
took under a minute once asked properly. For the registry the grep is:

```
grep -rn "MAKER_CHECKER_REGISTRY\|pairsScanned\|maker_checker\|CHECKER_PERMISSIONS" apps/api --include=*.ts
```

...and then classify each hit as DERIVING (`MAKER_CHECKER_REGISTRY.length`, which needs no edit) or
PINNING (a literal, which does). Run that way, the sixteenth pair touched **four** pins and two prose
counts, and three further specs derived correctly — which is the shape of the answer and could not
have been reached by thinking about retention.

**The repository's workflow is targeted-locally and full-in-CI, so CI catching this is the system
working rather than a failure on its own.** What is a failure is reaching for the topic three times
when the question was about a shared structure.

---

## The named short pass — between this module's close and module 1's opening

The owner named three debts and placed them in a **short pass of their own**, after this module's close
and before module 1 opens. They are recorded here because of this register's own standing rule: a
deferral belongs in **a file in the repository rather than a line in a report** — and these three
lived only in a report, which is already a failure of that rule rather than a risk of one.

**Stated as the owner named them, not as I reconstructed them:**

| # | The debt, in the owner's words |
|---|---|
| S1 | a **grants counter** exiting before measuring |
| S2 | a **screening comment** denying two columns that exist |
| S3 | a **segregation comment** citing a lifted refusal |

### THE LOCATIONS ARE NOT RECORDED, AND I COULD NOT RE-DERIVE THEM — read this before starting

All three were found by reading, during this module, and reported in conversation. Their file and line
were never written down. Searching the repository for each one by SHAPE did not find it:

- **S1** — `scripts/measurements/permission-reachability.py` runs clean (exit 0, 507 grants, every
  figure printed), which was the obvious candidate because it HAD this defect once: a `== 491` pin
  against a real 502 made it exit before measuring anything, and that was fixed by reading the count
  from the fixture's own header. No hard-pinned grant count remains anywhere under `scripts/`.
- **S2** — every "has no field / does not exist" comment in the screening module reads correctly today,
  including the one most likely to be it (`MatchThresholds` lacking an index signature, which is a
  true statement about a TypeScript interface).
- **S3** — `SELF_APPROVAL_REPORT_EXISTS`, the COMBINED-mode shipping gate that WAS lifted, appears
  nowhere in the tree, so a comment citing it by name would have surfaced.

**So the first task of that pass is to re-identify all three, and the honest reason is recorded rather
than papered over: guessing at a location and writing it here would put a false entry in the register,
which is the defect class this module spent its close correcting in three other places.** The owner
saw each one when it was reported and will recognise them; what is preserved here is that there are
exactly THREE and what each is about.

**The shape they share is worth keeping even if the locations change.** All three are a statement in
code that is false or self-defeating: a counter that cannot reach its own measurement, a comment
denying something that exists, and a comment citing a control that no longer does. None changes
behaviour. Every one misleads the next reader — which is the same class as the signup refusal that told
a reader an office could not be onboarded, and the dictionary header that credited the owner with four
lines she had never seen.

---

## Module 0 — identity, licence and scope

| # | Item | Article / decision | Declared in code at |
|---|---|---|---|
| 1 | The renewal-pending rule has **no provision behind it** — it is the owner's decision, supported only by analogy with art. 8/d of Law 12/2021, which does not extend to brokers | Owner's decision | `broker-license.config.ts` (`RENEWAL_PENDING_RULE_BASIS`) |
| 2 | Art. 4/a capital is a **warning, never a refusal** | art. 4/a | `broker-license-scope.config.ts` |
| 3 | A non-31-December expiry **warns, never blocks** | art. 10/b | `broker-license.config.ts` |
| 4 | The bank guarantee has **no basis in Instructions No. 9 of 2026** | — | to be declared on the field itself in **item (d)** |

---

## A permanent asymmetry, recorded so neither side is reasoned about by analogy

**THE TWO LICENCE CERTIFICATES HAVE DIFFERENT STRENGTHS OF ENFORCEMENT, AND THAT IS NOT A DEFECT.**

* `BrokerLicense.certificateDocumentId` is **NOT NULL** — the database refuses a term with no
  certificate, however it is written.
* `Organization.insurerLicenseCertificateDocumentId` is **nullable**, and
  `Organization_insurer_certificate_only_on_a_company` permits NULL. The company's certificate is
  enforced by the SERVICE alone.

**DO NOT "FIX" THE SECOND TO NOT NULL.** It would reinstate a CIRCULAR FOREIGN KEY:
`Organization.insurerLicenseCertificateDocumentId` references `Document`, and `Document
.organizationId` references `Organization` — so with the pointer on the PARENT, neither row can be
written first. The brokerage path never meets this because its certificate hangs off `BrokerLicense`,
a CHILD of the organization. **The same column shape creates a cycle in one path and not the other,
and the brokerage side is safer BY ACCIDENT rather than by design** — which is why neither is ever
reasoned about by analogy with the other.

What the asymmetry needs instead is an ASSERTION THAT THE SERVICE'S THIRD STATEMENT RAN, read from
the stored record rather than inferred from a 201. It exists in
`insurance-company-registration.e2e-spec.ts`, and removing the statement kills that test alone —
proven by planting, not claimed.

---

## A standing rule the live-screen finding earned

**EVERY NEW CONSTRAINT IS ASKED ABOUT ITS EXISTING WRITERS, NOT ONLY ITS NEW ONE.**

The owner's words, from `Insurer_rating_carries_its_date`. That constraint was added for a field item
(e) was introducing — and the column it constrained, `financialStrengthRating`, had existed since
Process 31, with an input on `/insurers/new`, a DTO that accepted it and a service that wrote it. From
the migration onward, an office typing a rating into a screen it had always used would have met a raw
constraint violation as a 500.

Nothing in the new work touched that screen. The question that found it was asked about the
CONSTRAINT, not about the feature: *who already writes this column?* Three places did — one through
the API and two direct Prisma writes in a sibling spec — and all three carried a rating with no date.

The next constraint gets the same question before it ships. It is the sibling of the blast-radius
rule and narrower: that one asks which specs assert about a set, this one asks which code already
writes a column.

---

## A standing rule the plants earned — a boundary needs a fixture on EACH side

**A boundary — linked/unlinked, locked/open, inside the office/outside — needs a fixture on EACH
side of it, and on the distinguishing side the values must DIFFER IN EVERY FIELD UNDER ASSERTION.
Otherwise it is the similarity that passes the test, not the correctness of the code.**

The owner's words, from the resolver's own plant. It is the SIBLING of the vacuity rule, not the same
rule: there the set is empty, here it is full but entirely on one side — which is more dangerous,
because a suite rich in fixtures looks thorough.

**Three instances in this module, all found by planting and none by reading:**

* `deriveInsurerView` pointed back at `row.companyPhone` killed NOTHING, because every fixture in
  that spec was UNLINKED and the resolver returns the office's own values for those — the two paths
  answer identically.
* The art. 14/c leap-day test asserted 2026-02-28 and 2026-03-02, one either side of BOTH thresholds,
  so it answered the same under calendar and 730-day arithmetic. 2026-03-01 is the only day they
  disagree.
* Decision 90's merged-state test: the ACCEPTED half carried the rating IN THE BODY, so the
  `current` fallback was never reached and a plant that ignored the current row left it green. The
  observing case patches only the DATE, so the rating can come from nowhere else.
* The insurer screen's two notes: `getByTestId(...).toContainText(...)` passes on a HIDDEN element,
  because text content is readable from one. For a sentence whose entire purpose is to be READ,
  "it is in the DOM" is not the claim — `toBeVisible()` is. Both plants hid the note and left every
  text assertion green.
* Decision 93's no-op test, which shows the rule has a SECOND HALF: a fixture on each side is not
  enough when the two sides look the same under every assertion made. Removing the nothing-to-clear
  branch killed nothing, because writing null over null produces an identical record — what actually
  differs is that the write path LOGS A CHANGE THAT DID NOT HAPPEN. The test now counts audit rows
  before and after. (And the first version of THAT assertion compared against zero and failed on a
  clean tree, because registering the insurer writes a row of its own: a test that fails for a reason
  other than the one it is about is a test nobody trusts the next time it fires.)

---

## A standing rule item (e)'s measurement earned

**WHERE TWO SOURCES COULD PRODUCE THE SAME-LOOKING LIST, EACH SCREEN NAMES WHICH ONE IT IS SHOWING,
AND NEITHER IS DERIVED FROM THE OTHER.**

Found while placing the insurance company's licensed lines. Two sets of "which lines does this insurer
write" now exist and they are different facts:

* `InsurerDirectory.lines`, aggregated from `InsurerOfferedLine` — **observed behaviour**: lines at
  least one office has recorded buying from this insurer.
* The company's registered licensed lines (item (e)) — a **regulatory fact**: lines the company's
  licence permits it to underwrite.

**They render identically and diverge in BOTH directions.** A company licensed for a line nobody has
bought is shown as not offering it, which denies a broker a lawful option. A line whose licence was
withdrawn keeps appearing because somebody bought it last year. And the observed set GROWS as offices
trade, so the licence would appear to change with no regulatory act behind it.

So neither is computed from the other, and each screen says which it is showing. The temptation to
"reconcile" them is the defect: they are not two readings of one fact, they are two facts, and an
office needs both — what the company may lawfully write, and what the market has actually placed.

The general rule is wider than insurer lines and is why it is recorded here rather than as a comment
on one column. An observed set and a declared set are different claims; a screen that shows one while
the reader believes the other is the confidently-wrong-figure failure this repository has shipped
three times.

---

## A standing rule the naming correction earned — ask BEFORE naming a column

**Before naming a column on any new table, answer one question: do these rows belong to a TENANT (an
office), or are they a GENERAL FACT? Only the first carries `organizationId`. The second is forbidden
from carrying it, even when the thing it points at happens to be an `Organization` row — because that
name creates the isolation, and naming a general column that way hides a fact from the people who own
it.**

The owner's words, generalised from `InsurerLicensedLine`. The name is the mechanism:
`tenantScopeExtension` derives its scoped set from the DMMF as "every model carrying an
`organizationId`", matching the field name EXACTLY.

**AND THE DANGEROUS DIRECTION, recorded and deliberately NOT measured yet**: a table that DOES belong
to a tenant but whose column is named something else leaves the scoped set SILENTLY, and neither
`tenant-isolation.e2e-spec.ts` nor `db:divergence` can see it — both start from that same set. Do not
sweep for it. **Ask it at the first new office-owned table, not before.**

A fact about HOW a record came to exist — who typed it, where it came from, when — belongs to the
OWNER OF THE RECORD, not to the thing the record describes. It classifies on the office's side even
when its subject is a company. (`companyFactSource`, `insuranceCompanyId`, `officeRecorded`.)

---

## A standing rule item (d) earned in CI

**A new table carrying `organizationId` ASSERTS ITS OWN ROW-LEVEL SECURITY, in its own migration.**

**WHICH TABLE, AND HOW MANY — measured, because a named defect that does not say its own extent is
half a record.** Item (d) created exactly ONE table: `RegulatoryAction`
(`20261121100000_provider_registration_fields`). Everything else it added was COLUMNS, on
`Organization` and `ProfessionalIndemnityPolicy`, both of which already had their RLS. So the gap was
one table of one, and it is closed.

For contrast, item (c) created EIGHT tables and none of them was exposed: the eight reference lists
deliberately carry no `organizationId` at all, and that migration ASSERTS it — *"reference tables: %
carries organizationId — it must be platform-scoped"*. A table that is global by construction cannot
have this defect, which is the constructive form of the rule and the better one where it is available.

`RegulatoryAction` was created with `organizationId` and no RLS. `tenant-isolation.e2e-spec.ts`
caught it in CI — `expected [ 'RegulatoryAction' ] to deeply equal []` — and the migration that
created it had asserted a great deal: the thirteen composite tenant foreign keys, the enum labels,
the NOT NULL with no default, the duplicate-registration refusal proven by attempting it. What it did
not assert was the one thing that is a CONVENTION rather than a property of that table.

**WHAT THE HOLE WAS, PRECISELY.** `RegulatoryAction` holds the regulator's acts against an office —
suspensions and cancellations, with the CBJ decision reference behind each. Without a policy, a query
that reached the table OUTSIDE `tenantScopeExtension` — raw SQL, or a repository method written
without a `where` — would have returned every office's regulatory acts to whoever asked. On a table
whose rows say "the Central Bank suspended this brokerage", that is a disclosure about a competitor's
standing with its regulator. The table held ZERO rows throughout, on both databases, and no reader
existed yet; what was missing was the layer that has to be right before a reader is written.

The hole was real while it lasted. The application layer filtered correctly from the first moment,
because `tenantScopeExtension` derives its scoped set from the DMMF — but RLS is the layer that makes
the promise true for a raw query, a forgotten `where`, or a future repository reaching past the
extension, and ten raw-SQL call sites in this codebase are protected by it ALONE.

The repair is `20261123100000_regulatory_action_rls`, which asserts BOTH flags and that exactly one
policy reads `app.current_org_id`. `ENABLE` without `FORCE` leaves the table owner exempt, and every
migration and the seed connect as the owner; a policy that does not read the session variable is one
nothing can ever satisfy, which once made every permission read return empty and 403'd every user.

**THE COUNT-VERSUS-SET CONVERSION EARNED ITS KEEP TWICE IN TWO DAYS, and the second time it caught a
code I had added myself.** `office-administrator.e2e-spec.ts` pins the provider's grants by NAME. Item
(d) added `provider.office.register` to the provider role and did not declare it there; the guard
failed in CI and PRINTED THE CODE. A count of eight would have passed — and would have passed equally
on eight that included `customer.create`, which is the drift that assertion exists to catch. The
conversion is recorded further down as a standing rule; this is its second live instance, and the
first where the author of the drift was the author of the guard.

**And the second half of the lesson is about blast radius, not RLS.** The local run was scoped to
"which specs touch registration", and the set that mattered was "which specs assert about the SET of
tenant-scoped tables". Before adding a table, grep for `TENANT_SCOPED_MODELS`, `relrowsecurity` and
`pg_policies` — three files, measured — and run those.

---

## The two standing rules this register was born alongside

Recorded here because both came out of guards that were green while describing something false.

1. **A test that asserts a refusal must assert WHICH refusal** — by SQLSTATE or constraint name —
   never merely that one occurred. Two instances in one week: a typeless-organization test whose
   `23502` silently moved to a different column, and four `broker-kind` tests that kept expecting a
   refusal and got one from the wrong column.
2. **Wherever an assertion fixes the QUANTITY of a set of NAMED VALUES, it asserts the wrong
   thing.** Not only permissions, roles and grants — the original scoping was too narrow, and the
   third instance fell outside it entirely. Reasons, enum members, migration counts, route counts,
   seeded rows, scope values, registry entries: wherever a number stands in for a named set, the
   substitution passes.

   A count cannot see a substitution. Demonstrated: with a count check a swapped-in
   `customer.create` was accepted *and really granted*.

   **Four instances found and converted**, in order: the provider grant set; `CHECKER_PERMISSIONS`
   pinned at 13 (which was hiding a live compliance-reporting gap — `needs-assessment.approve`);
   `UnscopedReason` pinned at one value; and `MAKER_CHECKER_REGISTRY` pinned at 15 entries — the
   last mattering most, because `CHECKER_PERMISSIONS` now derives from it and
   `duty-segregation-schema.e2e-spec.ts` compares it against `pg_constraint`, so a silently wrong
   entry would propagate into both.

   **THE BOUNDARY OF THIS RULE, recorded so it is not later applied into noise.** Convert where a
   count STANDS IN FOR a set of named values. KEEP the number where the quantity IS the thing under
   test, and say which beside it.

   Deliberately not converted, each because the number is the claim: a function's return value
   (`requiredApprovedStaff`), tallies of fixture data, dashboard aggregations, per-test result
   counts — and `ALL_STATUSES).toHaveLength(9)`, the clearest case, which sits directly beneath
   named-set assertions and exists to catch a TENTH status arriving, with that reasoning already
   written beside it. A named set there would say LESS, not more.
3. **A guard that runs after the write it guards is a report, not a guard.** The check belongs
   inside the transaction that writes. Applies directly to item (d), where the organization, the
   licence term with its certificate and the scope lines are written together.

4. **A verification that routes a gate's result through another process reports THAT PROCESS, not
   the gate.** `node check.mjs | tail -2; echo $?` prints `tail`'s exit status. This has cost
   something twice: once reading a turbo task's output through a grep that matched nothing, and
   once reading `db:divergence` through `tail` — where the first reading said the gate PASSED when
   it had failed, on the one check that protects tenant isolation. Capture the gate's own exit code
   directly, or run it without a pipe.

5. **A guard that is correct only because today's inputs happen to suit it is not a guard.**
   `replace('$', …)` substituted one occurrence and worked solely because the token it guards
   contains one `$` — the same shape as the `|`-escaping defect this repository shipped once. Prove
   a guard against the GENERAL input, not the present one.

---

## A standing rule this register earned about itself

**A pipe inside backticks STILL splits a markdown table cell. In a document whose entries are table
rows, one stray pipe silently merges or drops a whole entry — so the column count is a thing to
check, not to trust.**

Earned on entry 32, which carried a literal pipe while *describing the pipe-escaping defect*. **A row
has pipes = columns + 1**, so this table's rows carry six pipes for its five columns
(`# | Item | Article / decision | Declared in code at | Why deferred`) — and entry 32 had **seven**,
a spurious sixth column that pushes the "Why deferred" content into a column the header does not
have, where most renderers drop it. The failure is quiet in the worst way: the file still renders and
the row still looks like a row. Nothing in this repository reads these documents, so no gate can fail.

The check is mechanical, and it must compare each table against **its own** majority rather than the
file's — this register holds seven tables with three, four, five and six columns, all legitimate:

```
# Put this in a FILE and run it. Do NOT paste it through a heredoc on this host: the backslashes in
# the lookbehind are eaten, and `(?<!\\)\|` arrives as `(?<!)|` — "missing ), unterminated
# subpattern". That has now happened a dozen times in this repository, including while writing this.
import io, re
from collections import Counter

UNESCAPED = re.compile(r"(?<!\\)\|")   # an escaped \| is a LITERAL pipe and does not split a cell

for p in ("docs/deferred-register.md", "docs/module-1-preflight.md"):
    with io.open(p, encoding="utf-8") as f:
        lines = f.read().split("\n")
    hdr, tables, infence = None, {}, False
    fence = chr(96) * 3             # spelled this way so the literal is not inside the fence below
    for l in lines:
        if l.startswith(fence):     # a fenced block may legitimately contain pipes
            infence = not infence
            continue
        if infence:
            continue
        if l.startswith("#"):
            hdr = l.strip().encode("ascii", "replace").decode("ascii")[:50]
        if l.startswith("|") and not re.match(r"^\|[\s:-]+\|", l):
            tables.setdefault(hdr, []).append(len(UNESCAPED.findall(l)))
    for h, rows in tables.items():
        c = Counter(rows)
        print(("OK    " if len(c) == 1 else "MIXED ") + f"{len(rows):3d} rows {dict(c)}  <- {h}")
```

**The fence skip is load-bearing and was added after the fact**: without it this rule's own code block
would be read as table rows the moment somebody documents a table inside one — a checker that breaks
on the document explaining it is worse than none.

**Escape the pipe as `\|`, or reword.** Here it was reworded to "the pipe-escaping defect", because an
escaped pipe inside backticks reads as a backslash to anyone viewing the raw file — and the raw file
is how an agent reads this register. **Rendered, though, `\|` is exactly right**: GFM splits table
cells on unescaped pipes *before* inline parsing and supports escaping one inside another inline span,
so the cell stays intact and the code span shows a bare `|`. Escaping is therefore the other fully
correct answer, and **the checker counts UNESCAPED pipes precisely so that it is** — the first version
counted raw ones, which would have reported a correctly-escaped row as malformed. Found by writing a `CLAUDE.md` row containing `\|` and
measuring it before inserting: **5 raw pipes reading as 4 columns, 4 unescaped reading as the 3 that
table actually has.** A checker that punishes the correct fix is worse than no checker, because the
next person reaches for the reword every time and eventually rewords something that mattered.

**And print ASCII-only when checking**: the first version of that script died on
`UnicodeEncodeError: 'charmap' codec can't encode character 'ب'` — this host's console is cp1252
and these headers are Arabic, which is a host quirk this repository already records and which looks
exactly like a broken script.

---

## Owed to module 1 — recorded here so it is not rediscovered

| Item | Why it is owed | Not to be started before |
|---|---|---|
| **THE SEPARATION-OF-DUTIES GUARANTEE — `MAKER_CHECKER_REGISTRY` records no MAKER code** (owner's decision, 2026-10-15: **declared by name and deferred to the ROLES-AND-PERMISSIONS PASS**; the measurement was priced and *nothing further is owed on it now*) | It holds the checker permission and the database constraint, so half the pair is not recorded anywhere and the system **cannot answer the real segregation question** — does one role hold both halves of the same pair. This surfaced only because a scan of mine rested on five maker codes that do not exist, and the retraction was worth more than the answer. The durable fix is to record the maker code beside the checker code, so a pair is a pair in data. **THE TRIGGER IS KEPT RATHER THAN THE TASK:** the work begins when the roles-and-permissions pass opens, and before then nothing may *claim* the guarantee — a screen, a report or a document asserting that this system enforces separation of duties is the thing this row forbids, because the registry cannot answer the question. | **the roles-and-permissions pass** |
| **The readiness signal splits in two** | One name currently covers two different measurements. They must be named for what they measure: **checker concentration** (a control observation) and **both halves of one pair** (the hard rule). **Nothing may call concentration a segregation breach** — a screen reporting a violation it did not measure is a false claim to the user. | **the roles-and-permissions pass**, with the warned-act machine |
| **Do not change the seeded role's permissions** | `BRANCH_DEPARTMENT_MANAGER` holds seven checker permissions. Whether that is a breach cannot be judged until the question above can be asked correctly. | — |
