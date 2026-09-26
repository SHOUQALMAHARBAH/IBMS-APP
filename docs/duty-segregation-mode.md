# Duty segregation as a declared per-office MODE — the plan

**Nothing here is built.** This is Part 4 of the owner's permissions work, planned before any code
because it is the only change in the programme that makes a control *weaker* on purpose, and the
difference between "conditional" and "gone" is a design decision rather than an implementation detail.

The owner's instruction, restated as the five rules this design has to satisfy:

1. **Do NOT remove the DB CHECK constraints.** Make them conditional, still database-enforced.
2. **The permission check does not relax.** COMBINED mode changes who may be the same person, never what
   they are allowed to do.
3. **Record the hat.** The system does not know which role granted the permission an actor used, so
   record the subset of the actor's roles that grant the code, and flag it when more than one does.
4. **Nothing silent.** Not the refusal, not the act, not the mode change.
5. **Apply uniformly to all the pairs.**

---

## THE SHIPPING GATE

**COMBINED mode may not ship before the self-approval report exists and works.**

Not a task in the list below — a gate on the whole mode. The reason is a commitment, not a preference: the
owner accepted uniform application, INCLUDING a person reviewing their own access, on the stated mitigation
that every such act would surface in the self-approval report, flagged at the top. That mitigation was
offered against a report which, measured, **has no reader**: `segregationSignal()` writes a
`logger.error`/`logger.warn` line and an audit row, and there is no endpoint and no screen in any form.

So a control was weakened on the strength of a report nobody can open. Shipping the mode without the report
would leave exactly that state, and the mode is not shippable until it is closed.

### What the report is

An endpoint and a screen, reachable by holders of `internal-controls.view`, listing declared
combined-duty acts. Each row carries:

  - the actor, by name, and the timestamp
  - which PAIR it was, named by the constraint so a rename cannot blur it
  - the roles worn — the granting subset, and the multi-grant flag when it is ambiguous
  - the office's mode, and the date the mode was declared

### Its first ordering rule

**Access-recertification self-reviews are flagged and sit at the top.** Not sorted in among the others by
date. Every other self-approval concerns a transaction; this one concerns the permissions themselves.

And the warning that belongs beside it, because it is the shape this exact requirement fails in: "flag it
at the top" is NOT satisfied by logging at a higher level. The row has to be at the top of a list a person
opens.

### How it is proven

By content, not by a status code: the report shows a REAL declared act, and a self-recertification appears
ABOVE a self-approved refund, with both present. A test that only asserts the endpoint returns 200, or that
one row exists, would pass against a report that cannot order itself.

---

## What is actually there today — measured, not assumed

Three different answers to "how many maker/checker pairs are there", all live in the repository at once:

| Source | Count | What it is |
|---|---|---|
| The database | **15 CHECK constraints across 14 tables** | what actually refuses a self-approval |
| `checker-roles.config.ts` | **13 checker permissions** | what the detective control watches |
| `maker-checker.util.ts`'s header table | **11 pairs** | what a developer reads |

The 15 constraints, read out of `pg_constraint` rather than off the schema:

```
AccessRecertificationItem_maker_checker_distinct       reviewerUserId <> subjectUserId
CommissionLedgerEntry_maker_checker_distinct           overrideApprovedByUserId <> overrideRequestedByUserId
Complaint_closure_maker_checker_distinct               closureApprovedByUserId <> resolvedByUserId
DataProcessingAgreement_maker_checker_distinct         dpoApprovedByUserId <> assessedByUserId
DataSharingApproval_maker_checker_distinct             approvedByUserId <> requestedByUserId
DataSubjectRequest_closure_maker_checker_distinct      closedByUserId <> processedByUserId
DisposalBatch_maker_checker_distinct                   dpoApprovedByUserId <> nominatedByUserId
IncidentReport_classification_maker_checker_distinct   seniorManagementCoSignUserId <> classifiedByDpoUserId
KYCRecord_maker_checker_distinct                       approvedByUserId <> createdByUserId
NeedsAssessment_approver_maker_checker_distinct         approvedByUserId <> createdByUserId
NeedsAssessment_reviewer_maker_checker_distinct         reviewedByUserId <> createdByUserId
PolicyChecking_maker_checker_distinct                  checkedByUserId <> placedByUserId
Recommendation_maker_checker_distinct                  approvedByUserId <> draftedByUserId
Refund_maker_checker_distinct                          approvedByUserId <> raisedByUserId
Settlement_maker_checker_distinct                      secondApproverUserId <> approvedByUserId
```

