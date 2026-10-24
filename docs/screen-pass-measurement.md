# THE SCREEN PASS — THE MEASUREMENT, BEFORE ANY FIX

Decision 34. The owner struck the attrition rule from batch 4 (*identifier hiding becomes a build
rule on new work and the existing count shrinks by attrition*) knowing the cost: nothing is to be
left missing, because a screen that shows a user something they cannot read is not cosmetic — it is
this product failing at the one thing it exists for.

Her instruction for this step: **run the measurement, report the size, and stop.** Nothing below is
built. Six numbers and a bill.

---

## 0. WHAT IS ALREADY GATED — read first, because commissioning what is built is work paid twice

Her own warning, and it changes the shape of this report. **Three of the six faults already have a
measurement script, and two already have a CI gate failing in both directions.**

| fault | script | wired to CI? | what it reports today |
|---|---|---|---|
| (1) identifier where a name exists | `identifier-labels.py`, `rendered-identifiers.py`, `typed-identifier-inputs.py` | `check:labels` only | one third gated at **0**, two thirds ungated |
| (2) every control shown is permitted | `screen-route-permission-fit.py` | **`check:screen-route-fit`** | **1** declared mismatch, no new, none stale |
| (3) every capability has a route | `unreachable-routes.py`, `unreachable-routes-by-verb.py` | no | **29** routes no web code can call |
| (4) Arabic, in the broker's words | `hardcoded-ui-english.py` | no | **0** screens with hardcoded English |
| (5) the empty state says what to do | `four-states.py` | no | **2** screens with no empty-state signal |
| (6) the error says what to fix | `four-states.py`, `load-error-way-forward.py` | no | **1** screen with no load-error branch; **0** load-error keys without a way forward |

So the pass is **not** six greenfield sweeps. It is two ungated thirds of fault (1), a triage of
fault (3), one judgement sweep for fault (4), and three loose ends.

---

## 1. THE SCREEN COUNT, RE-MEASURED

Her instruction was not to carry mine, and the carried figure was wrong in a way worth naming.

| measured | count |
|---|---|
| `page.tsx` under `apps/web/app/` | **111** |
| …of those under `(app)/` — the signed-in application | **106** |
| …of those under `(auth)/` — rendered before sign-in | **5** |
| destinations in the navigation map | **81** |

**The scripts scan 106.** The five `(auth)` screens are outside every one of them, and that is a
real gap rather than a convention: they have no permission concept, but they do have empty states,
error messages and Arabic copy, so faults (4), (5) and (6) apply to them and nothing has ever
looked.

### CORRECTION — "29 screens show an identifier" was never 29 screens

The papers say twenty-nine screens. Measured: **29 IDENTIFIERS across 21 SCREENS.** The figure was
a count of findings read as a count of screens.

---

## 2. FAULT (1) — AN IDENTIFIER WHERE A NAME EXISTS

### THE TEST, IN WRITING

The fault has **three distinct shapes with three different fixes**, and collapsing them is how a
single number stops being actionable. A finding is:

> **(1a) A LABEL THAT NAMES A COLUMN.** A user-facing string whose whole content is a noun plus
> "id" — *Branch ID* tells a person the column's name where *Show one branch only* tells them what
> the field does. Classified BY USAGE: inside `<label>` it is a **PROMPT** and counts; inside `<th>`
> it is a **HEADING** and does not, because a table column names its column by design; rendered by
> no screen it is **DEAD** and does not.
>
> **(1b) AN IDENTIFIER A READER SEES.** A uuid reaching a person — `.id` whole or sliced, appearing
> in JSX text, a translation PARAMETER, an `aria-label` or a template literal. The parameter case is
> the one that matters: the hardcoded-English script strips `t(...)` before looking at a line, so an
> id put INTO a sentence is invisible to it, which is exactly where an id most naturally ends up.
>
> **(1c) AN IDENTIFIER A PERSON MUST TYPE.** An `<input>` whose bound state is identifier-shaped,
> inside a form. Reported with whether it is `required`, because that is the line between *awkward*
> and *unusable*. A `<select>` bound to an id does NOT count: a select offers its options, so the id
> is the value and the label is a name — which is the correct shape and is what (1c)'s findings
> should become.

Two false positives are excluded **by name with a reason**, not by pattern, because both are an
identifier a person genuinely knows and should type: the national ID on the person-registration
form, and a figure read off a document.

