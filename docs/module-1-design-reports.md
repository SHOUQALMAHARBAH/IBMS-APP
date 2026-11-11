# Module 1 — four design reports

### Measured 2026-11-10 on `module-1/corrections-and-carried-decisions`. Message 34 §6: measure and propose, build nothing.

**Every figure states the unit it was counted in.** A figure without its unit is the defect this
repository has paid for most often; a figure whose counting method is written beside it can be
re-run, and *the number of whoever re-runs it wins*.

**Nothing in this document is built.** It is the input to the next batch.

---

## 6.1 · The legal-values table

### What exists

**Two candidate shapes are already in the codebase, and neither is complete for decision 123.**

| | `SlaPolicy` | the eight reference tables |
|---|---|---|
| value + unit | ✅ `durationValue` + `durationUnit` — **durations only** | ❌ no value column at all |
| legal citation | ✅ `sourceType` / `sourceReference` / `sourceDocument` / `sourceSection`, **mandatory by CHECK when `sourceType = REGULATORY`** | ❌ none |
| dated history | ✅ `effectiveFrom` / `effectiveTo`, **applied in the repository** (`sla-policy.repository.ts:49`) so no caller can forget it | ❌ none |
| who changed it | ✅ `createdByUserId` / `updatedByUserId` | ❌ none |
| **provider-owned** | ❌ **tenant-scoped** — `organizationId String @default(dbgenerated())`, the RLS column | ✅ **platform-scoped, provider-maintained, seeded** |
| Arabic meaning per row | ❌ | ✅ `descriptionAr`, **required by a per-table CHECK** since `20261130100000_value_descriptions` |

**So `SlaPolicy` has four of the four things §4.2 demands and cannot express provider ownership; the
reference family expresses provider ownership and has none of the four.** The discriminator is the
column neither has.

### What is missing — and it is exactly decision 123's own split

Decision 123's **first half** (a figure the instrument STATES) requires a row that is
**provider-owned**: one edit applies to every office, and ⛔ **an office account must be refused**
(criterion 7, new in the third form). Its **second half** (a figure the instrument DEFERS to a
ruling not yet issued) requires an **office-supplied** row with three guards, all falling on the
manager once.

**One table must hold both.** A reader of a transaction's tag must not have to know which table to
look in to find out where the figure came from.

### The shape I would use

**A new table carrying `SlaPolicy`'s four columns verbatim, with a NULLABLE tenant column where
NULL means provider-owned.** Not a new pattern: `BrokerLicenseScopeLine`, `EmployeeCbjApprovalBranch`,
`RoleScopeBranch` and `RegulatoryActionScopeLine` already carry a nullable standard/office pair with
**two PARTIAL unique indexes in raw SQL** — because a compound unique over a nullable column admits
unlimited NULL rows — plus an exactly-one CHECK. Four precedents, all written here, all tested.

- **Ownership** = `organizationId IS NULL`. Criterion 7 is then a CHECK and an RLS policy rather
  than application logic: an office session cannot write a NULL-tenant row, which is the form that
  **cannot express the mistake** rather than the one that requires noticing it.
- **Uniqueness** must be dated, not flat. ⚠️ `SlaPolicy`'s `@@unique([organizationId, policyCode])`
  **stops a superseded value sitting beside its replacement** — which is §4.2's own warning and is
  in direct conflict with criterion 3 (*read an old transaction at the value in force on its own
  day*). Use a partial unique on `effectiveTo IS NULL` instead: one CURRENT row per code, any number
  of historical ones.
- **The value column** is the one real design question, and I would make it a **typed pair**:
  `valueKind` (`AMOUNT_JOD` · `PERCENT` · `DURATION` · `COUNT` · `LIST`) plus the columns that kind
  needs, with a CHECK that exactly the right ones are non-null. A single stringly-typed `value`
  column would put `50%`, `2000` and a list of contract types in one column and make every reader
  parse it.

### The one I would refuse, and why

⛔ **Extending `SlaPolicy` in place.** Three measured reasons:

1. **It is tenant-scoped.** Provider ownership and criterion 7 have no home in it, and giving its
   `organizationId` a NULL meaning changes what every existing SLA row means.