**The denominator matters**, because rule 5 says "uniformly across all the pairs" and the three sources
disagree about what "all" means. This plan uses **15**, because that is the set the database enforces and
therefore the set a mode has to reach. Bringing the other two lists up to 15 is part of the work, not a
tidy-up afterwards: a developer reading an 11-row table will miss four pairs.

Two structural facts that shape the design:

- **Fourteen of the fifteen are NULL-guarded** — `(maker IS NULL) OR (checker IS NULL) OR (maker <> checker)`
  — so "not yet decided" is not a violation. `AccessRecertificationItem` is the exception: both columns are
  NOT NULL and the constraint is unconditional.
- **All 14 tables carry `organizationId`.** Whatever mechanism reads the office's mode can find the office.

### The prior art, and it is a column nothing reads

`Organization.dpoAlternateApproverUserId` already exists, with this comment:

> Spec §10.5 — OPTIONAL edge-case fallback only. […] This exists solely for an office small enough that
> one person holds both titles, and names whoever approves in their place.

That is Part 4's problem, recognised once, solved for one pair — and **nothing anywhere reads it**: six
references in the repository, all of them the declaration, its migration, a null-setting test fixture, a
README note and this plan. So the current answer to "this office has one person" is a dormant column, and
it is now marked SUPERSEDED — see the decision below.

### The machinery Rule 3 does not have to invent

`segregationSignal()` in `checker-roles.config.ts` already takes roles-with-their-permissions and returns
which of them carry a checker permission. Rule 3 is the same shape at a different moment: provisioning
time today, act time under this plan. The piece that is genuinely missing is a read —
`PermissionRepository.findCodesForRoles` deliberately returns a FLATTENED set, so role provenance is
erased by the time authorization has an answer.

---

## The design

### 1. The mode

`Organization.dutySegregationMode` — a new enum, `SEGREGATED | COMBINED`, **NOT NULL, default
SEGREGATED**. Every existing office is SEGREGATED by the migration's default, so nothing changes for
anybody until an office declares otherwise. A new enum rather than a boolean because the owner's framing
is a declared mode, and because a third value (a per-pair mode, say) must be addable without rewriting
every reader of a boolean.

### 2. How a CHECK becomes conditional WITHOUT leaving the database

A CHECK constraint can only see its own row. The mode lives on another table. Three ways out were
considered and two are rejected for stated reasons:

**Rejected — denormalise the mode onto all 14 tables** with a composite FK
`(organizationId, dutySegregationMode)` → `Organization(id, dutySegregationMode)` and `ON UPDATE CASCADE`,
the same trick `RolePermission.organizationId` uses to make drift unINSERTable. It fails on mode
*tightening*: switching COMBINED → SEGREGATED cascades an UPDATE to every row in 14 tables, which
re-validates the CHECK, which **fails on every historical combined-duty row**. An office could enter the
mode and never leave it. It also writes today's setting onto rows from last year.

**Rejected — replace the 15 CHECKs with 15 triggers** that read the office's mode. It works, and it is
what a trigger is for, but it deletes the fifteen constraints the owner said to keep, spends a per-write
lookup on the fourteen busiest tables in the system, and puts fifteen new objects in the class
`db:divergence` cannot see.

**Chosen — the escape is a COLUMN ON THE ROW, and the mode gates who may fill it.**

- Each of the 15 constraints gains **its own** nullable `combinedDutyActId` column. One per CONSTRAINT,
  not per table: `NeedsAssessment` has two pairs, and a single shared column would let a declared combined
  *review* silently excuse a self-*approval*.
- Each CHECK is recreated with one more disjunct:
  `(maker IS NULL) OR (checker IS NULL) OR (maker <> checker) OR (combinedDutyActId IS NOT NULL)`.
  Same name, same table, same column pair, still a CHECK, still in the database. A self-approval that does
  not declare itself is refused exactly as it is today.
- `combinedDutyActId` is a foreign key to a new table, **`CombinedDutyAct`** — one row per combined act,
  carrying the evidence (below).
- **One trigger, on `CombinedDutyAct` only**: `BEFORE INSERT`, raise unless that row's office is in
  COMBINED mode. The fourteen hot tables keep plain constraints and gain no trigger; there is exactly one
  place where the mode is read, and one object for the divergence blind spot to be told about.

What this buys, stated plainly: the database refuses a silent self-approval (the CHECK), **and** refuses a
declared one in a SEGREGATED office (the trigger). Removing every line of application code cannot produce
either. Mode changes are one `UPDATE` on `Organization`, do not touch history, and can go in both
directions.

### 3. `CombinedDutyAct` — where "nothing silent" lives

One row per act, created in the same transaction as the write it excuses:

| Column | Why |
|---|---|
| `organizationId` | the office whose mode permits this; what the trigger reads |
| `entity`, `entityId` | which record — e.g. `Refund`, `<uuid>` |
| `constraintName` | which of the 15 pairs, named by the constraint it excuses, so the two can never drift |
| `actorUserId` | the one person who did both halves |
| `reason` | **NOT NULL**, minimum length enforced like the national-ID reveal justification |
| `actedAt` | when |
| `actorRoleIds` | every role the actor held at that moment |
| `grantingRoleIds` / `grantingRoleNames` | **the hat** — the subset that grant the checker permission used |
| `multipleGrantingRoles` | true when the subset has more than one member |

`grantingRoleNames` is stored beside the ids for the reason the audit row already stores
`actorRoleNames`: a role renamed or retired years later is unrecoverable from an id alone.

### 4. Rule 3, and its cost, visibly

To record the hat, the service must answer "which of this actor's roles grant the checker code for this
pair" — which authorization cannot answer, because it flattens. The pieces:

- Each of the 15 pairs is mapped to its checker permission. Thirteen of these mappings already exist in
  `checker-roles.config.ts`; the two `NeedsAssessment` pairs are the ones that list does not cover, and
  both use `needs-assessment.approve`.
- A new repository read returns, for a set of role ids and one code, the subset that grant it.
  `PermissionsService.getCodesForRoles` is already cached per process, so this is N cached lookups where N
  is the actor's role count — **and it runs only on the combined path**, so a SEGREGATED office pays
  nothing.
- `multipleGrantingRoles` exists because the honest answer is sometimes "we cannot tell". Two roles
  granting the same code means the hat is genuinely ambiguous, and the record says so rather than picking
  one and looking certain.

### 5. What COMBINED mode does NOT change

- **Permissions.** The actor must hold the maker's permission and the checker's. A one-person office gives
  one role both codes — which is exactly the state `segregationSignal` already detects at provisioning
  time. The mode makes that state legitimate and recorded; it does not grant anything.
- **Workflow states, SLA timers, audit.** A combined act writes the same rows, in the same order, and
  additionally its own.
- **The detective control.** `segregationSignal` keeps firing. In a COMBINED office it stops being a
  warning about a misconfiguration and becomes a description of a declared arrangement — which is a
  message change, not a logic change.

### 6. Rule 4 — the three places nothing may be silent

- **The refusal, in SEGREGATED mode.** Today: "the checker must be a different user than the maker
  (maker/checker segregation of duties — Part 5.2)". It must also say that this office is in SEGREGATED
  mode and where that is changed — which is Part 5's second honesty fix, and this is the sentence it was
  about.
- **The act.** `CombinedDutyAct` plus the ordinary audit row. The record screen shows, on the record
  itself, that both halves were performed by one person under a declared mode — not only in an export.
- **The mode change.** Switching mode is itself an audited act with a reason. A regulator asking "when did
  this office stop segregating duties, and who decided" must get an answer from the audit trail.

---

## Rollout order

Each step ships whole and is verifiable on its own.

**Status: steps 1–5 have SHIPPED. The mode is now SETTABLE — and COMBINED is refused in code until the report
exists.** That refusal is the shipping gate made real rather than promised: `SELF_APPROVAL_REPORT_EXISTS` is
`false` in `duty-segregation-mode.service.ts`, declaring COMBINED returns 403 with the reason, and an e2e test
asserts it. **The flag, the refusal and that test are deleted in ONE commit when step 6 ships** — together, or
the gate was theatre.

So an office can declare SEGREGATED explicitly today (which is a real act: "segregated because nobody ever
chose" and "segregated because the administrator confirmed it on this date" are different facts, and the report
needs the second), and cannot declare COMBINED at all.

**One pair is deliberately NOT wired**: `AccessRecertificationItem`, because its constraint fires on an INSERT
rather than an update, so wiring it changes nothing for the single-operator office the owner's condition is
about. That is a decision, not a task — see the section below and `docs/decision-reviewing-your-own-access.md`,
which puts the three options to her in plain language.

1. **[DONE]** **Bring the three lists to 15.** `maker-checker.util.ts`'s table (11 → 15), the pair→checker-permission
   map, and a test that derives the expected set from `pg_constraint` so a sixteenth constraint cannot be
   added without the lists moving. This is worth doing first because everything after it is per-pair work,
   and doing it against a wrong denominator means doing it twice.
