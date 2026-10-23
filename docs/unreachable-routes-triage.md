# The unreachable routes, classified

**Module 0-ب, screen pass batch three.** Decision 34's fault (3): *every capability a role holds must
have a route to it, and every route must have something that calls it.*

This started as a **REPORT** and is now a **LIVE REGISTER**. Nothing was built, deleted or widened
when it was written, and no budget moved: a classification is not a connection.

**IT IS NOT A SNAPSHOT ANY MORE.** Owner decision 43 (2026-10-23) ruled that the capabilities with no
future module are built now and the four that have one go to their modules. So a row that has since
been WIRED says so, with the commit that wired it, and a row that went to a module names the module —
because a row that got built must stop reading as a gap, and a row somebody else owns must stop
reading as unclaimed work.

**THE BUDGETS MOVE ONLY WHEN SOMETHING IS WIRED, AND THEY HAVE**: `UNREACHED_BY_PATH_BUDGET` 18 → 13
and `UNREACHED_CONTROLLER_BUDGET` 10 → 7 across decision 43's three commits, each lowering it by
exactly what it closed. `MISSING_METHOD_BUDGET` stays 9 — none of the five wired routes was a
by-METHOD row.

| commit | what it wired | by path | by controller |
|---|---|---|---|
| `b08014b` | the retention extension register, and the retrieval bases | 18 → 16 | 10 → 8 |
| `a26b697` | the durable customer-import report (2 routes) | 16 → 14 | 8 → 7 |
| `f0fad7f` | clearing the financial strength rating | 14 → 13 | 7 (unchanged) |

**AND THE FIGURES IN THIS DOCUMENT ARE A FLOOR ON THE REAL GAP, which the third commit found out by
measuring rather than by reading.** Both reachability passes read the path out of a client helper's
OWN DECLARATION, so a helper nothing calls still makes its route look addressed: the count fell 14 → 13
the moment `clearFinancialStrengthRating` was written, before any screen called it. 19 of 337
route-addressing helpers are called by nothing (`scripts/measurements/dead-client-helpers.py`, a
REPORT and not a gate), and `updateInsurer` is the proven case — it addresses `PATCH /insurers/:id`,
nothing calls it, and that route is in NEITHER findings list. Register entry 124.

## The figure is 27, and which 27

**18 unreached BY PATH** (`scripts/measurements/unreachable-routes.py`) plus **9 addressed by path but
not BY METHOD** (`unreachable-routes-by-verb.py`). The two passes use different matchers over the same
web source and are gated separately, which is why their numbers are added rather than merged.

**NOT 29.** Two different 29s exist in these papers and `docs/screen-pass-measurement.md` already warns
about it: fault (3)'s route count was 29 before failure modes 6 and 7 were fixed (it is 27 now), and
fault (1b)'s is 29 *rendered identifiers across 21 screens* — a different fault about different things.
They are kept apart here.

Each of the 27 was read by hand: its controller declaration, its `@RequirePermissions`, its service
method, and what the web actually addresses on that collection. The role sets are measured off
`packages/db/prisma/seed-data/permissions.ts` with a parser verified at **230 of 230** entries — a
first attempt read 203 and silently said nothing about a code that was present, which is why the count
is stated.

## Summary

| class | routes | capabilities |
|---|---|---|
| **MISSING** — a real capability no screen can reach | 13 (5 WIRED, 8 to their modules) | 7 (3 built, 4 deferred) |
| **REDUNDANT** — superseded; the data is already reachable | 14 | — |
| **CORRECTLY ABSENT** — called from outside the web by design | 0 (see below) | — |
| **UNCLASSIFIED** | 0 | — |

**CORRECTLY ABSENT is 0 because that class was excluded before the triage began, not because nobody
looked.** `NOT_WEB_CALLABLE` in the by-path script already holds the five: `GET /`, `GET /health`,
`GET /health/db` (liveness probes), `POST /auth/sso/*/callback` (invoked by the identity provider) and
`GET /orgs/resolve` (subdomain resolution, infrastructure). None of the 27 is of that kind.

**No MISSING row is blocked by a permission nobody holds.** Every code below has at least one seeded
holder, so there is no "a route whose code no plausible caller holds" finding.

## MISSING — 13 routes, 7 capabilities

Each row names the screen that would call it, the code that gates it, and who holds that code. **Every
one of these is the owner's decision to start or leave; none is begun here.**