2. **Its uniqueness rule contradicts criterion 3**, above.
3. **One of its two read paths already bypasses the effective dating.** `sla-timer.service.ts:206`
   passes the transaction's `baseDate`; **`:247` calls `findActiveFor` with no `at`, so it reads by
   TODAY's date.** Putting legal values on that table inherits a defect in exactly the property
   criterion 3 depends on.

And ⛔ **not the ninth reference table as it stands either** — that family has no dated history and
no citation, which are two of the four things 123's first half requires. *Make `SlaPolicy` migrate
onto the new shape later; do not migrate the new shape onto `SlaPolicy`.*

### Every value that goes in, with its article and page

**From the instrument, read from the page images 2026-11-10 — provider-owned (first half):**

| value | article | printed page |
|---|---|---|
| effective date **24/6/2026** | م(١) | 3 |
| **5,000 JOD**, up to 6 branches | م(٤/أ/١) | 5 |
| **7,500 JOD**, up to 12 branches | م(٤/أ/٢) | 5 |
| **10,000 JOD**, above 12 | م(٤/أ/٣) | 5 |
| the branch boundaries **6** and **12** | م(٤/أ) | 5 |
| **2,000 JOD** annual premium ceiling | م(١٥/د/٤) | 17 |
| **at least 3 insurance companies** | م(١٥/د) | 17 |
| **50%** net-equity fall | م(٢١/أ/١٢) | 26 |
| **30 days** ex-agent bar | م(٢٢/م) | 29 |
| **45 days** renewal filing | م(١١) | — (already a literal, declared) |
| **2 years** deemed cancellation | م(١٤/ج) | — (already a literal, declared) |
| **50,000 JOD** for >5 physical branches | م(١٣/ب/٢) | 16 |

> **CORRECTED 2026-11-11 (message 35 §1.4).** That last row read **"NOT yet read from the
> image — the extraction marks it trusted on a rule that has failed twice"**. The owner read it
> on 10–11 November: the instrument says **«أن لا يقل رأسماله عن (٥٠) الف دينار»**, printed page
> 16. So the figure is confirmed and the doubt is closed. **The mechanism it warned about is
> still real** — a Latin-digit OCR output is not evidence of a Latin-digit input — and that is
> why this row needed a reading rather than an inference. **And art. 11 has a title**, which this
> report and our own reference both denied: **«المادة (١١): تجديد الترخيص»**, printed page 15.

**From the owner's decision of 9 October — provider-owned:** 7 business days · 3 days · 45 days ·
one month · 60 days · a fortnight · 2,000 JOD · 3 companies · 15 hours · 50% · the capital bands.

**From §2's code measurement:** `CAPITAL_BANDS` (five figures) and the two already-declared
constants are the complete set of legal figures a program reads today —
`npm run check:legal-numbers` is the re-runnable instrument, and its `DECLARED` list is the live
record of what this table owes.

**Office-supplied (second half), per decision 123 — measured 2026-11-10:** the commission bases and ceilings م(٢٢/ز) ·
the professional-indemnity contract conditions م(١٠/أ/٤) · the defined-benefit contract list
م(٢/أ). **All three are deferred by the instrument to a later Central Bank decision that had not
issued.**

---

## 6.2 · The declared-act machine

### What exists to build on

| | where | what it already does |
|---|---|---|
| **the act record** | `CombinedDutyAct` | office · entity · entityId · **`constraintName` — the rule being excused** · the one actor · a NOT-NULL `reason` · `actedAt` · every role held · the subset that granted the checker permission · `multipleGrantingRoles` |
| **the floor** | `common/declaration-reason.ts` | `DECLARATION_REASON_MIN_LENGTH = 10`, **one home**, nine importers, and enforced in SQL twice |
| **the standing declaration** | the retention table's unknown-category declaration | **asked ONCE per category per office** — the precedent decision 123's standing declaration needs, already built |
| **the escape** | 16 maker/checker CHECK constraints | each carries `OR "combinedDutyActId" IS NOT NULL`, taken verbatim from `pg_get_constraintdef`; one trigger refuses an act for a non-`COMBINED` office |