2. **[DONE — migration `20261028100000`]** **Schema.** The enum, `Organization.dutySegregationMode` plus
   `dutySegregationModeDeclaredAt`/`DeclaredByUserId` (the report needs the declaration date beside every
   act, and deriving it from audit rows on every read is a derivation that breaks when the audit row's shape
   changes), `CombinedDutyAct`, the 15 escape columns, the 15 CHECK replacements, the one trigger. Applied to
   both databases and `migrate resolve`d; `db:divergence` 20/20 on both, which is what proves the schema
   declaration matches — including `onDelete: Restrict` on all 15 relations, since Prisma's default for an
   optional relation is `SetNull` and that is exactly the divergence class this repo has been bitten by.

   **The predicates were generated from the database's own `pg_get_constraintdef` output, not from a
   template.** The 15 do not share a shape: `DataSharingApproval` guards only the checker side for NULL,
   `AccessRecertificationItem` guards neither, the rest guard both. Re-deriving them is how one of the
   fifteen comes back looser than it went in.

   **The escape column names, derived from the constraint name** so a reader can go either way:

       AccessRecertificationItem   combinedDutyActId
       CommissionLedgerEntry       combinedDutyActId
       Complaint                   closureCombinedDutyActId
       DataProcessingAgreement     combinedDutyActId
       DataSharingApproval         combinedDutyActId
       DataSubjectRequest          closureCombinedDutyActId
       DisposalBatch               combinedDutyActId
       IncidentReport              classificationCombinedDutyActId
       KYCRecord                   combinedDutyActId
       NeedsAssessment             approverCombinedDutyActId
       NeedsAssessment             reviewerCombinedDutyActId
       PolicyChecking              combinedDutyActId
       Recommendation              combinedDutyActId
       Refund                      combinedDutyActId
       Settlement                  combinedDutyActId

   The migration's own `DO` block asserts, per constraint, that it still exists, is still a CHECK, still
   names BOTH of its original columns, and now admits its own escape column — plus that there are exactly 15
   escape columns, that the trigger exists, and that every office reads SEGREGATED. The both-columns half is
   the one that matters: a predicate loosened to `TRUE OR (escape IS NOT NULL)` would satisfy a check that
   only looked for the escape column and would refuse nothing. Run against the un-migrated database first,
   where it failed naming the real predicate.
3. **[DONE — 15 of the 19 call sites route through the engine; 1 blocked on a decision; 3 are
   application-only]** **The application layer.**

   `assertDifferentActors` stayed a pure function and is still the refusal. What gained the mode is a new
   `DutySegregationService.resolve()`, which returns the escape-column value the caller's write must carry:
   `null` for every ordinary two-person act, an act id for a declared combined one.

   **Why a service shared across modules, when this codebase shares repositories and never services.** There
   is one established exception and this follows it exactly: `WorkflowTransitionService`, an ENGINE that
   fifteen modules import from its own `@Global()` module because every status change must pass through one
   implementation. Nineteen call sites in fourteen modules record a checker decision, and "may one person do
   both halves, and what must be recorded if they do" has to have one answer. It is not a domain service — it
   knows nothing about refunds or claims.

   **The ordinary path costs nothing.** Two different people, or no checker yet, returns before any database
   read. A SEGREGATED office pays nothing for the existence of the mode, which is the constraint that ruled
   out reading the mode inside fifteen triggers, and there is a unit test asserting the office is NOT read on
   that path — a cost assertion, not a style one.

   **The act is written BEFORE the caller's write and is not rolled back if that write loses a race.** The
   escape column is a foreign key, so the act must exist first. If the caller's status-conditional update then
   matches zero rows, the act remains and the report shows a declared act against a record whose approval did
   not land. Deliberate: the alternatives are making the evidence table mutable or threading a transaction
   client through nineteen repositories, and over-recording a control event beats under-recording one.

   **THE ACTOR IS A USER ID, NOT A SESSION OBJECT.** Most of the nineteen call sites take a bare
   `actorUserId` (`KYCRecord.decide`, `Complaint.close`, `DataSharingApproval.approve`, …), and threading an
   `AuthenticatedUser` down to all of them would have meant changing seventeen service signatures plus every
   controller and test that calls them — a large diff carrying two fields the engine can read for itself. It
   also reads more truthfully: the office and the roles are resolved from the database at the moment the act is
   recorded, through the same `getRoleRefs` the session is built from, so a role revoked earlier in the same
   request cannot be recorded as the hat.

   **Every route takes an OPTIONAL `combinedDutyReason`**, from one shared
   `CombinedDutyDeclarationDto` that the module's existing body DTO extends. Optional is the point: an ordinary
   two-person approval sends nothing and behaves exactly as before, and a DTO cannot see the office's mode, so
   the requirement is decided in the service.

   **THREE APPLICATION-ONLY PAIRS, not the two the plan recorded.** The third was found while wiring:

       PolicyChecking.check (issuing officer)   the DB constraint compares the checker with the PLACER only
       ConflictOfInterestDisclosure.acknowledge no constraint covers this pair at all
       NeedsAssessment.reject                   rejecting writes NO approver, so the constraint's first
                                                disjunct (`approvedByUserId IS NULL`) is always satisfied

   `NeedsAssessment.reject` still goes through the engine and its returned id is DISCARDED: in a COMBINED
   office the act is recorded and appears in the report, and there is no column to carry it because the
   database is not enforcing that pair. Leaving it strict would have dead-ended a one-person office on
   rejection — she could neither approve nor reject an assessment she captured, which is the trap Part 4 exists
   to remove.

   The issuer belt on `PolicyChecking` is skipped when an act was declared, because one declaration covers one
   person doing every half of one policy. **The residual gap, stated rather than hidden**: somebody who ISSUED
   but did not PLACE still cannot check, even in a COMBINED office, because there is no constraint for that
   pair to hang an act on.

   **A SHARED TEST DOUBLE, because fifteen hand-written mocks would have broken fifteen tests silently.**
   Every one of those service specs contains a test asserting that a self-approval is refused. A local
   `{ resolve: vi.fn().mockResolvedValue(null) }` in each would have made all fifteen of those tests pass on
   the mock rather than on the code — § 1.51(d) with the guard and the double swapped.
   `duty-segregation.double.ts` refuses exactly as a segregated office does, through the same
   `assertDifferentActors`.

   **And every ordinary-path assertion now pins the escape column as `null`** where the write is asserted, which
   is what would catch a call site that started sending an act id when two different people are involved.

   `PermissionRepository.findRolesGrantingCode` is new and is what makes the hat recordable: the cached
   authorization read flattens role provenance away, deliberately, so the hat cannot be derived from it.
