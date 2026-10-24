# WHAT AN INSURER IS CALLED — the twelve call sites, who reads each, and the one thing to decide

Batch nine, item 3. Prepared so the owner's answer is a small change rather than a project.
**Nothing in this batch changed behaviour** — which name wins is a decision, and she is resting.

## THE HEADLINE, AND IT IS SHORTER THAN EXPECTED: THERE IS NOTHING TO DECIDE

The question "which name wins" is **already decided, already written down, and already
implemented**. `apps/api/src/repositories/insurer-identity.ts` states it in prose and in code:

> 1. **THE REGISTERED COMPANY** — `Insurer.insuranceCompany` … *Most authoritative: it is the
>    company's own record of itself, entered against its own licence.*
> 2. **THE GLOBAL CATALOGUE** — `InsurerMaster`. Names only.
> 3. **THE OFFICE'S OWN ROW** — what this office typed, and the only answer for a company that has
>    not registered.

**That is decision 48's shape exactly**, one entity over: the official record wins and the
locally-typed free text is the fallback. **Nothing in the code contradicts it** — checked, and the
only prose anywhere on the subject is the passage above plus `deriveInsurerView`'s own comment
saying *a registered company outranks the catalogue*. So there is no menu of options to put to her
and no judgement for her to make about precedence.

**WHAT IS WRONG IS NOT THE RULE BUT THAT A SECOND IMPLEMENTATION SKIPS STEP 1.** `insurerName()`
reads the catalogue and the office's own row and **never consults `insuranceCompany`**. It is not a
competing policy — it predates the registered-company link and was never widened. So the remedy is
mechanical: route the twelve call sites through `resolveInsurerCompanyFacts`, which already answers
correctly.

**SO THE ONLY THING THAT NEEDS HER IS WHETHER TO SPEND THE CHANGE NOW OR WITH THE LINK** — and the
ordering constraint below answers that too.

## NOTHING RENDERS A WRONG NAME TODAY, AND THAT HAS A TRIGGER DATE

Measured 2026-10-24: **no `Insurer` row on either database carries an `insuranceCompanyId`** — dev
0 of 19, db-test 0 of 306 — because linking an insurer to a registered company is itself one of the
capabilities batch five's triage recorded as unreachable from the product (register entry 120,
deferred to the gateway / company-registry module).

So both readings agree on every row that exists. **The divergence begins on the first link.**

## THE TWELVE CALL SITES, WHAT EACH PRINTS, AND WHO READS IT

Two further `insurerName` matches in the tree are prose in comments, not calls — the true figure is
**twelve**, not the "thirteen" batch eight reported.

### FIVE REACH A DOCUMENT THAT LEAVES THE OFFICE — this is the half that matters

| # | call site | what it prints | who reads it |
|---|---|---|---|
| 1 | `finance/invoice-document.service.ts` | the insurer's name on the **invoice** | **the customer**, as a bill |
| 2 | `policy/certificate-of-insurance-document.service.ts` | the insurer on the **certificate of insurance** | **a third party relying on it** — a landlord, a lender, a regulator. That document exists to be relied upon |
| 3 | `policy/policy-schedule-summary-document.service.ts` | the insurer on the **policy schedule summary** | **the customer** |
| 4 | `recommendation/recommendation-report-document.service.ts` | each quoting insurer on the **broker recommendation report** | **the customer**, as the basis of a purchase decision |
| 5 | `comparison/comparison.service.ts` | the insurer on each row of the quote comparison **view** — which the comparison DOCUMENT then flattens | **the customer** (document) and the placement officer (screen) |

**BATCH EIGHT NAMED TWO OF THESE AND THERE ARE FIVE.** It said *the invoice document and the
certificate of insurance*; the policy schedule summary, the recommendation report and the
comparison all carry the same name through the same function. Corrected here rather than only in a
report, because the figure is what makes the case for fixing it.

### SEVEN ARE INTERNAL

| # | call site | what it prints | who reads it |
|---|---|---|---|
| 6-8 | `commission/commission-agreement.service.ts` (×3) | the insurer on a commission agreement view | the broker, on `/commission` |
| 9 | `repositories/commission.repository.ts` | the insurer in the rate-resolution read | nobody directly — feeds calculation |
| 10 | `repositories/financial-report.repository.ts` | the insurer on the finance report | the broker |
| 11 | `repositories/invoice.repository.ts` | the insurer on the invoice LIST | the broker |
| 12 | `repositories/loss-ratio.repository.ts` | the insurer on the loss-ratio report | the broker |

## WHAT EACH PRECEDENCE WOULD PRINT ON AN INVOICE

Take an insurer whose office-local `legalName` is `Yarmouk Ins. Co.` (what a clerk typed) and whose
linked registered company's `legalName` is `Al-Yarmouk Insurance Company PLC` (what the company
entered against its own licence).

| reading | the invoice prints | consequence |
|---|---|---|
| **what `insurerName` does today** | `Yarmouk Ins. Co.` | the office's own shorthand on a document the customer keeps, while `/insurers` shows the registered name — two names for one company, and the one on the paper is not the one on the licence |
| **what `resolveInsurerCompanyFacts` does** (the decided rule, decision 48's shape) | `Al-Yarmouk Insurance Company PLC` | the name the company registered under, on every surface |
| local-wins-by-decision (**not** the current rule and contradicted by the prose above) | `Yarmouk Ins. Co.` everywhere | would require changing `resolveInsurerCompanyFacts` and `/insurers` too, and reverses a recorded decision |

The middle row is the only one that needs no decision reversed.

## THE ORDERING CONSTRAINT — recorded in BOTH register entries, in the same words

**The name precedence is fixed IN THE SAME BATCH that makes linking possible, never after it.**

Two deferrals sit in different places — entry 120 defers the link to the gateway / company-registry
module, entry 132 records this precedence — and **the hazard is that the link ships first**. The
moment the first insurer is linked, five documents that leave the office start printing a name that
is not the one on the company's licence, and nothing fails: no test, no gate, no type. A note in
one entry only is how this gets missed, so it is written into both.

## WHAT A FIX WOULD COST, SO THE SIZE IS KNOWN

Twelve call sites, each a one-line substitution — but **`resolveInsurerCompanyFacts` needs the
`insuranceCompany` relation selected**, which `insurerName`'s callers do not all include today.
`InsurerRepository.namesForInsurerIds` (added batch eight) already selects it and already returns
the resolved name, so the ten read-path sites can route through that; the two document services
that hold a `policy.insurer` object need their own `include` widened. That is the whole change.