### THE NUMBERS

| shape | finding | screens | gated |
|---|---|---|---|
| (1a) label naming a column | **0** | — | **YES — `check:labels`, budget 0, a flat ban with no switch** |
| (1b) identifier a reader sees | **29** | **21** | no |
| (1c) identifier a person must type | **26 inputs** | **14** | no |
| …of (1c), `required` — the screen cannot be used without one | **2** | | |

**(1a) IS ALREADY WHAT DECISION 34 ASKS FOR** — zero, in both directions, with two exclusions
printed rather than filtered away so a reader can argue with them. Nothing is owed there.

The 21 screens carrying (1b): `audit-trail`, `communications`, `complaints`, `consent`,
`cross-border-transfers`, `dashboards/insurer-employee-performance`, `dashboards/policy`,
`feedback`, `information-assets`, `insurance-programs/[id]`, `internal-controls`, `opportunities`,
`opportunities/[id]`, `payment-channels`, `planning-export`, `retention-cases`,
`retention-disposal` (4), `service-requests`, `sla-dashboard`, `transaction-monitoring`,
`vendors/[id]`.

---

## 3. FAULT (2) — EVERY CONTROL SHOWN IS PERMITTED FOR THE ROLE SEEING IT

### THE TEST, IN WRITING

> For every (role, screen) pair where the role can OPEN the screen, does every route that screen
> calls resolve for that role? **A page that returns 200 and renders empty counts as a FAILURE** — a
> check that only asked whether the page loaded would pass the owner's original defect, where eight
> dropdowns came back empty with every existing gate green.

### THE NUMBER

**1 declared mismatch. No new ones. None stale.** Already a CI gate (`check:screen-route-fit`),
failing in both directions so the declared list can be neither a ceiling nor a graveyard. 146
(role, screen, code) triples are classified REFUSED-BUT-HANDLED — the screen names the code and
gates a section, hides a control or renders a refusal — and are not findings.

**The one row is a declared BLIND SPOT of the measurement, not a defect.** `/employees` ×
`BRANCH_DEPARTMENT_MANAGER` × `GET /rbac/roles`: the role fieldset sits inside a screen-computed
`user.manage` flag that this role does not hold, so the control is already hidden and the loader
never calls the route. The check maps imports to routes and cannot see a call behind a
screen-computed flag; teaching it to was considered and refused, because the obvious rule would have
hidden the original defect.

**Nothing is owed on fault (2).**

---

## 4. FAULT (3) — EVERY CAPABILITY THE ROLE HOLDS HAS A ROUTE TO IT

### THE TEST, IN WRITING

> Two passes, because one is a LOWER BOUND. The **path** pass asks whether any web code addresses a
> route's path at all. The **verb-aware** pass pairs the HTTP method with the path, and finds routes
> the first pass counts as covered because a SIBLING verb on the same path is called — `GET
> /insurance-lines` feeding a picker made `POST /insurance-lines` look reachable for weeks.

### THE NUMBER

| pass | finding |
|---|---|
| api routes in total | **530** |
| web paths addressed (verb-aware) | **388** |
| unreachable by PATH | **20 routes across 11 controllers** |
| additionally unreachable by METHOD | **9** |
| **total no web code can call** | **29** |

**NOT ALL 29 ARE FAULTS, and the distinction is the triage this pass owes.** Three classes, already
established: a genuine missing capability (the money that could not be paid); **redundant surface**,
where a route returns exactly what a sibling already returns (`GET /sla/timers/:id/status`); and
**correctly absent**, where the route is not a navigation destination at all (a provider OAuth
callback, subdomain resolution). The 29 have not been re-classified since the last pass.

---

## 5. FAULT (4) — THE LABELS ARE ARABIC AND IN THE BROKER'S WORDS

### THE TEST, IN WRITING, AND ITS HONEST LIMIT

> **The mechanical half** is decidable: a user-facing string that is English prose in the source
> rather than a `t(...)` key. Measured across 106 screens.
>
> **The judgement half is not decidable by any script**, and saying so is part of the measurement.
> *In the broker's words* means not a transliteration and not a schema field name — a reading, per
> string, in context. There are 111 screens and roughly 6,750 user-facing strings. No number below
> should be read as a clean bill on this half.

