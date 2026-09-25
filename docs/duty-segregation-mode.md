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

That is Part 4's problem, recognised once, solved for one pair — and **`grep` finds no consumer in
`apps/api/src`.** So the current answer to "this office has one person" is a dormant column. This plan
must say what happens to it; see the open questions.

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

1. **Bring the three lists to 15.** `maker-checker.util.ts`'s table (11 → 15), the pair→checker-permission
   map, and a test that derives the expected set from `pg_constraint` so a sixteenth constraint cannot be
   added without the lists moving. This is worth doing first because everything after it is per-pair work,
   and doing it against a wrong denominator means doing it twice.
2. **Schema.** The enum, `Organization.dutySegregationMode`, `CombinedDutyAct`, the 15 escape columns, the
   15 CHECK replacements, the one trigger. Hand-written, applied, `migrate resolve`, with the trigger and
   every recreated CHECK asserted in the migration's own `DO` block — `db:divergence` sees neither CHECKs
   nor triggers.
3. **The application layer.** `assertDifferentActors` gains the mode and the act: in SEGREGATED it behaves
   exactly as today; in COMBINED it requires a reason, records the act, and returns its id for the write to
   carry. All 19 call sites across 14 files pass through it — and the 15-pair map is what tells each one which constraint
   column to fill.
4. **The mode screen**, its permission, and the audited change.
5. **The record screens** — a combined act is visible where the record is read.
6. **Tests and plants**, below.

---

## The plants that decide whether this is real

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

## Open questions — for the owner, not for me

1. **`AccessRecertificationItem` under uniform application.** Rule 5 says all the pairs, and applying it
   here means a person can review their own access recertification in a COMBINED office. That is the
   control over the person who grants access, and it is also the one the reviewer pool picks automatically
   (`pickReviewer`). Planned as uniform per the rule; flagged because it is the one pair where uniformity
   has a consequence worth stating out loud.
2. **`dpoAlternateApproverUserId`.** Superseded by the mode, kept as a narrower option, or removed? It is
   dormant either way, so nothing breaks — but leaving two mechanisms for one problem is how the next
   person ends up implementing the wrong one.
3. **Who may switch the mode, and does it need a step-up challenge?** Under the four-action scheme this
   wants its own code (`duty-segregation.manage`, say) rather than riding on `user.manage`. It is the
   largest deliberate control relaxation in the product; the MFA-attribute screen is the existing
   precedent for requiring a fresh challenge.
4. **May an office tighten back to SEGREGATED while combined acts exist?** This design says yes, and
   history stays exactly as recorded. Worth confirming, because the opposite choice would change the
   schema (it is the only reason to consider the rejected cascade design).
5. **Reason per act, or per mode declaration?** Planned per act, minimum length, like the national-ID
   reveal. A single reason at mode-declaration time would make the fiftieth combined act unexplained.

---

## Out of scope, explicitly

Not a per-pair mode (one setting per office, not fifteen). Not a change to any workflow state, SLA timer or
permission grant. Not making COMBINED the default, ever. Not the Part 5 setup flow itself — this plan
supplies the sentence that flow needs, and the flow is its own item.
