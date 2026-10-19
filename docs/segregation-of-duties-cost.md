# The priced cost of the segregation-of-duties gap

**This is a REPORT. Nothing in it was built.** Decision 114 asked for the cost to be priced;
the register's module-1 row already records that the work itself waits for the
roles-and-permissions pass, and this file is the price that row refers to.

---

## 0. The gap, stated exactly

`MAKER_CHECKER_REGISTRY` records, per pair, the **checker** permission — what a second person
must hold for the operation to be completable at all. It records **no maker permission**:

```
makerPermission occurrences in apps/api/src/common/maker-checker-pairs.config.ts: 0
```

So the system can answer *"which of these pairs can my office not complete today"* — the
readiness list does — and **cannot answer the real segregation question: does one role hold
both halves of the same pair.**

That is what this report prices, and then answers once by hand.

---

## 1. First measurement: the pair count is SIXTEEN, and eleven places still say fifteen

| Measured | Count |
|---|---|
| `MAKER_CHECKER_REGISTRY` entries | **16** |
| distinct `*_maker_checker_distinct` constraints in the migrations | **16** |
| entries carrying `dormant: true` | **0** |
| entries carrying `dbCheckConstraint: null` | **0** |

The sixteenth is `RetentionScheduleItem_maker_checker_distinct`, added by migration
`20261128100000_retention_schedule_maker_checker` — **in this module**, as part of the
retention split.

Fifteen was true when it was written. It is now claimed in eleven places in source and docs
plus four `CLAUDE.md` rows, including the canonical file's own header:

* `apps/api/src/common/maker-checker-pairs.config.ts` — three times in the header, once at
  line 122 ("the other fifteen")
* `apps/api/src/modules/duty-segregation/duty-segregation.service.ts:16` — "Which of the 15
  pairs"
* `apps/api/src/common/duty-segregation.view.ts`, `common/role-scope.ts`,
  `customer/kyc.controller.ts` (twice), `duty-segregation/duty-segregation.double.ts`,
  `supporting-operations/data-processing-agreement.controller.ts`,
  `apps/web/lib/needs-assessment/needs-assessment-api.ts`
* `apps/api/test/internal-controls.e2e-spec.ts:349` — "the OTHER 15 pairs"
* `docs/duty-segregation-mode.md` (three places), `docs/decision-role-scope.md`,
  `docs/b7-consistency-record.md`

**None of them is load-bearing.** `MakerCheckerConstraint` is derived from the registry
(`NonNullable<(typeof MAKER_CHECKER_REGISTRY)[number]['dbCheckConstraint']>`), so the
compile-time union is 16 whatever the comment beside it says, and
`test/maker-checker-pairs.e2e-spec.ts` compares the registry against `pg_constraint` rather
than against a literal. So this is doc rot, not a defect — and it is recorded because
`CLAUDE.md`'s own action-required note of 2026-09-29 is a checklist that opens
*"Adding a sixteenth pair?"*, and the sixteenth pair arrived without it being worked.

### And the measurement that tracks these pairs is DEAD

```
$ python scripts/measurements/combined-duty-projection.py
AssertionError: expected 15 registered pairs, parsed 16
$ echo $?
1
```

It exits on its own cross-check before measuring anything — **the identical failure
`scripts/measurements/permission-reachability.py` had on 2026-10-11**, recorded then as *"the
stale pin was worse than stale: it had stopped the whole measurement"*, and fixed there by
reading the count from the source rather than bumping the literal. Same class, second
instance, found by running it.

It is **not** wired into `verify.sh`, CI or any `package.json` script — checked — so CI is
not red and the standing rule about building on red does not bite. It is a deliberate re-run
measurement, which is exactly the class that dies unnoticed.

The figures in section 3 below were therefore produced by reading the registry and the seeded
grid **directly**, not through that instrument.

**The fix is the established one** (read the expected count from `MAKER_CHECKER_REGISTRY`)
and it is **NOT made here** — batch 4 said report, do not build, and this changes a
measurement.

---

## 2. The price: every maker permission, measured from the route that writes the maker field

The registry names the maker **field**. The maker **permission** is whatever gates the route
that writes it, so each row below was read off that controller rather than guessed from the
field name. That mattered: four guesses from the name were wrong.