4. **[DONE]** **The mode screen**, its permission, and the audited change.

   `duty-segregation.mode.declare`, granted to **OFFICE_ADMINISTRATOR alone**, and the omissions are the
   design: COMPLIANCE, EXECUTIVE_MANAGEMENT and EXTERNAL_AUDITOR hold `internal-controls.view`, which is the
   self-approval report. **Whoever DECLARES the mode must not be whoever REVIEWS the acts it permits** — the
   same segregation principle one level up, applied to the control that weakens a control. Asserted by a test,
   not left as a comment.

   `GET /duty-segregation/mode` accepts EITHER code, which is the one place `PermissionsGuard`'s OR semantics
   are what you want: the reviewers must see the office's posture beside the acts, and hiding it from them
   would be the wrong half to close. `PATCH` names one code.

   **The reason is MANDATORY here**, unlike the per-act one. Declaring how an office separates duties is never
   incidental to another action — it is the whole request — so there is no ordinary path that breaks by
   requiring it. Audited with before AND after: "it was already segregated" is what distinguishes a
   confirmation from a change.

   **NO idempotent short-circuit, and the first version had one.** Declaring SEGREGATED in an office that is
   already SEGREGATED looks like a no-op and is not — skipping the write threw away the first explicit
   declaration an office ever makes, which is the one most worth having. Caught by a test that asserted the
   declaration stamps who and when.

   `/auth/me` carries `dutySegregationMode` for every authenticated caller, because every approve control needs
   it: a screen that cannot know the mode either asks everybody for a reason or asks nobody and then 422s.
5. **[DONE for the pair that is proven end to end]** **The record screens** — a combined act is visible where
   the record is read.

   `combinedDutyActView` is one shape for all fifteen pairs (the actor, when, the reason, the pair named by its
   constraint, the HAT, and whether the hat was ambiguous), and the endorsement's refund block projects it. A
   reader looking at a refund sees on the record itself that nobody else signed it, without going to find a
   report — which is Rule 4's requirement.

   **The other fourteen views do not project it yet**, and that is a real limit rather than an oversight: each
   needs its own `include` and its own projection, and the pair with an end-to-end proof is the one worth
   wiring first. They are reachable through the report.

   **[CLOSED for the mode screen, OPEN for the approve screens]** The half step 3a created:
   `POST /refunds/:id/approve` and fourteen siblings accept a `combinedDutyReason` that NO web control sends. Today that is unreachable (no office can be COMBINED), but
   the moment step 4 ships the mode screen, an office that declares COMBINED would find its "Approve refund"
   button returning 422 "give a reason" with nowhere to type one — § 1.44's unreachable-surface shape, arriving
   from the other direction. So step 4 and step 5 are coupled: **the mode must not become settable before the
   screens can carry a declaration.** The screen also has to know the office's mode to decide whether to ask,
   which means `/auth/me` or an office-settings read has to carry it.
