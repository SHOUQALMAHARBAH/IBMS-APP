# The deferred register

**Every module closes with this list.** Owner's standing instruction, 2026-10-13:

> A single list, derived from the code and not from memory, of everything that module declared
> unimplemented or deferred, each with its article or decision number and its location. Measured,
> not recalled — because deferred work that lives in someone's head is not deferred, it is
> forgotten work whose due date has not arrived yet.

**Where an item is declared unimplemented in code, this register's entry and the code's comment
must say the same thing. If they diverge, THE CODE IS RIGHT AND THIS FILE IS STALE** — and that
divergence is itself worth checking for.

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

### Pending the item that creates them

These are the owner's items whose declaration site does not exist yet. Each lands with its item.

| Item | Article / decision | Lands with |
|---|---|---|
| Per-branch last-activity tracking | art. 21/a/10 | a later module |
| The warned-act mechanism, and the issuance gate that depends on it | arts. 15/d, 19/a/3, 16/y/8 | module 1 (specified in the module 0-ب brief's appendix; **must not be half-built earlier**) |
| The legal-values table | decision; م١٥/ي reads from it | module 1 |
| Art. 15/i and 15/k against the IBAN field | arts. 15/i, 15/k | **item (d)** — the IBAN column does not exist yet |
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
2. **Wherever a seed or a test asserts a QUANTITY of permissions, roles or grants, it asserts the
   wrong thing.** A count cannot see a substitution. Demonstrated: with a count check, a swapped-in
   `customer.create` was accepted *and really granted*. Nine found, two converted, one live
   compliance-reporting gap discovered (`needs-assessment.approve`).
3. **A guard that runs after the write it guards is a report, not a guard.** The check belongs
   inside the transaction that writes. Applies directly to item (d), where the organization, the
   licence term with its certificate and the scope lines are written together.