| # | Pair | Maker field | The route that writes it | Maker permission |
|---|---|---|---|---|
| 1 | `KYCRecord` | `createdByUserId` | `POST /customers/:id/kyc` | `kyc.capture` |
| 2 | `PolicyChecking` | `placedByUserId` | `POST /policies` | `policy.create` |
| 3 | `Refund` | `raisedByUserId` | `POST /endorsements/:id/calculate-adjustment` | **`endorsement.apply`** |
| 4 | `DisposalBatch` | `nominatedByUserId` | `POST /disposal-batches` | `retention.dispose.nominate` |
| 5 | `RetentionScheduleItem` | `setByUserId` | `POST /retention-schedule-items` | `retention-schedule.update` |
| 6 | `DataSharingApproval` | `requestedByUserId` | `POST /data-sharing-approvals` | `data-sharing.request` |
| 7 | `DataProcessingAgreement` | `assessedByUserId` | `POST /vendors/:id/data-processing-agreements` | **`vendor.update`** |
| 8 | `Settlement` | `approvedByUserId` | `POST /claims/:id/settlement` | `claim.settle.approve` |
| 9 | `CommissionLedgerEntry` | `overrideRequestedByUserId` | `POST /commission/entries/:id/override` | `commission-override.raise` |
| 10 | `Recommendation` | `draftedByUserId` | `POST /recommendations` | `recommendation.draft` |
| 11 | `AccessRecertificationItem` | `subjectUserId` | — the cycle's own INSERT | **NONE, AND NONE CAN EXIST** |
| 12 | `NeedsAssessment` (reviewer) | `createdByUserId` | `POST /needs-assessments` | `needs-assessment.create` |
| 13 | `NeedsAssessment` (approver) | `createdByUserId` | `POST /needs-assessments` | `needs-assessment.create` |
| 14 | `Complaint` | `resolvedByUserId` | `POST /complaints/:id/resolve` | **`complaint.log`** |
| 15 | `DataSubjectRequest` | `processedByUserId` | `POST /dsrs/:id/fulfil` | `dsr.handle` |
| 16 | `IncidentReport` | `classifiedByDpoUserId` | `POST /incidents/:id/classify` | `incident.classify` |

Every code named above **exists in the catalogue** — checked against all 227, zero missing.
So the price of recording the maker half is **one field on sixteen existing rows**, not a
batch of new permissions.

### The four the field name would have got wrong

* **Row 3, `Refund`.** `refund.raise` exists and is the obvious answer, and it is the wrong
  one: `CLAUDE.md` already records that code as **NOT YET ENFORCED** — a refund is created
  inside `POST /endorsements/:id/calculate-adjustment` under `endorsement.apply`, and
  `refund.controller.ts` carries only `disburse`. Recording `refund.raise` as the maker half
  would have put a **code nothing reads** into the one place that is supposed to answer the
  segregation question — the answer would have been confidently wrong rather than absent.
* **Row 7, `DataProcessingAgreement`.** The maker gate is `vendor.update`, in a different
  permission family entirely. Nobody reading `dpa.approve` would find it.
* **Row 14, `Complaint`.** There is no `complaint.resolve`. `complaint.log` gates **eight**
  routes — create, list, read, assign, start, actions, resolve — so holding it says "may work
  complaints" and not "may resolve this one". Recording it as the maker half is honest and
  **coarse**, and the coarseness has to be stated or the answer over-reports.
* **Row 11, `AccessRecertificationItem`.** The maker field is the **subject** of the review.
  Being the subject is not a capability, there is no route a maker calls, and no permission
  exists or could. This pair is a **structural exception** to the whole design, not a missing
  row — the register already describes the same asymmetry from the other direction (in a
  one-person office the only way a cycle can start is for her to be set to review her own
  access).

So the registry's shape needs a nullable maker permission with a stated reason for the null,
exactly as `dbCheckConstraint` has — not a required field that would force an invented code
onto row 11.

### What the change costs, named

1. One optional field on `MakerCheckerPair`, plus its reason-for-null on row 11.
2. Sixteen values, fifteen of them from the table above.
3. One guard that the named code is a real catalogue code — the `refund.raise` lesson: a
   maker code that exists and is unenforced is worse than none, so the guard must check
   enforcement, not merely existence (`permission-enforcement.inventory.spec.ts` already
   knows which codes are unenforced).
4. The query that then becomes possible — per role, both halves of one pair — and the
   screen or report that asks it.
5. The two names the register already requires: **checker concentration** (an observation)
   and **both halves of one pair** (the rule). Nothing may call the first the second.
6. The stale `combined-duty-projection.py` pin, and the eleven "fifteen" claims.

Items 1–3 are small. Item 4 is the roles-and-permissions pass, which is why the register
defers it there rather than here.

---

## 3. The answer, given once by hand

Computed from the seeded grid in `packages/db/prisma/seed-data/permissions.ts` — 227 codes
parsed, every code named in section 2 present.

**Four of the fifteen answerable pairs have a seeded role holding BOTH halves.**

