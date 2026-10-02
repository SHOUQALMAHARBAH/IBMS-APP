# Identifiers on screen — two different defects, measured per screen

> **CORRECTION, 2026-10-02 — defect B is now mostly CLOSED, and the numbers below are the BEFORE
> state. Left in place rather than edited, because the before state is what explains why the pickers
> were built.**
>
> Seven of the nine REQUIRED typed identifiers now point at a picker, and `/payment-channels`'
> insurer branch went with them. Re-measured: **32 typed identifiers → 25, and 9 REQUIRED → 2.**
>
> The two that remain are both on `/audit-trail` and neither is fixable by the six pickers that now
> exist: `wfEntityId` is POLYMORPHIC across fifteen workflow entities, and `documentId` names a
> `Document`, which has no search route at all. Both are recorded in README § Known gaps with what
> closing each would need.
>
> Defect A — identifiers RENDERED in table cells — is UNCHANGED and still waits on broker question 16.
>
> Re-run `python scripts/measurements/typed-identifier-inputs.py` rather than quoting either figure.

**Measured 2026-10-01. NOTHING FIXED.** The owner named thirteen screens and asked what an employee is
supposed to do with an id. The per-screen answer is below; the order is hers, and some of it waits on
broker question 16, which decides what these things are called.

## The headline: her thirteen screens are TWO defects, not one

Only **four** of the thirteen are inside the deferred rule-2 set. The other nine show no identifier in
any table cell at all — because what they have is a **required raw-uuid input**, which is a different
defect with a different fix and a worse consequence.

| | defect | count | consequence |
|---|---|---|---|
| **A** | an identifier RENDERED in a cell | **29** instances, **20** screens | a reader sees a useless string |
| **B** | an identifier a person must TYPE IN | **32** inputs, **20** screens, **9 required** | where required, the screen **cannot be used at all** |

Re-run A with `python scripts/measurements/rendered-identifiers.py`, B with
`python scripts/measurements/typed-identifier-inputs.py`.

**A is 29, not 28.** The count moved since the deferral. That is the standing rule about published
numbers doing its job: re-run it, do not quote it.

---

## Her thirteen, one at a time

| screen | inside the 29? | what its API supplies today | the fix |
|---|---|---|---|
| `dashboards/sales` | **no** | — | **B**: two required-shaped `branchId`/`insurerId` text inputs |
| `dashboards/policy` | yes (1) | `policyNumber ?? policyId` | **THE IDENTIFIER IS CORRECT.** It prefers the policy number and falls back only when one is absent — which is a real state between placement and issuance. Also **B** (two filter inputs). |
| `dashboards/claims` | **no** | — | **B** (two filter inputs) |
| `dashboards/financial` | **no** | — | **B** (two filter inputs) |
| `dashboards/compliance` | **no** | — | **B** (one filter input) |
| `dashboards/insurer-employee-performance` | yes (2) | `insurerId`, `employeeId` — **no names in the payload** | **API CHANGE** first; substitution is impossible until the route sends a name. Also **B**. |
| `documents` | **no** | — | **B**, and the worst of them: **two REQUIRED `policyId` inputs** |
| `data-sharing-approvals` | **no** | — | **B** (one filter input) |
| `consent` | yes (2) | `leadId`, **no lead name** | **API CHANGE**. Also **B** (two filter inputs). |
| `sales-performance` | **no** | — | **B** (two filter inputs) |
| `employee-performance` | **no** | — | **B**: ONE REQUIRED `employeeId` and nothing else. The screen is unusable without pasting a uuid. |
| `insurer-performance` | **no** | — | **B**: ONE REQUIRED `insurerId` and nothing else. Same. |
| `retention-disposal` | yes (4) | `customerId`, and two `retentionScheduleItemId` | **MIXED**: the customer needs a name from the API; the schedule-item ids are internal plumbing a reader has no use for and arguably should not be rendered at all. Also **B** (three filter inputs). |

**Her instinct was right and her list was examples, not an inventory** — but the correction runs the
other way from last time: the nine she named that are NOT in the 29 are the more serious ones.

---

## Defect B in full: the nine screens that cannot be used without a uuid

| screen | field | |
|---|---|---|
| `audit-trail` | `wfEntityId` | REQUIRED |
| `audit-trail` | `documentId` | REQUIRED |
| `documents` | `policyId` | REQUIRED |
| `documents` | `summaryPolicyId` | REQUIRED |
| `employee-performance` | `employeeId` | REQUIRED |
| `information-assets` | `ownerUserId` | REQUIRED |
| `insurer-performance` | `insurerId` | REQUIRED |
| `payment-channels` | `ownerId` | REQUIRED |
| `regulatory-compliance` | `ownerUserId` | REQUIRED |

**The fix for every one of them already exists**: the one field built the same day
(`docs/decision-one-field-finds-a-customer.md`), pointed at a different entity. Each needs a SOURCE —
employee, insurer, branch, policy, user — and each source needs the same four anti-browsing conditions
decided for *that* set, because the floor is a judgement about how much of a set one keystroke may
return. A staff list is tens of people; a policy book is not.

**Two VERIFIED-BY-HAND false positives**, excluded by name with their reason rather than by a cleverer
regex:

* `employees` → `nationalId` — a number read off a document, on the person-registration form.
* `settings/email` → `tenantId` — a Microsoft 365 tenant an administrator pastes from Azure.

What separates them from a finding is what the value MEANS to the person typing it, which no pattern can
see. A third of that kind gets added to the list with its reason, so the exclusions stay readable as
judgements rather than becoming a filter nobody can audit.

---

## Why "replace the id with a name" must not be taken at face value

It was true for twelve of fourteen last time, and it is **false for at least two here**:

* `dashboards/policy` renders `policyNumber ?? policyId`. That is already the right behaviour — the
  number when there is one, the id only in the window where there is not.
* `retention-disposal`'s `retentionScheduleItemId` has no name to substitute. A retention schedule item
  is not a thing with a name; the honest fix is for the ROW HEADER to carry the identity (which
  customer, which category) and the id to be dropped, not renamed.

So the three outcomes per instance are **substitution**, **an API change first**, or **the identifier is
correct and the row header is what should carry identity** — and the third is the one a blanket sweep
gets wrong.

---

## What is NOT claimed

* **Defect A's 29 is bounded by its detector.** Its header lists the known blind spots. A thirtieth is
  likelier than a clean zero.
* **Defect B's 32 is bounded by its detector too**, and its three blind spots are stated in the script:
  a state variable not named `*Id`, an object field whose trailing segment is not id-shaped, and a
  screen taking an id from the URL (usually correct — a link carries it and nobody types it).
* **No screen was changed.** Several are also waiting on broker question 16 for what these things are
  called, which has to be settled before a label is written.