**So the machine is not a green field.** What is general about it — a record naming the rule it
excuses, a reason with a floor, an actor, and a database that will not let the act be silent — is
built once already and works.

### The four gaps, measured

1. **🔴 `AuditLogEntry` HAS NO IP FIELD.** Measured: `ipAddress` appears on exactly **two** models,
   `RefreshToken` and `UserSession`, and nowhere else in the schema. The adviser's hardening asks
   for the network address **in the record**. *Size:* one nullable column on the act table (not on
   `AuditLogEntry`, which is append-only by trigger and 3,000+ rows wide per environment), plus
   threading the request IP to the service — the api already has it at the guard layer for sessions,
   so this is a parameter, not a mechanism.
2. **⚠️ THE REASON MINIMUM IS 10 AND THE ADVISER'S WINDOW ASKS FOR 15.** `declaration-reason.ts:27`
   is the one home, by the owner's own instruction that *two different minimums for one concept is
   the drift we keep paying for*; the drafted art. 15/d window says 15. **Reported, nothing changed.**
   One concept with one minimum is right until she says which number it is.
3. **🔴 `RegulatoryActionKind` HAS NO DEFICIENCY NOTICE.** Measured: the enum has exactly three
   members — `SUSPENSION`, `CANCELLATION`, `REINSTATEMENT` — and `RegulatoryActionBasis` has two,
   `BROKER_REQUEST` (art. 14/a) and `SANCTION` (art. 21/b/5-6). **«إشعار نقص» lives nowhere**:
   zero models, zero enum members, zero columns. The decisions of 13 and 20 October make it a third
   kind beside suspension and cancellation. *Size:* one enum member plus a derivation rule — and the
   rule is the work, because a deficiency notice must **not** move `status` or `mayPractise`, exactly
   as a scoped act must not (the art. 21/b/5 precedent is one commit old and is the shape to copy).
4. **⚠️ THE ADVISER'S 15/d TEXT CARRIES `2000` INSIDE THE SENTENCE**, used verbatim and not ours to
   edit (`docs/answers/legal-counsel-six-items-verbatim.md:198`). **What happens when the table row
   changes:** the sentence goes stale and the window — which IS the compliance record — asserts a
   figure the system no longer holds.
   - *Interpolating the figure into his sentence* edits his text. Refused.
   - *Leaving it and hoping* is the failure.
   - **Pin it.** `screen-copy.test.ts` already does exactly this for decision 54's «٢٠٠٠٠» against
     `INTERNAL_CONTROLS_SCAN_LIMIT`: the text stays byte-identical and the BUILD fails the day the
     row moves, so a human updates both and the change to his sentence is a decision somebody takes
     rather than an interpolation nobody sees. **This is the established precedent in this repo and
     is what I would do.**

### And the count the preflight carries is wrong