### THE NUMBERS

| half | finding |
|---|---|
| screens with hardcoded English | **0** |
| hardcoded English strings | **0** |
| i18n AR/EN parity | green, every dictionary registered |
| **the recorded judgement instance** — `/settings/email` says "office" where the PROVIDER also uses the screen | **8 Arabic lines, 7 English** |

The mailbox screen is the one fault-(4) instance already recorded, and it is **larger than the
recorded figure of six**: measured with comments stripped, per language, 8 and 7.

---

## 6. FAULTS (5) AND (6) — THE EMPTY STATE AND THE ERROR MESSAGE

### THE TEST, IN WRITING

> **(5)** A screen that can render a list has a branch for that list being EMPTY, and the branch
> says what to do rather than *no data*.
>
> **(6)** A screen has a branch for its load FAILING, and the message says what to fix. For a
> permission refusal that means naming the missing code and who grants it, by FUNCTION never by role
> name. For a load error it means a way forward — *— try again.* at minimum, since no screen in the
> application has a retry control.

### THE NUMBERS

| fault | finding |
|---|---|
| (5) screens with no empty-state signal | **2** — `prospects/new`, `vendors/[id]` |
| (6) screens with no load-error branch | **1** — `home` |
| (6) screens with no permission-refusal branch | **9** |
| (6) load-error keys examined | **114** |
| …with a way forward in BOTH languages | **114** |
| …in one language only, or neither | **0** |

### SHE WAS WARNED TO EXPECT A FIGURE LARGER THAN 29 BECAUSE EMPTY STATES AND ERROR MESSAGES HAD NEVER BEEN MEASURED. THEY HAVE, AND THEY ARE NEARLY CLEAN.

That warning was mine and it was wrong. `four-states.py` and `load-error-way-forward.py` both
exist, both run, and between them report **three** screen-level gaps and **zero** message-level
ones. The figure is larger than 29 for a different reason — fault (3)'s 29 routes and fault (1c)'s
26 inputs — not because these two were unexamined.

**The 9 "no permission refusal" screens are a WORKLIST, not 9 findings.** Eight are named —
`home`, `claims/[id]`, `company-record`, `insurance-programs/[id]`, `leads/[id]`, `policies/[id]`,
`prospects/[id]`, `risk-profiles/[id]` — and most fall in recorded exception classes: a detail page
addressed by an id answers **404 rather than 403 on purpose**, because a 403 would confirm that
another office's record exists; `company-record`'s refusal is about identity rather than capability,
so a permission sentence would send the reader to request a grant that does not exist; and `home`
has no permission concept. Reading them is part of the pass.

---

## 7. THE SUBSET NEEDING AN OWNER DECISION

Her constraints (i) and (iii): **no code may be minted or granted to a new role to make a screen
work**, and a screen wrong for an ORGANIZATION TYPE is reported rather than patched.

### (iii) — WRONG FOR AN ORGANIZATION TYPE: measured, and the candidate set is SIX destinations

Measured off the database rather than recalled, because the web fixture is generated from the
DEFAULT OFFICE and **excludes the provider entirely** — parsing it for the provider's codes returned
ZERO, a vacuous answer that looked like a clean one.

The provider role holds **13** codes and can open **6** of the 81 destinations:

| destination | written for the provider? |
|---|---|
| `/provider-offices` | yes |
| `/provider-register-insurer` | yes |
| `/provider-register-office` | yes |
| `/settings/security` | yes — ungated and universal by design |
| `/settings/users` | yes, measured: its copy names no office, and every list on it is the provider's own |
| **`/settings/email`** | **NO — 8 Arabic and 7 English lines call the reader an office** |

**ONE (iii) candidate: `/settings/email`.** And the closing mechanism already exists — two
destinations are already closed by `organizationTypes`, `/company-record` to
`INSURANCE_COMPANY` and `/settings/roles` to the two office types. So the decision here is a
WORDING one rather than a door-closing one: the provider genuinely needs a mailbox, so the screen is
right to be open and its copy is wrong.

### (i) — CLOSABLE ONLY BY WIDENING A CODE: UNDETERMINED, and that is the honest answer