| Pair | Maker code (roles) | Checker code (roles) | Roles holding BOTH |
|---|---|---|---|
| `RetentionScheduleItem` | `retention-schedule.update` (2) | `retention-schedule.confirm` (2) | **`COMPLIANCE_OFFICER`, `DATA_PROTECTION_OFFICER`** |
| `Settlement` | `claim.settle.approve` (2) | `claim.settle.second-approve` (2) | **`BRANCH_DEPARTMENT_MANAGER`** |
| `Complaint` | `complaint.log` (5) | `complaint.close` (1) | **`BRANCH_DEPARTMENT_MANAGER`** |
| `DataSubjectRequest` | `dsr.handle` (1) | `dsr.close` (1) | **`DATA_PROTECTION_OFFICER`** |
| `KYCRecord` | `kyc.capture` (1) | `kyc.approve` (1) | — |
| `PolicyChecking` | `policy.create` (1) | `policy.check` (1) | — |
| `Refund` | `endorsement.apply` (1) | `refund.approve` (2) | — |
| `DisposalBatch` | `retention.dispose.nominate` (1) | `retention.dispose.approve` (1) | — |
| `DataSharingApproval` | `data-sharing.request` (5) | `data-sharing.approve` (1) | — |
| `DataProcessingAgreement` | `vendor.update` (4) | `dpa.approve` (1) | — |
| `CommissionLedgerEntry` | `commission-override.raise` (1) | `commission-override.approve` (1) | — |
| `Recommendation` | `recommendation.draft` (1) | `recommendation.approve` (1) | — |
| `NeedsAssessment` (reviewer) | `needs-assessment.create` (1) | `needs-assessment.approve` (1) | — |
| `NeedsAssessment` (approver) | `needs-assessment.create` (1) | `needs-assessment.approve` (1) | — |
| `IncidentReport` | `incident.classify` (1) | `incident.classification.co-sign` (1) | — |
| `AccessRecertificationItem` | — not a permission — | `access-recertification.review` (—) | not answerable |

### NONE OF THE FOUR IS AN EXPLOIT, and the distinction is the whole finding

In every one of the sixteen pairs a **database CHECK constraint** still refuses one person
performing both halves, and `assertDifferentActors` refuses it above that. Holding both codes
does **not** let anybody self-approve.

What holding both codes means is narrower and still worth knowing: **that role is not
structurally segregated.** The office is relying on there being two *people* in it. A
one-person office in that role hits the refusal and cannot complete the operation at all —
which is what the readiness list already reports, and what the COMBINED mode exists for.

So the four rows are a **control observation**, not a breach. Reporting them as a breach is
precisely what the register's second module-1 row forbids: *"Nothing may call concentration a
segregation breach — a screen reporting a violation it did not measure is a false claim to
the user."*

### Two of the four are already recorded decisions

* **`DataSubjectRequest`.** The register already states that the DPO holds `dsr.close` and
  `dsr.handle`, and `maker-checker-pairs.config.ts` annotates this pair in place with
  IMPROVEMENTS § 1.65 — the split between CORRECTING a customer's details and CLOSING the
  request is deliberate as of 2026-09-28. The pair being held by one role is the known state,
  and that note says to read it before proposing one person should be able to do both.
* **`BRANCH_DEPARTMENT_MANAGER`.** The register's third module-1 row already says that role
  holds seven checker permissions and that *"whether that is a breach cannot be judged until
  the question above can be asked correctly."* This report asks it correctly for the first
  time, and the answer is **two pairs**, not seven: `Settlement` and `Complaint`.

### The two that were NOT already recorded

* **`RetentionScheduleItem`** — two roles hold both halves, and it is the **newest** pair, the
  one added in this module. Its checker is a legal-counsel confirmation; both the Compliance
  Officer and the DPO can set a schedule and confirm it.
* **`Complaint`** — and this one is an artefact of the coarse maker code. `complaint.log`
  gates eight routes, so the Manager holds "both halves" by holding a code that mostly means
  something else. Whether this counts at all depends on splitting `complaint.log`, which is a
  four-action question and not a segregation one.

**None of the four is changed.** The register's own standing rule applies: *"Do not change the
seeded role's permissions — whether that is a breach cannot be judged until the question can
be asked correctly."* It can now be asked. Judging it is the roles-and-permissions pass.

---

## 4. The price in one paragraph

Recording the maker half costs **one optional field, sixteen values and one guard** — every
code already exists, so no permission is created and no grant moves. Fifteen of the sixteen
values are in section 2's table; the sixteenth cannot exist and must be a declared null with
its reason, because that pair's maker is the subject of the review rather than an actor.
Three of the fifteen are not what their field name suggests, and one of those three
(`refund.raise`) would have recorded an **unenforced** code as the answer — so the guard has
to check enforcement and not merely existence.

The answer the field would buy, computed by hand above, is **four of fifteen** — and all four
are role concentration rather than a breach, two of them already recorded decisions, one of
them an artefact of a coarse maker code, and one genuinely new and arriving with this
module's own sixteenth pair.

What is **not** priced here is the screen or report that asks the question continuously, the
split of the readiness signal into its two honest names, and the judgement about
`BRANCH_DEPARTMENT_MANAGER`. All three belong to the roles-and-permissions pass by the
register's own trigger, and nothing here moves that trigger.

---

## 5. What may not be claimed until this is built

Unchanged from the register, restated because this report makes the numbers look answerable:

**No screen, report or document may assert that this system enforces separation of duties.**
It enforces *no self-approval* — sixteen database constraints and one engine, which is a real
and strong guarantee — and that is a different sentence. Until the maker half is recorded,
the system cannot see a role that holds both halves, and the four rows above exist only
because a person computed them once.
