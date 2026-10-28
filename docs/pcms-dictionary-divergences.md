# Divergences from the approved PCMS data dictionary

**`PRIV-SRS-02_Data_Dictionary_and_Entity_Model.xlsx` is the organization's APPROVED
field-level dictionary** — 15 sheets, 14 entities — and `ibms-brain` carries the standing
rule that decides how this file is read:

> IBMS IMPLEMENTS PCMS AND NEVER WRITES ITS OWN PRIVACY RULES.

So where this product and that dictionary disagree, the disagreement is a **decision**,
recorded here with its reason and a review date — never a silent correction in either
direction.

**Where the document lives.** `S:\Project\DataBase& Req\PRIV-SRS-02_…xlsx`, with copies
at `S:\Project\PROJRCT\OS-Brain_Asem\platform-brain-template-or\platform-brain-template\`
and the companion form and procedure at `S:\Project\نماذج\` and `S:\Project\الإجراءات\`.
It is **not in this repository and not on the C: drive** — a path given as
`~/mnt/platform-brain-template/` does not exist, and the real location was recovered from
a shortcut in Office's Recent list. Read it with
`python scripts/measurements/read-xlsx.py <path> IncidentReport`; the sheet is the
authority and this file is only the record of where we differ from it.

---

## The rule this file exists to enforce

**A DIVERGENCE WHOSE REASON IS ONLY PROSE IS ONE REFACTOR AWAY FROM BEING WRONG.** Every
row below names the test that pins its reason. The day somebody removes the reason, that
test fails loudly — instead of the thing the divergence was protecting quietly ceasing to
exist, which is the failure the divergence was accepted to avoid.

That is not a general principle applied here; it is the specific shape of entry 1. Keeping
a fourth severity value is only defensible while that fourth value carries a deadline, so
the test asserts exactly that and nothing else.

---

## 1. `IncidentReport.severity` — FOUR values, not the dictionary's three

**Owner's decision, 2026-10-28: it stays at four. DECLARED, not resolved.**

| | |
|---|---|
| **The dictionary says** | `severity \| Enum \| Required \| Low / Medium / High.` — *"Initial rating by reporter/DPO"*, sourced to `PRIV-FRM-06`, whose § IV offers «☐ منخفض ☐ متوسط ☐ مرتفع» — three boxes. |
| **We carry** | `severity String` on `IncidentReport`, with `INCIDENT_SEVERITIES = ['low','medium','high','critical']` — a free `String` column and **four** values. |
| **Why** | `critical` is the ONLY value that carries a containment deadline. `requiresContainmentSla(severity)` returns `severity === 'critical'` and nothing else, and `isContainmentOverdue` measures four hours from `reportedAt`. Narrowing the vocabulary to three would **retire the only containment deadline in the module** as a side effect of a type change. |
| **Pinned by** | `incident.config.spec.ts` — «المهلة الأربع ساعات معلّقة على `critical` وحدها» / *the four-hour target hangs on `critical` alone*. It asserts `requiresContainmentSla` true for `critical` and false for each of the other three BY NAME, and that no other member of `INCIDENT_SEVERITIES` carries a target. |
| **Review** | 2027-04-28, or earlier if `PRIV-SRS-02` is reissued, or immediately if anybody proposes narrowing the list. |

**Measured before this was recorded, because "four values" could have been a claim about
one DTO rather than about the column** — the column is a free `String`, so validation is
the only thing holding the vocabulary:

| Path that writes `IncidentReport.severity` | Through the DTO? |
|---|---|
| `POST /incidents` → `IncidentService.create` → `IncidentRepository.create` | **YES** — `CreateIncidentDto` carries `@IsIn(INCIDENT_SEVERITIES)`. The only production path. |
| `IncidentRepository.recordCoSign` / `recordSeniorManagementNotified` / `recordAffectedSubjectsNotified` | n/a — measured: **zero** `severity` writes across all three `updateMany`s. |
| `apps/api/scripts/seed-demo.script.ts:2318` | **YES** — it goes through `postAs`, which is a real HTTP request, so it is the same DTO. Its own list is the same four. |
| `packages/db/prisma/seed.ts` | n/a — the main seed writes **no** incident at all. |
| `compliance-dashboard.e2e-spec.ts:258`, `dpo-workspace.e2e-spec.ts:376` and `:391` | **NO** — raw Prisma creates that bypass the DTO. **Test fixtures only**, and all three use valid values (`low`, `high`, `low`). |

**So the answer is: only the DTO, in production.** The three test-only bypasses are named
rather than left unsaid, because they are the paths that would admit a fifth value without
any gate noticing.

**AND THE COLUMN IS DELIBERATELY NOT CONVERTED TO A PRISMA ENUM.** That would be a
migration over existing rows and a vocabulary change on a shipping column, and the owner
has not asked for it. If it is ever done, the enum must carry **four** members for the
reason above, and this row is where that is written down.

### 1a. The wording divergence under it — «مرتفع» against «عالية»

`PRIV-FRM-06` § IV reads **«مرتفع»**; the product ships **«عالية»**
(`incSeverityHigh` in `apps/web/lib/i18n/translations/compliance-risk.ts`).

**Neither string changes.** The rule is that what is built is the reference, and all four
labels have shipped all along — `incSeverityLow / Medium / High / Critical` →
منخفضة · متوسطة · عالية · حرجة, including a label for the fourth value the dictionary does
not have.

Recorded so that nobody later "corrects" it in either direction without a decision:
changing the product's string is a change to copy the owner has already approved, and
changing the form is not ours to make.

---

## What Group 7 appends here

The brief's group 7 is a COMPARE-AND-REPORT pass over all fourteen entities, under the
owner's own instruction: «اذا في شي مبني قارن بينهم و احكي ايش الناقص» — compare and say
what is missing, and change nothing structural. Its output belongs in this file, one
section per entity, in this same shape: what the dictionary says, what we carry, the
verdict, and — where we diverge rather than merely lack a field — the reason and the test
that pins it.

A row that says only *missing* needs no test. A row that says *differs, deliberately* does.

**IT IS ROUTED TO THE PRIVACY MODULE AND IS NOT MODULE 0-c's — 2026-10-28.** `docs/deferred-register.md` § *RECORDED, NOT BUILT — 2026-10-28, module 0-c group 7* carries the entry, with four measured starting points and one correction to its own premise: the *fourteen entities* figure comes from the brief and was never re-derived, so derive it from the PCMS documents rather than inheriting it. Recorded in both places deliberately — a reader who opens THIS file is looking for the findings, and a reader who opens the register is looking for what is owed; a routing that lives in only one of them is invisible from the other.