6. **The self-approval report** — THE SHIPPING GATE above. It does not exist today, and the mode cannot be
   released without it. Its first ordering rule is the owner's condition: a self-review of ACCESS at the
   top, flagged, never mixed into the list.
7. **Tests and plants**, below.

---

## The plants that decide whether this is real

**Status after step 3a: ALL FIVE of the plan's plants are run, and four are permanent tests.** Plant 4 —
withholding the checker permission in a COMBINED office — is `duty-segregation-combined.e2e-spec.ts`'s third
test: a Placement officer who does not hold `refund.approve` declares a reason and is still refused 403, and
the refusal must NOT mention segregation (otherwise it would tell somebody to find a second signature when
what they need is the permission).

**A plant on the FIFTEENTH pair, because fourteen of them had no combined-path proof.** The unit tests pin the
escape column as null on the ordinary path, which catches a spurious act id but says nothing about the column
being filled when one is declared. So `duty-segregation-combined.e2e-spec.ts` gained a SECOND pair end to end —
`NeedsAssessment.review`, chosen because that table carries TWO escape columns and the test asserts the review
fills the reviewer one and leaves the approver one null, which is the reason there are fifteen columns and not
fourteen. Dropping the column from that write turned the 201 into a **500**: the CHECK refusing it, with the
engine's own `updateMany` named in the trace.

That plant was also **refused as STALE on its first attempt** — `prettier` had reformatted the line the plant
named, and `plant.mjs` said so and exited non-zero rather than silently matching nothing. Re-derived against
what was actually there.

**Thirteen pairs still have no combined-path e2e**, and that is the honest state: they have the ordinary-path
assertion, the shared double, and a database constraint that refuses a missing escape column with a 500 rather
than accepting a silent self-approval. The 500 is the backstop that makes the gap survivable, not a reason to
leave it.

**Two further plants on step 3a's own code**, each stated before running:

  - **The call site drops the act id.** Which test should die: the COMBINED approval. Why observable: the
    write then carries a null escape column. Result: 201 became **500** — the CHECK constraint refused the
    service's mistake, which is the backstop existing rather than being described.
  - **The engine ignores the mode** (`if (false)` on the mode branch). Which test should die: the SEGREGATED
    refusal. Why observable: the same person's approval stops being refused at the mode check. Result: 403
    became 422 — it died at the reason gate, one step before the trigger. Worth stating precisely: this plant
    proved the test fails, and the TRIGGER's backstop for the same mistake is proven separately by the
    schema spec's forge-an-act-in-a-segregated-office test rather than by this run.

**Status after step 2: plants 1, 2, 3 and 5 were RUN, and 1, 3 and 5 became permanent tests rather than
one-off plants** — `apps/api/test/duty-segregation-schema.e2e-spec.ts`, 7 tests. Plant 4 needs step 3's
application layer. What was proven:

  - **Plant 1's property, stronger than the plant.** The test writes a self-approving `Refund` with RAW
    PRISMA — no service, no DTO, no application check in the path at all — and the database refuses it.
    Removing the application check could not produce a weaker state than the one already asserted.
  - **Plant 2, run.** `Refund_maker_checker_distinct` dropped on db-test: the undeclared-self-approval test
    died ("promised resolved instead of rejecting") and the registry-vs-`pg_constraint` test died too,
    independently, at 14 constraints against 15. Restored verbatim, `db:test:divergence` 20/20, both specs
    green again. The leaked row the plant let through had to be deleted before the constraint would go back —
    which is itself the constraint working.
  - **Plant 3, run and now permanent.** Forging an act for a SEGREGATED office is refused by the trigger,
    with the office's mode in the message.
  - **Plant 5, run and now permanent.** A `NeedsAssessment` act declared for the REVIEWER pair does not
    excuse a self-APPROVAL: the approver constraint still refuses. This is the whole reason there are 15
    columns and not 14.
  - **And the three claims together, in one rolled-back transaction**: an undeclared self-approval refused,
    an act insertable once the office declares COMBINED, and the same previously-refused write accepted
    because it declares itself — read back inside the transaction, then rolled back so no later spec sees an
    office that permits self-approval.

The owner named the two that matter, and they are the acceptance criteria rather than a test list:

1. **Remove the application check entirely.** In a SEGREGATED office, the database must still refuse: the
   write carries `combinedDutyActId = NULL` and the CHECK raises `23514`. If that write succeeds, the
   control moved into the application and the migration deleted a constraint.