The subset cannot be named without reading fault (3)'s 29 routes one at a time, which is the pass
itself rather than its measurement. The recorded instance is the refund disbursement — `refund.disburse`
is held by FINANCE alone, and the only screen carrying the control is gated on a code FINANCE does
not hold, so the only role that may pay a refund cannot navigate to the button. It is deferred with
the money work, and its fix is to move the control to where Finance works rather than to widen
Finance's view.

---

## 8. THE BILL

| work | size | boundable? |
|---|---|---|
| (1a) labels | **0** — already gated at 0 | — |
| (1b) 29 identifiers across 21 screens | each needs a name sourced from the api; some need a view field, a client field and a test | yes |
| (1c) 26 inputs across 14 screens, 2 required | most become `EntitySearch` sources; the component and six sources already exist | yes |
| (2) fit | **0** — already gated, the one row is a declared blind spot | — |
| (3) triage 29 unreachable routes into missing / redundant / correctly-absent | reading, then an unknown build for whatever is genuinely missing | the triage yes, the build no |
| (4) mechanical half | **0** | — |
| (4) judgement half — 111 screens read for *the broker's words* | the largest and least boundable item in the pass | **no** |
| (5) 2 screens | small | yes |
| (6) 1 screen + a 9-row worklist to read | small | yes |
| the 5 `(auth)` screens, outside every script | small, and currently unmeasured for (4), (5), (6) | yes |

**ESTIMATE: four to six batches.** The boundable work — (1b), (1c), (5), (6) and the `(auth)`
screens — is two to three batches with tests and plants. Fault (3)'s triage is half a batch; what it
uncovers is not estimable before it runs. **Fault (4)'s judgement half is the one that cannot be
sized from here**, because it is 111 screens read one at a time against a criterion only a person
who speaks the broker's Arabic can apply — and it is the half most likely to produce findings this
measurement cannot see.

### WHAT THE PASS WILL PRODUCE, PER HER INSTRUCTION

An inventory in the repository, regenerated by the pass, with **CI gating the total and failing in
both directions** — the page-wide-absence precedent, so an improvement is recorded rather than
silently absorbed. Three of the six already work that way; the gate for (1b), (1c) and (3) is part
of the work above.

## 9. THE PASS CLOSES AS A DECLARED STATE — 2026-10-23, batch seven

The owner's instruction for this item was that the pass closes as a declared state rather than as a zero. So this section says what is open, what is shut, and whose each remaining row is. Every figure below is the output of a script in `scripts/measurements/`, not a recollection.

### THE FIVE PRE-SIGN-IN SCREENS — MEASURED FOR THE FIRST TIME, AND THEY ARE CLEAN

Register entry 111 recorded that faults (1), (4) and (5) were UNMEASURED on the five `app/(auth)` screens, because all three scanners root at `app/(app)`. Confirmed: `rendered-identifiers.py` holds `'(app)'`, `typed-identifier-inputs.py` holds it in `SCREENS`, `four-states.py` in `APP`. Measured by running each scanner against the `(auth)` root:

| fault | the five screens | reading |
|---|---|---|
| (1) an identifier where a name exists | **0** | 5 screens scanned, nothing rendered |
| (4) a typed identifier | **0** | 5 screens, 0 inputs, 0 required |
| (5) no load-error branch | **0** | — |
| (5) no empty-state signal | **0** | — |
| (5) no permission refusal | 5 | **inapplicable by construction, not a finding** |

The last row is the one to read carefully. A screen that renders BEFORE sign-in has no authenticated user and therefore no grant to lack: there is nothing for a permission refusal to refuse. That is the same reading batch one's own triage already applied to these four screens, and it is why the blind spot was real and the screens are nonetheless clean.

**THE SCANNERS ARE DELIBERATELY NOT WIDENED, and the reason is narrower than the earlier instruction.** `CLAUDE.md` said not to widen them *to a surface where three of the six questions do not apply*. That reason still holds for `four-states.py`: its refusal class would add five permanent findings nobody can close. It does NOT hold for the other two, and they are not widened either, for a different reason — both measure **0** there, so widening moves no budget and buys a ratchet over a surface with nothing on it. What is given up is stated: if an `(auth)` screen ever renders or asks for an identifier, nothing will catch it, and this measurement is a snapshot rather than a gate.

### THE REMAINING FOUR-STATES ROWS — ALL THREE READ, NONE A DEFECT