**The declared-act pattern does not have one caller. It has SEVEN** (decision 126's own table):
م(١٥/د) · م(١٩/أ/٣) · م(١٦/ي/٨) · work after a mandate is withdrawn م(١٥/هـ) · staff below the
minimum at issuance م(٤/ز) and م(٢٢/ج-د) · the office manager holding data protection · one person
practising life and general م(٣/أ/١). ⟶ **So it is general from the first line**, and each site
carries its own article text and **its own separate permission**.

---

## 6.3 · The permission names (decision 127)

### The figures, re-derived — every one of the owner's reproduces

| | measured | unit |
|---|---|---|
| catalogue codes | **230** | `code:` entries in the generated fixture, which `permission-catalogue-parity.spec.ts` pins to the seed in both directions |
| offered in the office matrix | **225** | 230 minus the PLATFORM-scoped |
| PLATFORM, withheld by design | **5** | `scope: 'PLATFORM'` |
| route handlers | **531** | one `@Get/@Post/@Put/@Patch/@Delete` in a non-spec controller |
| permission-guarded | **505** | handler or its controller class carries `@RequirePermissions` |
| `@Public()` and not guarded | **12** | |
| **neither** | **14** | **eleven in `auth.controller.ts`** + `company-record.controller.ts:36` + `conflict-of-interest.controller.ts:34` + `notification.controller.ts:21` |
| codes no non-spec **server** file references | **4** | `claim.delete` · `commission-reversal.create` · `diagnostics.view` · `refund.raise` |

### For each of the fourteen: is it by decision? — **yes, all fourteen, on one principle**

Every one acts on **`@CurrentUser()`'s own row**: change your own password · list and revoke your own
trusted devices · log yourself out · enrol, verify and disable your own TOTP · step up · read your own
profile · set your own language · heartbeat your own session · read your own company's registry record
· file your own conflict-of-interest disclosure (**decision 80**, cited at
`conflict-of-interest.controller.ts:26`) · read your own notifications.

**A permission answers *may you act on the OFFICE's data*. None of these touch the office's data.**
Gating them would let a role be configured to hide a person's own alerts from them, or to lock them
out of enrolling MFA — and `/settings/security` being ungated is already a recorded requirement,
because gating it loses MFA enrolment for 10 of 11 roles. ⟶ **No change recommended. The number to
watch is the 14, not the individual routes: a fifteenth unguarded route that is NOT self-service is
the defect, and nothing counts them today.**

### And the four-versus-three split is a UNIT difference, not a disagreement

The module paper says **three** unimplemented; the measurement says **four** codes with no server
reference. Both are right:

- **Three** — `claim.delete`, `refund.raise`, `commission-reversal.create` — are **declared and not
  enforced, each with a written reason**, in `packages/db/prisma/seed-data/permission-enforcement.inventory.spec.ts`,
  and gated in both directions.
- **The fourth, `diagnostics.view`, IS enforced — in the WEB.** It gates whether
  `/settings/email` shows the server's raw error text (`page.tsx:113`), with two e2e tests that assert
  both directions. It has no server reference **by design**, because nothing on the server branches
  on it. ⟶ ***no non-test server reference* ≠ *unenforced*.**

### The shape I would use for the names

**A derivation table, not a shipment.** For every one of the 230 codes: the Arabic NAME, and **the
span of its own shipped Arabic description it was sliced from**. Where no span yields a name, the
cell is **left empty and goes to the owner** — a guessed cell is the one thing this must not contain.
The table is ratified before a single name ships. **Her first row already exists:**
`retention.archive.retrieve` → **«استخراج سجل مؤرشف/محجوب»** (hers, given 2026-11-10 — «مؤرشف» does
not ship today, which is exactly why the word had to be hers).

**Two guards at a budget of zero**, each with its own pattern so one cannot mask the other: *no
permission without a name* · *no code rendered to a reader*. The second has three known render sites
(`PermissionMatrix.tsx` ×2, `settings/roles/page.tsx:693`) plus **five** Arabic refusal strings ending
in `({code})` — there were three on the day of the decision, which is the growth a budget-zero ratchet
stops.

---

## 6.4 · The audit-trail identifier becomes a link

### What exists

`audit-trail/page.tsx:160` renders `{r.entityType} · {r.entityId}` as monospace text. There is
already a closed-set map for entity types — `apps/web/lib/audit-trail/record-entity-types.ts`, two
maps (16 and 15 members) for `/internal-controls` and `/sla-dashboard`, **every entry pointing at the
key already rendering on that entity's own screen** (decision 53 / decision 41's mechanism).

### The size, measured

| | count | unit |
|---|---|---|
| distinct `entityType` literals the api writes | **141** | `entityType: '…'` in a non-spec file under `apps/api/src` |
| …that name a model in `schema.prisma` | **112** | |
| …that name **no model at all** | **29** | dashboards, searches, reports — plus one lowercase `individual` |
| `[id]` detail screens that exist | **15** | `app/(app)/*/[id]/page.tsx` |
| **entityTypes with a screen** | **15 of 141 — 11%** | all 15 screens correspond to an audited entityType; none is orphaned |

### The sharp finding, which changes the design

**29 of the 141 are not records.** `ClaimsDashboard`, `CustomerSearch`, `PolicySearch`,
`ExecutiveDashboard`, `DpoWorkspace`, `PlanningExport` and the rest are **view** events, where
`entityId` is not an id anything can navigate to. ⟶ **A type→screen map must refuse those
explicitly rather than merely not matching them**, or the first person to add a `/searches/[id]`
screen turns a search event into a broken link. And `individual` is a **data value in a type
column** — reported, not fixed.

