# The KYC path, screen by screen — and what works, what does not, and what works but cannot be found

**Written 2026-10-01**, because the owner ran the system herself and could not follow this path on the
frontend. Derived **from the screens**, not from the permission catalogue and not from the API: this
repository has already shipped a route returning a figure no screen rendered, so the screen is the
authority.

> **HER NOT FINDING THE PATH IS ITSELF A FINDING, not only a documentation gap.** A path a user cannot
> follow is a defect even when every step works. Two of the three things below are exactly that:
> mechanisms that work and announce themselves to nobody.

---

## THE HONEST CONSTRAINT, before any of it

**Screening today runs against seeded test data, and everything below is verified AGAINST TEST DATA —
never as verified screening.**

There is no approved list source: Jordan's national list has no documented API or file format, and the
other available source is barred for commercial use. The mechanism is end-to-end real — a provider
registry, a dataset version per generation, fuzzy matching with romanisation variants, a review queue,
a hold that blocks approval — and what it matches against is not a sanctions list.

**The forbidden-claim check, as its own question** (a screen must never claim it screened sanctions or
politically-exposed persons when it screened test data):

| | |
|---|---|
| `/screening-matches` when the list is empty | **states the opposite, prominently.** `role="alert"`: *"The local sanctions list is EMPTY — the sync has never run. No customer has actually been screened, and an empty queue here does NOT mean there are no matches."* Driven by `watchlistReady === false`, a measured state, not a hardcoded string. |
| `/watchlist-sync` with no published generation | *"No generation exists — no sync has completed, and no customer can be treated as clear."* |
| the KYC queue | makes no screening claim at all; it shows a hold or nothing |

**So the standing decision is honoured — with one wrinkle worth fixing.** The intro paragraph on
`/screening-matches` is UNCONDITIONAL and present-tense: *"Names are checked against the synced OFAC and
UN sanctions lists…"*. When the list is empty the screen therefore says two contradictory things, and
relies on the reader reaching the second. The alert corrects it and is the louder of the two, so this is
**not** the forbidden claim standing unqualified — but the first sentence is false in that state and
should be conditional on the same `watchlistReady` the alert already reads.

---

## The walkthrough

### 1. A Sales/Relationship Officer signs in and opens `/customers/new`

`kyc.capture` is held by **SALES_RELATIONSHIP_OFFICER alone** (measured against the seeded grid).

A wizard, with its own step pills: **type → profile → (UBOs, corporate only) → documents → review**.

### 2. They choose INDIVIDUAL or CORPORATE

Two genuinely different forms, and the API refuses a body that mixes them — a CORPORATE record cannot
carry a personal `nationalId`, an INDIVIDUAL cannot carry a `registrationNumber`.

### 3. They fill the profile and press continue

**One request creates the customer AND opens its KYC file.** `POST /customers`, then
`POST /customers/:id/kyc` — the KYC record is born in `DRAFT`. The customer is `PENDING_KYC`.

The screen then moves to UBOs (corporate) or straight to documents.

### 4. UBOs, for a company

Each beneficial owner is added with a name, a national ID, a date of birth and a nationality. **These
become screening subjects in their own right** — a company has no date of birth of its own, so the
natural persons behind it are what carry the identity discriminators.

### 5. Documents

Attached and classified. No screening has happened yet.

### 6. The review step: "submit for review"

`POST /kyc-records/:id/submit` → the record moves **`DRAFT` → `SUBMITTED`**, and the screen navigates to
`/customers/:id`.

> ### ⛔ DEFECT 1 — the officer lands on a page that does not say what just happened
>
> `/customers/:id` shows the **customer's** status (`PENDING_KYC`) and **nothing about the KYC record at
> all** — not its stage, not its history, and no link to it. The eight-value KYC vocabulary
> (`DRAFT`/`SUBMITTED`/`SCREENING`/`EDD`/`COMPLIANCE_REVIEW`/`APPROVED`/`REJECTED`/`PERIODIC_REVIEW_DUE`)
> is invisible on the customer's own page.
>
> So after submitting, the person who did the work cannot tell from that page whether the file was
> submitted, screened, is awaiting a decision, or was rejected. **This is the whole of why the path
> cannot be followed on the frontend.**