The three screens still flagged were read one at a time, which is what that script's own closing line asks for (*each count is a WORKLIST*), and batch four's precedent of three flags that were all correct:

| screen | class | reading |
|---|---|---|
| `(home)` | no load-error branch | **correctly absent.** Measured: ZERO api calls on that page. It is a launcher built from `DESTINATION_GROUPS` and the permissions already in context, so there is nothing to load and no failure to report. |
| `prospects/new` | no empty-state signal | **correctly absent.** A create-only conversion form with no list. The script's own header already names this class: *a screen that loads nothing has no empty state to be missing*. |
| `vendors/[id]` | no empty-state signal | **a FALSE POSITIVE — the screen HAS one.** It renders `t('vendNoDpas')` when the agreement list is empty. The detector matches `.length === 0` and `None`/`Empty`, and this screen uses the INVERTED `dpas.length > 0 ? … : …` with a `No…`-named key. |

**SO THE TWO BUDGETS DO NOT MOVE, AND THAT IS THE HONEST RESULT RATHER THAN A MISS.** Lowering them would mean loosening the detector in the direction that produces FALSE NEGATIVES: `\.length\s*>\s*0` also matches `{x.length > 0 && <list>}`, which renders nothing when empty and IS the defect, and a `No[A-Z]` key pattern would match `NoFloor` and `NoTerm` on screens that have no empty state at all. A gate that reports a clean nothing is the failure this repository has paid for four times; a gate with two read exceptions is not.

### WHAT REMAINS OPEN, AND WHOSE EACH ROW IS — FINAL, 2026-10-24 (batch eight)

`RENDERED_IDENTIFIER_BUDGET` is **10**, down from **29** when the pass opened. Batch eight closed
**eight**: the four it was given (three dashboard aggregates, one either-or) plus three user names
and decision 50's reachable fallback. It answered three more by ruling rather than by code, and
found one to be an instrument artefact. The budget is held in TWO independent homes
(`scripts/measurements/rendered-identifiers.py` and `apps/web/test/screen-copy.test.ts`, each with
its own detector) and both were lowered together; the committed plant
`rendered-identifier-budget-raised` is pointed at 10.

| what | count | whose | state |
|---|---|---|---|
| records with NO HANDLE | 6 | **module 7** | DEFERRED-BY-DECISION (owner decision 46). A readable handle means inventing this product's first numbering scheme, and all four families live in module 7, whose money is frozen. The four-state `recordHandle` field answers until then. |
| `/audit-trail`'s polymorphic `entityId` | 1 | **ANSWERED** | OWNER DECISION 49 — the type's own Arabic word plus the number, never a name, because `entityType` is a bare `String`: an OPEN set. **Measured: dev holds 32 distinct values, db-test 139**, against eighteen labels, and on db-test **122 of 139 fall in the fallback**. The id still renders and still counts, which the ruling accepts: *the unknown is DECLARED, not approximated.* |
| `/internal-controls`' `entityId` | 1 | **the owner** | STOPPED AND REPORTED — register entry 133. Its set IS closed (15 maker/checker pairs, closed by a CI gate rather than by convention), so decision 49's test says NAME — and **only 6 of the 15 have a decision-41 word**, so delivering it means writing NINE Arabic words, which the same ruling forbids. Its USER column was closed in this batch; its RECORD column renders the type AS STORED beside the number. |
| `/sla-dashboard`'s `entityId` | 1 | **the owner** | Same finding, same shape, same entry: 16 types, **7 with a word, NINE without**. Reported rather than half-built, because a map naming seven of sixteen renders a member name for the other nine — the notification-bell defect. |
| `/vendors/[id]`'s DPO approver | 1 | engineering, **not closable** | A DETECTOR FALSE POSITIVE — register entry 134. The id's single occurrence is a PRESENCE TEST (`!dpa.dpoApprovedByUserId`) gating the approve control; **no uuid reaches a reader**. The budget cannot fall for it without loosening the detector toward false negatives, so it stays counted and is declared instead. The real gap is the opposite one: the screen says WHETHER a DPA was approved and never BY WHOM. |
| four-states — 2 empty-state, 1 load-error | 3 rows | engineering | all three READ and none a defect; the budgets hold. Lowering them needs the detector loosened toward FALSE NEGATIVES. |
| four-states — permission refusal | 9 | engineering | unchanged and all read. |
| two capabilities with no door | 2 | **their modules** | entries 129 and 130. |
| `PUT /auth/security-config` | 1 | **employees-and-permissions** | decision 47. |