### The shape I would use

- **A total map over the 141, not a lookup that falls through.** `Record<EntityType, Screen | null>`
  where `null` is a *decision that this type has no screen as at 2026-11-10*, with the 29 non-records carrying a
  distinct third value — `NOT_A_RECORD` — so they can never acquire one by accident.
- **The 141 are PARSED from the api, never restated**, the way `record-entity-types.spec.ts` already
  parses its own sources: a 142nd type added in the api fails the spec by name on the commit that
  adds it, which is the only moment anybody knows a word is owed.
- **Where the map says no screen (measured 2026-11-10) the identifier stays and is LABELLED as machine text** — which is the
  owner's own ruling, and it is also the only thing that keeps `check:rendered-identifiers`' budget
  honest: 126 of 141 stay visible, so this is not a pass that removes identifiers, it is one that
  removes **the ones a person can act on**.
- ⚠️ **Three of the 15 screens have no navigation to them at all** (`/leads/[id]` was closed in
  module 0-c batch 8; `/up-sell/[id]` and `/cross-sell/[id]` are still unreferenced and untested).
  Linking the audit trail to them would make the audit trail their FIRST caller — which is fine, and
  worth knowing before a reader reports a broken screen as an audit-trail defect.

---

## Appendix · decision 125, the measurement only — **nothing changed**

Message 34 §4 asked for two figures before any dash is closed: **how many dash renderings per
module, and how many of them are an option inside a select** — because the owner's reason names the
select case first (*«رح توقف مستخدم من تكملة شغله لانه ما رح يعرف يختار لانه شرطة»*).

**The unit matters more than the figure here, and my first run had it wrong.** Counting em dashes
gave **504 dictionary keys** and the number meant nothing: nearly all of them are an em dash used as
PUNCTUATION inside a sentence. Decision 125 is about a dash standing **where a value would be**, and
about a dash offered **as a choice**. Three populations, measured 2026-11-10:

| | count | unit |
|---|---|---|
| **A · a dictionary value that IS a dash**, or a `— word —` placeholder | **7 keys** | value is `—`, or matches `^—.*—$` |
| **B · a JSX fallback** — the screen printing a dash because it has nothing | **99** | `?? '—'`, `\|\| '—'`, `: '—'`, plus a placeholder key rendered outside an option |
| **C · an OPTION offering a dash as a choice** | **15, of which 14 are real** | inside an `<option>…</option>`; comments stripped first |
| screens or components carrying at least one | **49** | a directory under `app/(app)/`, or a component file |

**The seven value keys**, which are where decision 60's *«ما عداها يحتفظ بشرطته»* survives:
`complaintsSlaNone` «—» · `insDetailEmptyField` «—» · `customerPickerNonePlaceholder`
«— اختر عميلاً —» · `empUnset` «— غير محدَّد —» · `entitySearchActorNone` «— كل الأشخاص —» ·
`usrSelect` and `usrSelect2` «— اختر —».

**The fourteen option sites, which are the ones that stop a person mid-task:**
`complaints/page.tsx` · `employees/[id]/page.tsx` ×2 · `employees/page.tsx` ×2 ·
`needs-assessments/new/page.tsx` · `provider-register-insurer/page.tsx` ·
`provider-register-office/page.tsx` · `regulatory-compliance/page.tsx` · `rfqs/[id]/page.tsx` ·
`settings/users/page.tsx` ×2 · `CbjApprovalPanel.tsx` ×2.

⚠️ **The fifteenth is a FALSE POSITIVE and is named rather than quietly dropped:**
`RecommendationSection.tsx:307` renders `{q.insurer.name} — {premium}` inside an option label, which
is an em dash as punctuation between two values, not a dash standing for one. **A sweep that treated
every dash inside an `<option>` as decision 125's subject would rewrite it and break a label that is
already correct** — which is the same mistake decision 60 was protecting against, one level down.

**Nothing was changed.** Decision 125 is explicitly module by module, each module measuring its own
screens, and the word for each field is the owner's or a slice from that same screen.