### 7. Nothing happens automatically

`submit` performs **one** transition and stops. It does **not** run screening. The file sits in
`SUBMITTED` until a human opens the queue and asks for it.

### 8. A Compliance Officer signs in and opens `/customers/kyc-queue`

`kyc.approve`, `screening.run` and `sanctions-pep.screen` are held by **COMPLIANCE_OFFICER alone**.

Three columns: **Customer · Status · Actions**.

> ### ⚠ DEFECT 2 — nothing tells them it is waiting
>
> There is a `customer_pending_kyc` notification, and it counts
> `customer.count({ ownerUserId: <reader>, status: 'PENDING_KYC' })` — **the customer's OWNER**, which is
> the Sales officer who just captured it. The person who must act is told nothing.
>
> There is **no book-wide "a KYC file is awaiting a decision" notification**. The three book-wide
> sources are `claim_followup`, `aml_alert` and `screening_match`. So the only thing that ever summons a
> Compliance Officer to this queue is a **possible match already raised** — and a clean file waiting for
> approval announces itself to nobody who can approve it. **They must go looking.**

> ### ⚠ DEFECT 3 — the nav gate is the wrong code
>
> The nav entry for `/customers/kyc-queue` is gated on **`customer.360-view.read`**, while
> `GET /kyc-records` is gated on `kyc.capture` OR `kyc.approve`.
>
> Not broken today — both holders happen to hold the 360 read — but it admits **three roles who hold
> neither KYC code** (BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR), each of whom
> gets a nav entry leading to a refusal. And since RBAC Phase 3 an office can define a role holding
> `kyc.approve` **without** the 360 read, for whom the queue would be invisible while the API served it.
> Same class as § 1.61.

### 9. They press "Run screening" on a `SUBMITTED` row

`POST /kyc-records/:id/run-screening`. The watchlist check runs **before** the status transition,
deliberately: a screening failure leaves the record retriable in `SUBMITTED` rather than stranded in
`SCREENING` with no results.

The record moves to `SCREENING`, then `COMPLIANCE_REVIEW` (or `EDD`, if enhanced due diligence applies).

### 10. The result appears on the row

| what came back | what the screen shows |
|---|---|
| a blocking finding | a red `role="alert"` badge: **BLOCKED**, each reason listed, and a sentence saying approval is not available |
| a finding needing judgement | an amber badge: **REVIEW REQUIRED**, reasons listed, plus a mandatory free-text box to record why it is not a true match |
| a provider/configuration fault | its own `role="alert"` line naming the configuration problem |
| **nothing found** | **nothing at all** — see below |

> ### ⚠ DEFECT 4 — "clean" is never stated, only implied
>
> `hold.level === 'NO_HOLD'` renders **null**. So a clean result is two absences: no badge, and a status
> that has moved to `COMPLIANCE_REVIEW`. The approve button simply becomes enabled.
>
> The status column does distinguish "not yet screened" (`SUBMITTED`) from "screened, awaiting a
> decision" (`COMPLIANCE_REVIEW`), so this is **not** the "screening that finds nobody is
> indistinguishable from screening that cleared everybody" failure — the information is on screen. But it
> is inferred from two negatives rather than said, which is the same shape as the empty-calendar case:
> an absence that must be read as an answer.

### 11. They approve or reject

* **Approve** — `POST /kyc-records/:id/approve`. The record becomes `APPROVED`, the **customer becomes
  `ACTIVE`**, and a review date is written for the periodic refresh. Blocked outright while a `BLOCKED`
  hold stands; while a `REVIEW_REQUIRED` hold stands the button stays disabled until a reason is typed.
* **Reject** — `POST /kyc-records/:id/reject` with a **mandatory reason**; the button is disabled until
  one is typed. The record becomes `REJECTED`. **The customer stays `PENDING_KYC`** — it is not
  activated and not closed.