**6+1+1+1+1 = 10.**

### WHAT BATCH EIGHT CLOSED, AND WHAT EACH ONE COST

| screen | identifier | how | cost |
|---|---|---|---|
| `/audit-trail` | document-version uploader | `uploadedByName` on the view, through decision 48's resolver | a required third parameter on `buildDocumentVersionViews` |
| `/dashboards/policy` | `policyNumber ?? policyId` | decision 50 — the customer's name plus a state word | one include widened; register entry 131 records the nine `PolicyStatus` words owed |
| `/dashboards/insurer-employee-performance` | `insurerId`, `employeeId` | `insurerName` + `employeeName`, each through its own entity's resolver | two new batched resolvers; two column headings corrected from «معرّف …» by SLICING |
| `/planning-export` | `insurerId` | the SAME `InsurerPerformanceScoreView` — one change, two screens | one batched resolve covering the union of both sections |
| `/payment-channels` | `customerId ?? insurerId` | ONE `ownerName` field for the either-or, one Map keyed on whichever id is set | `CustomerRepository.namesForCustomerIds` added; `pcOwnerIdLabel` withdrawn, `pcColOwnerType` derived |
| `/information-assets` | `ownerUserId` | **a view layer this module did not have** — the service returned the raw Prisma row from all four paths | `InformationAssetView` + a required Map parameter |
| `/internal-controls` | scan actor `userId` | `SelfApprovalViolationView` — the classifier's output PLUS the name | a required third parameter on the report builder, because which ids matter is unknown until classification has run |

**FOUR BATCHED RESOLVERS NOW EXIST AND EACH SITS ON ITS OWN ENTITY'S REPOSITORY** —
`UserRepository.displayNamesForUserIds` (decision 48, batch seven),
`InsurerRepository.namesForInsurerIds`, `EmployeeRepository.namesForEmployeeIds`,
`CustomerRepository.namesForCustomerIds`. All four take IDS and return a Map; a MISSING key reports
NO NAME, never the uuid. **A fifth must not be a second answer to a question one of these already
owns** — which is the finding register entry 132 records against `insurerName`'s thirteen remaining
call sites.

**THE PASS IS THEREFORE SHUT ON EVERY FAULT IT CAN SHUT, AND EVERY REMAINING ROW HAS A NAME AGAINST
IT.** Nothing above is unaccounted for and nothing is a zero that was never measured — which is the
whole difference between closing a pass and declaring one closed.

## 10. EVERY STRING THE OWNER MUST SEE OR WRITE — the walk reads from here

One place, complete, with each row's state named. **SHIPPED-AWAITING-CONFIRMATION** means the words are live in the product and she is being asked to confirm them; **NOT-YET-WRITTEN** means the product is rendering something else — a member name, a type as stored, or nothing — until she supplies a word. A reader cannot guess which is which, so neither is left implied.

### SHIPPED-AWAITING-CONFIRMATION — live now, hers to confirm

