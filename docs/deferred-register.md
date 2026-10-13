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

**Status: INCOMPLETE. Items (d), (e), (f) and (g) are not built**, and several deferrals below
cannot exist until the code that declares them does. Completed at module close.

### Declared and verifiable now

| # | Item | Article / decision | Declared in code at | Why deferred |
|---|---|---|---|---|
| 1 | **Art. 13/b/2 — the 50,000 JOD branch-expansion capital** | CBJ Instr. 9/2026 art. 13/b/1–4 | `broker-license-scope.config.ts` header | The system models **no physical branch offices**. Art. 13's فروع are physical branches; art. 4/a's are insurance lines — the same word, different nouns. A guard built on the branch count this file holds would tell every office with six or more *lines* that it needs 50,000 JOD. The four conditions are also **conjunctive**, so a capital-only guard would be wrong even once branches exist. |
| 2 | **Role scope guards WRITES and not READS** | Module 0 item (h), decision | `docs/decision-role-scope.md` § 4.2 | `prisma.policy` is reached from 31 non-spec files, most of them dashboards and finance reports. A read filter would silently narrow an office's own totals to one insurance type and present them as the office's figures. A wrong number that looks right is worse than a refusal. |
| 3 | **The provider administrator's self-grant is bounded by practice, not by schema** | Module 0 item (j) gap closure | `packages/db/prisma/seed.ts` (`ensureProviderOrganization`), README § Known gaps CLOSED | Nothing structurally stops a provider administrator granting their own role `customer.create` — they hold `role.update` and the catalogue is global. What bounds it is a provider that starts with exactly seven codes and a seed check, inside a transaction, that fails if the set changes. A GRANT-level closure, not a schema-level one. |
| 4 | **`InsurerMaster` is vestigial for WRITES only** | Decision 63 | `schema.prisma` (`InsurerMaster`), `docs/decision-insurer-field-split.md` § 4 | No registration creates one, but it is **read in 24 non-build source files** — including `insurer-identity.ts`, which decides what an insurer is *called*. Neither revived as the registry nor deleted. Removal is a later module's. |
| 5 | **Insurer directory search is by NAME only** | — | `docs/insurer-directory.md` | Searching by line of business is not implemented there; the provider dashboard is a separate surface. |
| 6 | **The dev seed drift** | Measured, Part E (E1) | *(development data — not repaired)* | `seed.ts` grants to the DEFAULT office's roles only, so codes added after an office was created never reach it. Measured: the demo office's `OFFICE_ADMINISTRATOR` holds **36 of 45**. Item (d) must compute a new office's grant set from the catalogue and copy from no office; the existing dev drift is development data and is recorded, not repaired. |
| 7 | **AML art. 17/a retention is NOT built** | AML/CTF Law 20/2021 art. 17/a | `packages/db/prisma/seed-data/retention-schedule.ts` header | `RetentionScheduleItem` holds exactly ONE row — a 120-month `AuditLogEntry` draft. There is no AML retention rule for customer due-diligence records, account files or transactions. The citation was corrected; correcting a citation is not building the rule. |
| 8 | **No Arabic-name backfill** | Part E (E3) | `migrations/20261119100000_…/migration.sql` | Measured zero rows lacking one, so the column tightened. If a future database holds such a row the migration **fails** rather than inventing a legal name nobody can source. |
| 9 | **Art. 3/a/1's person-level rule** | CBJ Instr. 9/2026 art. 3/a/1 | *(not yet declared in code — see "Owed" below)* | A corporate broker may hold both types only if the *same* manager, practitioner or employee does not handle both. Module 0 modelled the office-level rule and not the person-level one. |
| 10 | **`RegulatoryAction` cannot express a PARTIAL sanction** | CBJ Instr. 9/2026 art. 21/b/5–6 | `migrations/20261122100000_…/migration.sql` header | Art. 21/b/5 suspends or cancels «في جميع فروع التأمين ... أو بأي منها» — in ALL the insurance lines or ANY OF THEM — and 21/b/6 does the same for an office branch inside or outside the Kingdom. Every act in this table is TOTAL. **The direction is stated because it is not the safe one**: a partial suspension recorded as total reports an office as unable to write business it is lawfully still licensed for, which runs AGAINST the brokerage — the same direction as the empty holiday calendar. Nothing in this module claims the act model is complete. |
| 11 | **Whether art. 14/c reaches an art. 21/b suspension is UNSETTLED, and is not inferred** | CBJ Instr. 9/2026 arts. 14/b, 14/c, 21/b | `license-standing.config.ts`, and the migration header | 14/b scopes itself to «الفقرة (أ) من هذه المادة»; 14/c carries no such phrase. The text reads either way. Today it only matters for a 21/b suspension that states no period, since one that names its own end date expires on its own. **A question for the regulator, deliberately not resolved by reading** — correction 0.1 of this module was stripping a rule asserted under an article that did not carry it, and inventing the opposite here would be the same mistake with the sign flipped. |
| 12 | **`BrokerLicense.status = 'lapsed'` is a SECOND HOME for what `RegulatoryAction` now models** | decision 71 | `broker-license.config.ts`, `license-standing.config.ts` | The manual marker predates the act table and is IN USE — measured: 0 rows on dev, 19 on db-test, with `BrokerLicenseRepository.markLapsed` reachable from the service. The derivation reads it as SUSPENDED with a NULL decision reference (its own documentation says it means a CBJ suspension), so nothing is currently wrong — but two homes for "has the regulator stopped this office" is one too many. **The collapse order is: record acts for whatever the marker was standing in for, THEN drop the column** — never the reverse, which would lose the fact before it was recorded anywhere. |
| 13 | **The eight reference tables cannot RETIRE a row** | item (c), item (d) | `reference-data.service.ts` | They carry `code`, both names, `descriptionAr` and `displayOrder` — and no `isActive`. Found by the compiler: the first version of the reference service carried a paragraph explaining how retired rows are handled. A column is NOT invented, because the question it raises is a decision: what happens on the screen of an office whose stored legal form has been retired — does it still render, and does it still validate? |
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
| Takaful terminology templates | decision (business model is a table; nothing may branch on it) | **item (e)** |
| The real mail sender | owner's decision B2 | **item (f)** — a temporary on-demand script stands in |
| `INSURANCE_COMPANY_ADMINISTRATOR` | owner's decision | **item (f)** |

---

## Module 0 — identity, licence and scope

| # | Item | Article / decision | Declared in code at |
|---|---|---|---|
| 1 | The renewal-pending rule has **no provision behind it** — it is the owner's decision, supported only by analogy with art. 8/d of Law 12/2021, which does not extend to brokers | Owner's decision | `broker-license.config.ts` (`RENEWAL_PENDING_RULE_BASIS`) |
| 2 | Art. 4/a capital is a **warning, never a refusal** | art. 4/a | `broker-license-scope.config.ts` |
| 3 | A non-31-December expiry **warns, never blocks** | art. 10/b | `broker-license.config.ts` |
| 4 | The bank guarantee has **no basis in Instructions No. 9 of 2026** | — | to be declared on the field itself in **item (d)** |

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