2. **Drop one CHECK constraint.** The segregated test for that pair must die. If it survives, the test was
   asserting the application guard and would not notice the database's half disappearing.

Three more this design needs:

3. **Forge a `CombinedDutyAct` for a SEGREGATED office.** The trigger must refuse. Without this, "COMBINED
   mode" is a value nobody checks and the escape column is a universal bypass.
4. **Withhold the checker permission in a COMBINED office.** Must still be 403 — Rule 2, as a test.
5. **Use one pair's escape column for another pair's constraint** on `NeedsAssessment`. Must fail, which is
   why there are 15 columns and not 14.

And one that is not a plant but a measurement: after the migration, every existing office must read
SEGREGATED, and the per-user effective-permission diff must be empty — this change grants nothing.

---

## Decided — access recertification is included, with a condition

The owner's decision, with her reasoning on the record because it settles a class of question and not just
this pair:

- **The system is built on a DECLARED mode, not a computed one.** A rule that computes itself from today's
  headcount would make the system inconsistent with itself, and make behaviour change day to day for
  reasons no user can see.
- **The protection is not lost, it changes form: from IMPOSSIBLE to VISIBLE.** A refusal leaves no trace. A
  recorded self-review leaves a line with a name and a date that an auditor reads.
- **Keeping it locked relocates the trap.** A single-operator office could never CLOSE a recertification
  cycle — which is the same dead end, one table over.

### THE CONDITION, which is part of the decision

**A person's review of their OWN access appears at the TOP of the self-approval report, flagged as the
highest-attention row.** Not mixed into the list, not sorted by date with everything else.

Every other self-approval concerns a transaction — a customer, a claim, a refund. This one concerns the
PERMISSIONS THEMSELVES: it is the control over whoever distributes control, and it must not read as one
line among many.

**Measured consequence: that report does not exist.** `segregationSignal()` produces a log line today —
`logger.error` when it is a self-grant, `logger.warn` otherwise — plus an audit row. There is no endpoint
and no screen that lists self-approvals, in any form. So the condition is not a sort order to add to
something; it is a requirement on a report Part 4 has to build, and it is that report's first ordering
rule. Implementation must not treat "flag it at the top" as done by writing a log line at a higher level.

### MEASURED WHILE WIRING STEP 3: this pair's constraint fires at CREATION, not at review — and that is a decision the owner has not been asked yet

Found by reading `access-recertification.service.ts` against the schema rather than by assuming this pair
works like the other fourteen. It does not, and the difference decides whether the condition above is
reachable.

**The other fourteen pairs are decided by an UPDATE.** A refund exists with `approvedByUserId` null; the
approval writes it; the CHECK is evaluated on that write; the escape column is written in the same statement.
Whoever approves is present, and can be asked for a reason.

**`AccessRecertificationItem` is decided by an INSERT.** `reviewerUserId` is NOT NULL and is assigned when
`startCycle` creates the item — and that constraint has no null guards at all
(`CHECK ("reviewerUserId" <> "subjectUserId")`), so it fires at cycle start. In an office with one person,
`pickReviewer` finds nobody, and the cycle cannot be started at all. **`decide()` is never reached, so wiring
`decide()` through the engine would change nothing whatsoever for the case the owner's decision is about.**

So including access recertification requires `startCycle` to be able to assign a subject as their own
reviewer, which means the ACT has to be declared at cycle start, by whoever starts the cycle. Three ways out,
and the choice is the owner's because it changes what the report's flagged row means:

1. **Declare at cycle start.** `startCycle` takes a reason and writes one act per self-assigned item. Honest
   and simple; the reason is genuinely available then ("this office has one person"). The cost: the act is
   dated and attributed to the CYCLE START, not to the review, so the report's top row reads "she was
   assigned her own access to review on the 1st", not "she reviewed her own access on the 14th". The owner's
   words are *"a person's review of their OWN access"*.
2. **Declare at cycle start AND again at decide.** Two acts for one situation: the assignment and the review.
   The report then has the row the condition describes, dated when the review happened. The cost is that one
   arrangement produces two rows, and a reader has to understand why.
3. **Make `reviewerUserId` nullable and assign the reviewer at decide time.** Then this pair behaves like the
   other fourteen. The cost is real and wider than it looks: assigning the reviewer at cycle start is what
   makes the cycle a work LIST, `pickReviewer`'s total ordering was a recorded fix on this exact query
   (IMPROVEMENTS § 1.42 — which reviewer a subject got was being decided by the query plan), and a nullable
   reviewer would re-open that question.