| what | strings | where | note |
|---|---|---|---|
| the seven security-configuration labels and their meanings | 14 | `secCfg*Label` / `secCfg*Meaning` in `translations/operations.ts` | decision 47, **her own words, transferred verbatim**. The English is mine. |
| the four retrieval-basis texts | 13 | `rdBasis*` in `translations/pdpl.ts` | decision 45, **hers verbatim** — three named parts plus a shared line, and `OTHER` carries a fourth. |
| «مدّة الخمول» on the idle-timeout plural | 5 forms | `secIdleTimeoutMinutes` in `plurals.ts` | decision 4 of batch eight's brief — «مدّة» replacing «مهلة», DERIVED by slicing her own `secCfgIdleLabel`. |
| «(اسم العميل) — قبل الإصدار» | 1 | `dpolBeforeIssuance` in `translations/dashboards.ts` | **owner decision 50, hers.** See the LIMIT below — it stands in for a status that cannot yet be named. |
| «عميل محتمل» | 1 | `consSubjectLead` in `translations/pdpl.ts` | **owner decision 51, hers** — the singular of the plural already in `leadsHeading`/`navLeads`. |
| «{type} رقم {ref}» and the fallback label | 2 | `atEntityRef`, `atEntityTypeUnlabelled` in `translations/compliance-risk.ts` | decision 49's shape. «رقم» already ships 89 times; the pattern is mine, built around her «وثيقة رقم …». |
| the DPO combined-assignment notice | 2 | `dpoAssignNotice`, `dpoAssignAcknowledge` | **hers, pinned by `sha256 eecf5f3b…`** — a changed hash means somebody reworded a legal notice she wrote. |
| the no-floor retention declaration | 2 | `rdNoFloor*` | **hers, pinned by `sha256 b47fe02b…`**. |
| the eighteen workflow-entity words | 18 | `WORKFLOW_ENTITY_LABEL` | decision 41 — every one SLICED from a string already in the product, none typed. |
| the two import outcome words | 2 | `DUPLICATE` / `BAD_DATA` in the import panel | her decision; the second is an INSTRUCTION, not a label, and must not be shortened into a noun phrase. |
| 230 permission descriptions | 230 AR | `translations/permissions.ts` | hers. **215 still carry the CARRIED ENGLISH hint** (`CARRIED_ENGLISH_BUDGET`), which is a separate, measured backlog rather than a gap in the Arabic. |
| 55 reference-table Arabic descriptions | 46 still OWED | the generated reference-values export | hers; the export's own figure self-corrects as she writes. |
| three column headings corrected from «معرّف …» | 3 | `diepColInsurer`, `diepColEmployee` in `translations/dashboards.ts`; `pcColOwnerType` in `translations/finance.ts` | **batch eight item 1, and every one DERIVED rather than typed.** Three columns that used to render a uuid now render a name, so a heading saying *identifier* had become false. «شركة التأمين» and «الموظف» are the existing strings with their own first word («معرّف») sliced off; «نوع الجهة المالكة» is `pcOwnerTypeAria`'s text, already in the product. `pcOwnerIdLabel` was WITHDRAWN in both languages rather than left declared-and-unused. |

### NOT-YET-WRITTEN — the product is rendering something else until she supplies these

| what | how many | what renders today | why it is not written |
|---|---|---|---|
| the nine PolicyStatus words | 9 | «قبل الإصدار», a GENERAL phrase | **the limit behind decision 50.** Measured: `PolicyStatus` has nine members (PLACEMENT_CONFIRMED, ISSUED, CHECKING_IN_PROGRESS, DISCREPANCY, VERIFIED, DELIVERED, ACTIVE, CANCELLED, EXPIRED) and NOT ONE has an Arabic label anywhere in the i18n tree. When the policy module writes them, that dashboard takes the EXACT status instead. |
| `/internal-controls`' 9 missing entity words | 9 | the member name AS STORED, beside the record's uuid — and the USER column now carries a NAME | `AccessRecertificationItem`, `CommissionLedgerEntry`, `DataProcessingAgreement`, `DataSharingApproval`, `PolicyChecking`, `Recommendation`, `Refund`, `RetentionScheduleItem`, `Settlement`. Decision 49 says NAME for a closed set, and this set IS closed — by `check:maker-checker-pairs`, not by convention — but only **6 of 15** have a word, so naming it means writing these nine. Register entry 133. |
| `/sla-dashboard`'s 9 missing entity words | 9 | the member name AS STORED, beside the timer's uuid | `AccessDeprovisioningChecklist`, `AccessRecertificationCycle`, `ConsentRecord`, `DataSharingApproval`, `DpiaScreening`, `LegalHold`, `ScreeningMatch`, `ServiceRequest`, `Vendor`. Same shape, same entry: **7 of 16** have a word. A map naming seven and silently rendering a member name for nine is the notification-bell defect, which is why neither screen was half-built. |
| the two Arabic names for the two codes awaiting review | 2 | the lines are live | `AWAITING_OWNER_REVIEW` declares which permission descriptions were written by a coordinator rather than by her — decision 94's pass is hers. |
| the fourteen unsourced retention categories | 14 | no floor, and the row SAYS so | her lawyer's question, not a wording one: a period beside an article number is a legal opinion. |

**NOTHING ELSE IS OUTSTANDING AS COPY.** Every other string this pass touched was either DERIVED from one already shipping (the rule throughout: a slice cannot put a combining mark in the wrong order, which renders identically and compares unequal) or is English, which is written by whoever ships it.
