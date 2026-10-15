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
| (f) invite the first administrator | **NOT BUILT, and raised as a stop condition** — entry 26: selecting from the catalogue yields only the six self-administration codes, because nothing in this product is reachable by a company user |
| (g) PLATFORM scope on this module's codes | **built, and it was already satisfied** — the two provider codes carry it, the two office codes correctly do not, and the literal over-reading is refused by the permission grid guard by name |

Two things are open and both are the owner's: whether item (f) ships the honest six now, and whether
the close's demonstration offices are written to **dev** (which makes the login page's signup link
refuse, and is effectively irreversible once a user exists inside one).

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
| **THE UNIT THE art. 4/a SLABS COUNT BRANCHES IN IS UNVERIFIED, and the figure is a money requirement.** The slabs count branches within a type (≤6, ≤12, >12), so the counting unit decides how much capital an office must hold — and `requiredCapitalForScope` counts rows of OUR 32-line catalogue. An **unattributed** reply to a question put to the Central Bank states those 32 are a COMMERCIAL PRODUCT catalogue while the Bank licenses against a shorter REGULATORY classification (its example: our several liability lines falling under one branch, "general liability"), which is consistent with the 18-general-and-8-life list in the Bank's own published broker re-registration form. **NOTHING IS BUILT ON IT**: no reference number, no signature, it does not contain the form or list asked for, and its closing line directs us to submit a formal written request for the annexes. **The catalogue is NOT touched** — merging or renaming a line changes what every existing licence means. **No mapping column is added either** — an empty column with no reader is the `dpoAlternateApproverUserId` precedent, which existed for exactly this kind of problem, acquired no reader, and is now marked superseded. What IS done now is the declared note on BOTH surfaces that display the figure (`/regulatory-compliance` and `/provider-register-office`, one shared i18n key so a reader moving between them does not meet two accounts of how settled it is), because the owner's rule is that the system does not state as settled what is not. **The mapping column arrives with the official list that populates it.** | CBJ Instr. 9/2026 art. 4/a | **whichever module receives the official annex** — likely alongside module 1's legal-values table, which is the provider-owned home for regulator-set values, but that is where it would FIT rather than where it is promised |
| **A SHORT ARABIC NAME for each permission** — decision 94, recorded and deliberately not built. The dictionary holds exactly ONE string per code (the description) and the Role screen shows the code beside it. A name needs a second key across 219 codes plus the screen reading it. The owner will meet it during her own walk and decide it SEEING the screen rather than imagining it | decision 94 | **the roles-and-permissions pass**, not this module |
| Takaful terminology templates | decision (business model is a table; nothing may branch on it) | **item (e)** |
| The real mail sender | owner's decision B2 | **item (f)** — a temporary on-demand script stands in |
| `INSURANCE_COMPANY_ADMINISTRATOR` | owner's decision | **item (f)** |

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

## Owed to module 1 — recorded here so it is not rediscovered

| Item | Why it is owed | Not to be started before |
|---|---|---|
| **`MAKER_CHECKER_REGISTRY` records no MAKER code** | It holds the checker permission and the database constraint, so half the pair is not recorded anywhere and the system **cannot answer the real segregation question** — does one role hold both halves of the same pair. This surfaced only because a scan of mine rested on five maker codes that do not exist, and the retraction was worth more than the answer. The durable fix is to record the maker code beside the checker code, so a pair is a pair in data. | module 1 |
| **The readiness signal splits in two** | One name currently covers two different measurements. They must be named for what they measure: **checker concentration** (a control observation) and **both halves of one pair** (the hard rule). **Nothing may call concentration a segregation breach** — a screen reporting a violation it did not measure is a false claim to the user. | module 1, with the warned-act machine |
| **Do not change the seeded role's permissions** | `BRANCH_DEPARTMENT_MANAGER` holds seven checker permissions. Whether that is a breach cannot be judged until the question above can be asked correctly. | — |