**Not chosen here.** Option 1 is the cheapest and option 2 is the one that satisfies the condition as
written; option 3 is a schema change to a control whose ordering was already fixed once. Either way the
report must exist first, since it is the gate — so this is a question the report's construction will make
concrete, and it is recorded rather than answered.

**What this says about the plan.** The rollout order treated step 3 as nineteen repetitions of one worked
example. Eighteen of them are. The nineteenth is the pair the owner's own condition names, and it needs a
decision rather than a repetition — which is the argument for wiring a pair END TO END early, because the
shape of the other eighteen is what made this one visible.

---

## Decided — `dpoAlternateApproverUserId` is SUPERSEDED

Marked superseded in `schema.prisma` and here. **Removed in the deferred cleanup track, not in this
work** — the point is that two mechanisms for one problem must not both appear live, and one of them being
unread is exactly how the next person implements the wrong one.

Measured before marking it, because "nothing reads it" is the kind of claim that ages: **six references in
the whole repository, none of them a reader.**

    packages/db/prisma/schema.prisma                     the declaration
    packages/db/prisma/migrations/20260925100000_…       the migration that created it
    apps/api/src/common/org-context/per-organization.runner.spec.ts   a fixture setting it to null
    README.md                                            a known-gap note (below)
    docs/duty-segregation-mode.md                        this plan, twice

Nothing in `apps/web`, nothing in the seed, no service, no repository, no controller.

The README already states the consequence honestly and it is worth keeping in view, because it is the same
trap the owner's decision above names: *"the `dpoAlternateApproverUserId` fallback, which has no consumer,
so in the one edge case it exists for a destruction batch cannot be approved by anyone… an AVAILABILITY
gap, never a safety one."* A single-operator office cannot approve a disposal batch TODAY. The mode is what
closes that, which makes this column superseded by design rather than merely unused.

---

## Open questions — for the owner, not for me

1. **Who may switch the mode, and does it need a step-up challenge?** Under the four-action scheme this
   wants its own code (`duty-segregation.manage`, say) rather than riding on `user.manage`. It is the
   largest deliberate control relaxation in the product; the MFA-attribute screen is the existing
   precedent for requiring a fresh challenge.
2. **May an office tighten back to SEGREGATED while combined acts exist?** This design says yes, and
   history stays exactly as recorded. Worth confirming, because the opposite choice would change the
   schema (it is the only reason to consider the rejected cascade design).
3. **Reason per act, or per mode declaration?** Planned per act, minimum length, like the national-ID
   reveal. A single reason at mode-declaration time would make the fiftieth combined act unexplained.

---

## A LIMIT, NOT A GAP: THREE pairs have no database backstop

**Corrected during step 3 — it is three, not two.** `NeedsAssessment.reject` is the third: rejecting
writes no `approvedByUserId`, so `NeedsAssessment_approver_maker_checker_distinct` can never fire on that
path. The rule "the rejecter is not the capturer" is enforced in application code and nowhere else, the
same as the other two. Found by reading the write rather than the guard.

**In COMBINED mode, two of the seventeen maker/checker rules this system enforces are protected by
application code alone.** Written here in plain words because a known limit and a hidden gap are different
things, and because Part 4 cannot fix it: the mode works by making a CHECK constraint conditional, and
these two pairs have no constraint to condition.

    ConflictOfInterestDisclosure.acknowledge   compares against Recommendation.draftedByUserId
                                               gated by conflict-of-interest.disclose
                                               NO check constraint covers this pair

    PolicyChecking.check (issuing officer)     compares against Policy.issuedByUserId
                                               the constraint covers checker <> PLACER only
                                               checker <> ISSUER is application code and nothing else

Both were found while wiring the remedy into `assertDifferentActors` in Part 5 — not by design review, by
touching all nineteen call sites and finding two that would not map.

What this means concretely: in a SEGREGATED office these two are enforced by the application, as today, and
a caller that bypasses application code entirely (raw SQL, a future integration) can write a self-approval
for them, TODAY, before any of this work. In a COMBINED office they relax with everything else, and there
is no second layer underneath.

**Deliberately not fixed here.** Adding two CHECK constraints is a schema change with a backfill question
attached — existing rows may already violate them — and that is its own work with its own measurement, not
a rider on the mode. It belongs in the deferred cleanup track beside the other recorded debts.

## Out of scope, explicitly

Not a per-pair mode (one setting per office, not fifteen). Not a change to any workflow state, SLA timer or
permission grant. Not making COMBINED the default, ever. Not the Part 5 setup flow itself — this plan
supplies the sentence that flow needs, and the flow is its own item.