### 1. The durable customer-import report — 2 routes · **WIRED**

| route | code | holders |
|---|---|---|
| `GET /imports/customers/batches` | `customer.bulk-import` | SYSTEM_SECURITY_ADMINISTRATOR, OFFICE_ADMINISTRATOR |
| `GET /imports/customers/batches/:id` | `customer.bulk-import` | same |

**Screen**: `/settings/customer-import`, which exists and POSTs the file. **ALREADY A RECORDED GAP** —
`CLAUDE.md`'s 2026-10-02 row names it as Phase 2 "DEFECT 2: THE DURABLE REPORT HAS NO SCREEN", so this
triage confirms rather than discovers it. The controller's own comment states the cost: *"an officer who
imports 2,000 rows read its refusals once. These two routes are what make it readable tomorrow, which is
the whole reason `LegacyImportBatch` exists."*

The gate is the same code as the import itself, so whoever may run one may read what theirs did and
nobody else has any use for it — **no permission decision is needed, only a screen.** Of the seven
capabilities here this is the only one whose fix is purely additive to an existing screen.

**WIRED 2026-10-23 — owner decision 43, AND IT WAS NOT PURELY ADDITIVE AFTER ALL.** That sentence
above was written about the ROUTES and it is wrong about the SCREEN, which is worth correcting rather
than quietly working around: `/settings/customer-import` **threw during render on every successful
import** and had done since Phase 2, the other half of the 2026-10-02 row (*"DEFECT 1: THE IMPORT
SCREEN CRASHES AFTER A SUCCESSFUL IMPORT"*). Item 1 replaced the api's `rejections` and `failures`
with one `issues` list plus `refusedDuplicates` and `batchId`; the web read `result.rejections.length
+ result.failures.length`, both `undefined`. So the rows went into the book and the panel reporting on
them died. **Fixing that is a PRECONDITION of this row, not scope creep** — a register cannot be added
to a screen whose main path throws, and the batch detail returns the same `issues` shape anyway.

**THREE THINGS FAILED TO SEE IT AND EACH FAILURE IS A GENERAL ONE.** TypeScript cannot check an
interface a screen declares by hand over an HTTP response. The Playwright fixture SUPPLIED THE OLD
FIELDS ITSELF, so the suite was green against a shape the server had stopped sending — no assertion
added to that spec would have helped, because a mocked endpoint cannot drop a field the api dropped.
And the api e2e asserted the response it got, which was correct; both sides were right about
themselves.

**SO THE INSTRUMENT IS `packages/db/prisma/legacy-import-shape-parity.spec.ts`**, which reads BOTH
declarations as text and is the only place that can see them together — the remedy `CLAUDE.md` named
on 2026-10-02 (*"a third parity guard over the import's response shape, not a patch to line 221"*),
and the fourth such guard now. It covers `LegacyImportResult`/`LegacyImportIssueView` only: the two
BATCH routes return raw Prisma rows with no declared api view, so there is nothing to compare, and
that direction is held by the api e2e's key-set assertions and by nothing here.

**AND CORRECTING THE CLIENT MADE THE OLD READ UNREPRESENTABLE RATHER THAN MERELY WRONG** — planted,
the build fails with `error TS2339: Property 'rejections' does not exist on type 'ImportResult'` and
Playwright cannot start at all. **TWO WORDS ARE OWED**: there is no Arabic anywhere in the i18n tree
for *duplicate*, so `DUPLICATE` and `BAD_DATA` render their MEMBER NAME while
`IMPORTED_NEEDS_REVIEW` has a derived word. Register entry 123.

### 2. The GLOBAL insurer form-template catalogue — 3 routes · **TO THE INSURANCE-COMPANY MODULE**

| route | code | holders |
|---|---|---|
| `GET /insurer-masters/:id/form-templates` | `insurer.master.read` | SALES, PLACEMENT, MANAGER, EXECUTIVE, EXTERNAL_AUDITOR |
| `GET /insurer-masters/:id/form-templates/current` | `insurer.master.read` | same |
| `POST /insurer-masters/:id/form-templates` | `insurer.form.map` | PLACEMENT, SYSTEM_SECURITY_ADMINISTRATOR |

**Screen**: none. The web client (`lib/insurer/insurer-master-api.ts`) has exactly one function,
`listInsurerMasters`, and no form-template function at all.

`currentForm` answers *which version do I submit against for this line*, and its own comment records
that `null` is a real answer rather than a 404 — nobody has mapped this insurer and line yet. The WRITE
is the platform-wide one, and the grid's reason for withholding `insurer.form.map` from the office
administrator is that **the mapping becomes the form every other office submits against.** So a screen
for this is a decision about who edits a shared catalogue, not a missing button.

**DEFERRED TO THE INSURANCE-COMPANY MODULE — owner decision 43, 2026-10-23, register entry 118.** Her
rule was that what has no future module is built now and what has one waits for it, and this has one.
The reason it waits rather than being three more buttons is the sentence above: the write is
platform-wide, so the screen is a decision about a shared catalogue. **Recorded WITH THE MODULE NAMED
so it is not rediscovered as a new finding** — that is the whole point of naming it.

### 3. This office's OWN insurer form mappings — Q9 — 3 routes · **TO PLACEMENT & QUOTING**

| route | code | holders |
|---|---|---|
| `GET /insurers/:id/form-templates` | `insurer.read` | SALES, PLACEMENT, MANAGER, EXECUTIVE, COMPLIANCE, EXTERNAL_AUDITOR, OFFICE_ADMINISTRATOR |
| `GET /insurers/:id/form-templates/resolved` | `insurer.read` | same |
| `POST /insurers/:id/form-templates` | `insurer.office-form.map` | PLACEMENT, SYSTEM_SECURITY_ADMINISTRATOR, OFFICE_ADMINISTRATOR |

**Screen**: none. `/insurers/[id]` exists and mentions neither.

**This is the largest single gap in the 27.** `GET …/resolved` is the route that answers *which form do
I submit against*, naming its `source` — OFFICE beats SHARED, and an override is never an edit. The
whole Q9 feature, including the second model built so an office could map a local company's form,
reaches no reader. Its own controller explains why the write has its own code rather than reusing the
global one: folding them together *"would force a choice between denying an administrator their own
office's forms and granting them a platform-wide write."* That argument is live and unexercised.

**DEFERRED TO PLACEMENT & QUOTING — owner decision 43, 2026-10-23, register entry 119.** The owner's
own words on it: *«on which form do I submit?» is a daily broker question whose answer is built and
reaches nobody.* It belongs there because that is WHERE THE QUESTION IS ASKED — at the moment an
officer submits to an insurer, not on a settings screen — and it is the largest of the four
deferrals rather than the smallest.

### 4. Linking an insurer record to a registered insurance company — 2 routes · **TO THE GATEWAY / COMPANY REGISTRY**

| route | code | holders |
|---|---|---|
| `POST /insurers/:id/company-link` | `insurer.company.link` | PLACEMENT, SYSTEM_SECURITY_ADMINISTRATOR, OFFICE_ADMINISTRATOR |
| `DELETE /insurers/:id/company-link` | `insurer.company.unlink` | SYSTEM_SECURITY_ADMINISTRATOR, OFFICE_ADMINISTRATOR |

**Screen**: none. Module 0-ب decision 63 built the link and the asymmetric pair of codes — *"linking
narrows what this office may edit, while unlinking returns a company's published details to being
whatever the office last typed"* — and `/insurers/[id]` can neither create nor remove one.

**The consequence is visible on a screen that already works.** The insurer detail page renders company
facts in their own headed section and the server refuses an office's edit to a LINKED record with a 422
naming the fields. That refusal is reachable; the state that produces it is not, except by a seed or a
migration. Two codes exist, are granted, and gate nothing a person can do.

**DEFERRED TO THE GATEWAY / COMPANY REGISTRY — owner decision 43, 2026-10-23, register entry 120.**
A link is an assertion that this office's insurer record and a REGISTERED COMPANY are the same party,
which is the registry's question rather than this screen's.

### 5. Clearing the financial strength rating — 1 route · **WIRED**

| route | code | holders |
|---|---|---|
| `DELETE /insurers/:id/financial-strength-rating` | `insurer.update` | OFFICE_ADMINISTRATOR |

**Screen**: `/insurers/[id]` **renders the rating** (`insDetailRatingLabel`, line 232) and offers no way
to clear it. Decision 93's whole point is that the rating and its as-of date are cleared TOGETHER — a
rating with a stale date is a judgement about an insurer's solvency attributed to a month that has
passed. The narrowest row here and the cheapest to close: one control on a screen that already shows
the value, on a code one role already holds, with no new code (deliberately — the controller records
that *"a code per action would be a checkbox on the Role screen for something nobody administers
separately"*).

**WIRED 2026-10-23 — owner decision 43. One button, no new code, and no confirmation step**: the act
is a correction rather than a disposal, and the audit row carries BOTH halves of what was there as
`beforeValue`, so the old rating is recoverable by a person reading the trail. It renders only where
there is something to clear and the reader holds `insurer.update`, which also keeps the api's own
no-op branch unreachable from the screen rather than merely harmless.

**AND BUILDING IT FOUND THAT THE SCREEN WAS DROPPING THE AS-OF DATE.** `financialStrengthRatingAsOf`
has always been on the wire; the screen's hand-copied interface did not declare it, so this office's
own judgement about an insurer's solvency rendered with no date on it — which is the exact state
decision 93 exists to prevent, one layer above the clear. It renders now, with wording derived from
`dcmpScanAsOf`'s shape and `dashAsOf`'s words.

**WHAT IS NOT CLOSED, AND IS THE ADJACENT GAP**: no screen SETS a rating either. Measured —
`updateInsurer` has no caller anywhere in `apps/web`, so `PATCH /insurers/:id` is reachable by nothing
a person can click, and clearing a rating cannot be undone from the product. **IT IS IN NEITHER
FINDINGS LIST**, which is a defect in the instruments rather than in the triage: both passes read the
path out of a client helper's own declaration, so a helper nothing calls still makes its route look
addressed. 19 of 337 route-addressing helpers are called by nothing —
`scripts/measurements/dead-client-helpers.py`, which is a REPORT and not a gate, and every row of
which needs reading by hand. **So the figures in this document are a FLOOR on the real gap.**

### 6. What each archive-retrieval basis MEANS — 1 route · **STRUCTURAL HALF WIRED, WORDING HALF WITH THE OWNER**

| route | code | holders |
|---|---|---|
| `GET /retention-archive/bases` | `retention.archive.retrieve` | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |

**Screen**: `/retention-disposal` exists, offers the retrieval, and **carries its own copy of the basis
vocabulary** — `useState<ArchiveRetrievalBasis>('JUDICIAL_REQUEST')` with its two options from the i18n
dictionary. The controller's comment says this route exists so *"the screen renders them rather than
restating them"*, and the screen restates them.

**The narrowest MISSING row, and precisely stateable**: the basis NAMES do reach the reader; the
MEANINGS do not. `ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS` carries *"A request from a court or a judicial
authority. Record which authority asked, and for what"* and *"An official audit by the Central Bank of
Jordan. Record the audit it belongs to"* — instructions about what to put in the free-text field beside
the basis, which nobody sees. The second-copy problem is the other half: two homes for a closed
two-value vocabulary, and the route is the one that was meant to win.

**WIRED 2026-10-23 — owner decision 43, and it SPLIT in half.** The owner's ruling was that this row
is in scope by her own rule (no future module owns it, and it lives on the same screen as row 7), and
that the two halves go separately.

**THE STRUCTURAL HALF IS DONE.** `/retention-disposal` reads which bases exist from the route and no
longer carries a copy of the closed two: the `<option>`s are built from the response and the Arabic
labels stay in i18n keyed by member, so a third basis added server-side appears without a web change
and renders its own member name until somebody decides its word — the same decision the eighteen
workflow-entity labels made for a member with no word, and the opposite of `t(undefined)`, which
renders nothing at all. A Playwright test offers a third basis from the mock and proves it is both
offered and selectable. **It also fixed a live mislabelling nobody had reported**: the retrieval
register's own table decided the basis with a ternary on one member, so ANY basis other than
`JUDICIAL_REQUEST` rendered the Central Bank audit label — a third basis would have been recorded on
screen as an audit that never happened. One lookup now serves the form and the table.

**THE WORDING HALF IS THE OWNER'S AND IS NOT BUILT.** The meanings exist in ENGLISH ONLY, there is
nothing in the i18n tree to derive Arabic from, and shipping an English sentence into an Arabic screen
as a placeholder is worse than the gap. Two sentences she writes; the client declares the `meaning`
field already, so nothing has to change on the web when they arrive. Register entry 122.

### 7. The retention EXTENSION register — 1 route · **WIRED**

| route | code | holders |
|---|---|---|
| `GET /retention-notices/register` | ANY OF `retention.extend`, `retention.dispose.nominate`, `retention.dispose.approve` | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER, BRANCH_DEPARTMENT_MANAGER |

**Screen**: `/retention-disposal` calls `GET /retention-notices` (the elapsed-record notices) and
`POST /retention-notices/extend`, and not this.

**It is NOT the same list as the notice list, which is why this is MISSING and not REDUNDANT.**
`register()` returns one row per `RetentionExtension` — the record id, the basis, the note, the
legislative instrument and article, and the legal hold it cites. The notice list returns records whose
period has ELAPSED. An extended record leaves the notice list by design; this register is the only place
the extension itself is readable.

That matters more than its size: batch 5 group 7's own rule is that **an extension is a decision, not an
exit**, and *"the register must name WHICH"* records were extended. The write path records all of it
faithfully. Nothing reads it back.

**WIRED 2026-10-23 — owner decision 43, her explicit «ماشي», and the one row of the 27 that was a hole
in something already declared CLOSED.** `/retention-disposal` now carries a register section gated on
the notice's own any-of, showing the category, the date the extended clock elapses, the basis as a
word, the office's own statement, the instrument and article, the HOLD'S SCOPE AND REASON rather than
its id, who extended it and when.

**ONE API CHANGE WENT WITH IT**: the view resolves `extendedByName`, because the only thing it could
otherwise say about the actor is a uuid — which rule 2 refuses to render and which identifies nobody.
The sibling retrieval register already resolved its actor the same way.

**AND THE OWNER'S OWN REQUIREMENT IS MET EXCEPT IN ONE RESPECT, WHICH IS REPORTED RATHER THAN
SMOOTHED OVER**: *the register must name WHICH records were extended*, and the screen does NOT render
the record id. Measured for the retrieval register next door and unchanged here — of the four
blockable models only `Receipt.reference` and `CommissionLedgerEntry.paymentReference` carry anything
a person could recognise, and `Remittance` and `Settlement` carry nothing — so there is no readable
handle to show, inventing one is the display fix rule 2 refuses, and rendering the uuid would raise
the rendered-identifier budget, which this batch was forbidden to do. The id is in the response and in
each row's own `data-extension-for`, so the accountability is intact; the missing piece is a handle
for the person reading it, which is register entry 94's deferred family.

### 8. The `Endorsement` and `Invoice` inbound links — not routes · **TO WHICHEVER MODULE BUILDS THOSE SCREENS**

Not part of the 27 and recorded here because it is the fourth of owner decision 43's deferrals, and
three of the four being in this document while the fourth sat in a word-derivation entry is how one
gets missed. **TWO, NOT THREE** — `KYCRecord` already has its link, in
`apps/web/components/customer/KycQueue.tsx`, which is why a measurement of `WorkflowHistoryLink`
rooted at `app/(app)` reads 15 of 16 and makes that type look unlinked. `Endorsement` and `Invoice`
owe one because neither has a screen; the module that builds either adds the link in the same commit.
Register entries 114 and 121.

## REDUNDANT — 14 routes

Every one is a `GET /collection/:id` (or `/:id/status`) whose **LIST is called by the web and returns
the same view**, derived through the same function. In each case the detail handler adds no field. The
nine by-METHOD rows are additionally confirmed: the web addresses each of those paths with a WRITE verb
(`apiPatch` or `apiPost`), which is why the GET reads as unaddressed by method.

| route | its called list | why redundant |
|---|---|---|
| `GET /client-decisions/:id` | `GET /client-decisions` | both return `ClientDecisionView` via `viewFromContext` |
| `GET /feedback/:id` | `GET /feedback` | both via `deriveFeedbackView` |
| `GET /insurer-masters/:id` | `GET /insurer-masters` | both via `deriveMasterView` |
| `GET /cross-border-transfers/:id` | `GET /cross-border-transfers` | both via `deriveCrossBorderTransferView` |
| `GET /sla/timers/:id/status` | the SLA dashboard list row | returns exactly the fields that row now carries |
| `GET /commission/entries/:id` | `GET /commission/entries` | same `ledger` view, same `financial-report.view` gate; path addressed by `POST …/override`, `…/override/approve`, `…/settle` |
| `GET /transaction-monitoring-alerts/:id` | `GET /transaction-monitoring-alerts` | both via `deriveTransactionMonitoringAlertView`; **both audit the read**, so the detail's audit row is not a distinct property; path addressed by `POST …/close`, `…/escalate`, `…/report-to-authority` |
| `GET /retention-cases/:id` | `GET /retention-cases` | both via `deriveRetentionCaseView`; path addressed by `POST …/close` |
| `GET /reconciliation-exceptions/:id` | `GET /reconciliation-exceptions` | both via `deriveReconExceptionView`; path addressed by `POST …/investigate`, `…/resolve` |
| `GET /sales-targets/:id` | `GET /sales-targets` | both via `deriveSalesTargetView`; path addressed by `apiPatch` |
| `GET /retention-schedule/:id` | `GET /retention-schedule` | both via `deriveRetentionScheduleItemView`; path addressed by `apiPatch` and `POST …/confirm` |
| `GET /information-assets/:id` | `GET /information-assets` | both return the raw `InformationAsset`; path addressed by `apiPatch` |
| `GET /knowledge-base-articles/:id` | `GET /knowledge-base-articles` | both return the raw `KnowledgeBaseArticle`; path addressed by `apiPatch` |
| `GET /employees/:id/cbj-approval` | `GET /employees/:id` | **the strongest of the fourteen**: the employee detail calls `this.cbjApprovals.get(id)` and embeds its output as `cbjApproval`, so the standalone route returns a strict subset of a response the screen already reads. The web `apiPatch`es this exact path to SET the approval |

### Two nuances recorded rather than smoothed over

**`GET /client-decisions/:id` is the one row where "redundant" needs a qualifier.** Its list refuses
unless exactly one of `opportunityId` or `customerId` is supplied, so the list genuinely cannot answer
*"show me the decision with this id"*. The detail route is the only thing that can. It is still
REDUNDANT because **nothing in this product holds a bare client-decision id**: `ClientDecision` is not
one of the eighteen `WorkflowEntityType` members, so it never appears as a workflow-history subject, and
every screen reaches a decision through its opportunity. If a surface ever surfaces a bare decision id,
this row becomes MISSING without the route changing.

**REDUNDANT here means "the data is reachable", not "delete the route".** Nothing is deleted in this
batch, and a detail route is the conventional shape of a REST collection — removing fourteen of them is
a separate decision with its own cost, and this report does not propose it.

## The matcher's own blindness — all 18 unreadable calls accounted for

The by-path pass now prints `unreadable calls`, the count of client calls whose first argument it cannot
read even after one level of helper resolution. **It is 18, and none of the 27 depends on any of them**
— which is the question that mattered, because a route addressed only by an unreadable call would be a
false positive in this list.

Enumerated with the gate's own resolver:

* **14 are in `apps/web/lib/auth/api-client.ts`** — the DECLARATIONS of `apiFetch`, `apiGet`, `apiPost`,
  `apiPatch`, `apiPut`, `apiDelete`, `apiPostFormData` and `apiFetchBlob`. Their first argument is the
  `path: string` PARAMETER, so there is nothing to read and they address no route. Unreadable by nature,
  not by defect.
* **4 are the matcher hitting ENGLISH PROSE.** The `CALL` pattern's `request` alternative is **not
  word-bounded**, so it matches the word "request(" inside a comment or a permission description —
  `lib/i18n/translations/permissions.ts` twice (*"Log a service request (certificate/copy/change)"*),
  and a header comment in `service-request-api.ts` and `data-sharing-approval-api.ts`.

**That fourth bullet is an instrument defect and is reported, not fixed** — the same class as the
recorded guard whose `ttl` alternation matched the word *settling* and is word-bounded now. Word-bounding
`request` would take the counter 18 → 14 and **move no route count**, which is not a guess: all four are
in the unreadable set, and a call is only in that set when `first_arg_paths` found no `/`-leading literal
in it, so they contribute zero web paths. It is owed to whoever is next in that script; it does not
belong in a batch that was told to report.

## How to re-derive all of this

```
python scripts/measurements/unreachable-routes.py            # the 18, plus `unreadable calls`
python scripts/measurements/unreachable-routes-by-verb.py     # the 9
```

The role sets come from `packages/db/prisma/seed-data/permissions.ts`. **Verify any parser of that file
against 230 entries before trusting a silence from it** — a 203-entry parse says nothing about the 27
codes it never read, and that has now happened twice in this module, once on each side.