In a COMBINED-duty office the officer who captured the file may approve it, by declaring a reason that
lands on the record — and the screen says in its own words that a combined-duty declaration and a
screening-hold acceptance are two different things.

### 12. The customer's state at every step

| stage | KYC record | Customer |
|---|---|---|
| created | `DRAFT` | `PENDING_KYC` |
| submitted | `SUBMITTED` | `PENDING_KYC` |
| screening run | `SCREENING` → `COMPLIANCE_REVIEW` (or `EDD`) | `PENDING_KYC` |
| approved | `APPROVED` | **`ACTIVE`** |
| rejected | `REJECTED` | `PENDING_KYC` (unchanged) |

---

## The three behaviours she expects, verified

### (a) Does it appear in the screener's queue, and do they learn it is waiting?

**Appears: WORKS.** `GET /kyc-records` is unfiltered by the screen, so a `SUBMITTED` record is in the
queue the moment it is submitted, with a "Run screening" button on its row.

**Told: DOES NOT WORK.** The only pending-KYC notification goes to the customer's OWNER — the capturing
officer. No book-wide notification exists for a file awaiting a decision. A Compliance Officer learns of
work only when a possible MATCH has already been raised; a clean file waiting for approval reaches
nobody. **They must go looking.** (Defect 2.)

### (b) Does the result come back on its own and say plainly whether there are hits or none?

**On its own: DOES NOT WORK — by design, and worth a decision.** Screening is a button. `submit`
transitions and stops; a human must open the queue and press "Run screening". (A separate 4-hourly
scheduler re-screens EXISTING customers, which is a different obligation.)

**Says hits plainly: WORKS.** BLOCKED / REVIEW REQUIRED, each reason listed, the blocking case as an
`alert`.

**Says "none" plainly: WORKS BUT IS UNFINDABLE.** Nothing is rendered for a clean result; it is read off
the status column and the enabled button. (Defect 4.)

### (c) Is the result recorded with everything the standing decision requires?

| required | recorded | where |
|---|---|---|
| value before and after any change | **YES** | `CustomerIdentifierCorrection`, both sides encrypted |
| who screened | **YES — in the audit log, not on the record** | `AuditLogEntry` CREATE on `ScreeningResult`, naming the actor. `ScreeningResult` itself has **no `screenedByUserId` column** |
| when | **YES** | `ScreeningResult.screenedAt` |
| the LIST VERSION used | **YES** | `ScreeningResult.datasetVersion`, plus `listSource` and `provider` |
| the previous result alongside the new one | **YES** | `CustomerIdentifierCorrection` holds both, `onDelete: Restrict` on the prior result so it cannot be removed |
| who reviewed a possible match | **YES** | `ScreeningMatch.reviewedByUserId`/`reviewedAt`, and `closedByUserId`/`closedAt` |
| the final decision | **YES** | `KYCRecord.approvedByUserId`/`approvedAt`/`status`, reject reason in the audit row |

**All seven are recorded.** One qualification, stated precisely because it is the kind of thing that
gets reported as complete and is not quite: *who screened* lives in the audit trail rather than on the
result row, and the audit row does **not** carry `datasetVersion` while the result row does — so
answering *"who screened this customer, against which list version"* means joining the two on the
result id. That is a real answer, queryable and immutable, and it is one join rather than one read.

---

## What follows from this document, in order of consequence

1. **Show the KYC stage on the customer's page** (defect 1). This is the one that makes the path
   followable, and it is why she could not follow it.
2. **Notify whoever can decide, not whoever captured** (defect 2) — a book-wide source gated on
   `kyc.approve`, beside the three that already exist.
3. **Say "screened, nothing found"** instead of rendering nothing (defect 4).
4. **Re-gate the queue's nav entry** on the codes the route actually requires (defect 3).
5. **Make the sanctions intro paragraph conditional** on `watchlistReady`, so the screen does not assert
   and retract on the same page.

**Nothing above was changed.** This document is the measurement; the order is the owner's.
