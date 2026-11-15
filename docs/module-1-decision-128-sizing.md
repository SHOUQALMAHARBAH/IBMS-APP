# Module 1 — decision 128 («التجديد قيد الدراسة») measured against the schema, before it is wired

**Measured 2026-11-15** against `main` at `04693c99`, by reading the code and querying the two
live databases. **Nothing in this paper is built.** It exists because message 39 §3 is a feature
that «ships whole or not at all», and because §3 itself asks two questions to be *measured and
reported* before anything is wired — one of which changes the design.

Read this before starting decision 128. Every figure names how it was counted.

---

## 1. The question §3 asks outright: does `DeclaredAct` accept this declaration?

**No. It refuses it on four counts, and the fourth is not a CHECK.** Measured on dev with
`pg_get_constraintdef` rather than read off the schema file:

| Constraint | What it demands | Decision 128's standing declaration |
|---|---|---|
| `DeclaredAct_reason_meets_the_shared_floor` | `length(btrim(reason)) >= 10` | **has no free-text reason** — §3 says so, and the act it records is not a breach needing one |
| `DeclaredAct_identifies_what_it_declares` | `articleRef`, `permissionCode`, `entity`, `entityId`, `transactionRef`, `actorNameShown` all non-blank | **has no article being breached**, and **no single related record** — it governs every future issuance act on the term, not one transaction |
| `DeclaredAct_articleTextShown_is_prose` | `>= 20` characters of article text | **there is no article text**, for the same reason |
| `DeclaredActSite` (enum, not a CHECK) | one of decision 126's **seven** sites | decision 128's declaration **is not one of the seven** |

⛔ **So it is not bent.** §3's instruction is explicit, and the four above are not incidental —
they are what make `DeclaredAct` a register of *admitted regulatory breaches*. A standing
declaration that no article is being breached is the opposite kind of record, and widening the
site enum would put it inside a table whose every other row admits a breach.

### The smallest shape that holds it with the same hardening

A new table. The hardening §3 names is **already available to copy**, which is why this is small:

| What §3 requires | Where the shape comes from |
|---|---|
| the text as displayed | `DeclaredAct.articleTextShown` — stored verbatim, never a FK to editable text |
| the actor and their name | `DeclaredAct.actorUserId` + `actorNameShown`, name resolved through `displayNameForUserId` (decision 48) |
| the timestamp | `DeclaredAct.actedAt` |
| the network address | `DeclaredAct.networkAddress`, nullable, via `common/client-ip.ts`'s `clientIpForRecord` |
| append-only | **measured on dev**: triggers `declared_act_no_update` and `declared_act_no_delete` |

Plus two things `DeclaredAct` does not need and this does:

- **It hangs off the TERM, not a transaction.** Decision 128: «a standing declaration exists for
  **that term**». One per `BrokerLicense` row, so a unique on `(brokerLicenseId)`.
- **RLS ENABLED and FORCED.** Criterion 9 is «another office's account sees neither the proof nor
  the declaration». `LegalValue` and `DeclaredAct` are the only two FORCED tables today; a
  register of who swore the Central Bank had refused nothing belongs with them, not beside a
  table whose owner is exempt.

---

## 2. What the code does today, re-measured

| Site | Reading |
|---|---|
| `broker-license.config.ts` `renewalFiledOnTime` | compares `renewalRequestedAt` with art. 11's deadline — **a date only, no document** |
| `license-standing.config.ts` | `RENEWAL_PENDING` returns `mayPractise: true`, in **two** situations (before expiry with a filing, and after expiry with a timely one) |
| `license-gate.service.ts` | the gate reads `mayPractise` alone |
| `RegulatoryActionKind` | `SUSPENSION · CANCELLATION · REINSTATEMENT` — **no «إشعار نقص», no «رفض تجديد»** |
| `BrokerLicense` | has `renewalRequestedAt`; **no proof document, no reference number** |

⟶ **A date typed into a field opens all six issuance acts**, exactly as decision 128 §8 recorded.

### `RENEWAL_PENDING_RULE_BASIS` renders nowhere, and that is why it stays until 128 lands

`git grep` over `apps` + `packages` on 2026-11-15, excluding comment lines: **its only non-comment
occurrence is its own declaration.** Measured 2026-11-15: nothing imports it, and it reaches no
response and no screen. So replacing its
text carries **no Arabic and no render site** — and the repository's own standing rule says it goes
*when 128 is built*, because deleting the basis before its replacement lands leaves the rule with
no account of where it came from. **Left in place deliberately.**

---

## 3. The stamp: four models and one path with no model

The six gated acts are `LICENCE_GATED_ACTS` in `license-gate.service.ts`. Mapped to the record
each creates, and to the generated document each produces:

| Act | Record stamped | Generated document |
|---|---|---|
| `PLACE_POLICY` | `Policy` | `policy_schedule_summary` |
| `RENEW_POLICY` | `Policy` (a renewal is a new row) | `policy_schedule_summary` |
| `REQUEST_QUOTES` | `RFQ` | **none** |
| `ISSUE_RECOMMENDATION` | `Recommendation` | `recommendation_report` |
| `INCREASE_COVER` | `Endorsement` | **none** |
| `ISSUE_CERTIFICATE` | 🔴 **no model** — the certificate is a `Document` | `certificate_of_insurance` |

**So the stamp is four models plus one document-only path**, and the sixth act is the awkward one:
there is no `CertificateOfInsurance` row to carry a column. ⚠️ That has to be decided before the
migration, not during it.

**Three of the six produce a customer-facing generated document.** ⛔ §3 forbids printing the stamp
on any of them in this batch — that is the owner's question, and this table is what she needs to
answer it. (`quotation_comparison` and `invoice` also exist but are produced by neither of the six.)

---

## 4. The new permission moves four pinned totals

The catalogue is **233** today. A standing-declaration code makes it 234, and the total is pinned
in three spec files plus a generated fixture — `git grep -ln 'toBe(23[0-9])' -- apps packages`:

- `apps/api/test/provider-self-administration.e2e-spec.ts` — **an e2e**, which is why the full
  `npm run test:e2e` must run on any catalogue change; a targeted run is only as good as the
  search that chose it
- `apps/web/lib/admin/permission-matrix.test.ts`
- `packages/db/prisma/seed-data/permissions.spec.ts`
- plus `apps/web/e2e/fixtures/role-permissions.ts` (generated) and the read-only Arabic mirror

Under decision 131 it lands **«جديدة» and granted to nobody**, so an office under study issues
nothing until its administrator grants it and a holder declares once. ⚠️ Its Arabic description
is agent-composed and goes on `AWAITING_OWNER_REVIEW` — which is **empty today**, so it refills by
name, exactly as that list is designed to.

---

## 5. The strings are ready — all but one, which already ships

Checked against `docs/decision-133-strings-ratified.md`:

| String | In decision 133? |
|---|---|
| «إثبات تقديم طلب التجديد» · «تاريخ تقديم الطلب» · «رقم الوارد أو الرقم المرجعي» | ✅ |
| the declaration sentence «أُقرّ بأنه لم يصل المكتبَ من البنك المركزي…» | ✅ |
| «إشعار نقص» · «رفض تجديد» | ✅ |
| «صدرت والتجديد قيد الدراسة» | ✅ |
| «قيد التجديد» (the state word) | not in 133 — **it already ships** as `RENEWAL_PENDING`'s label |

⛔ **The refusal message naming the administrator is NOT in 133 or 134.** It is the one empty cell
this feature still has, and under decision 125 it is hers or it is sliced from the same screen.

---

## 6. What is already true and must not be rebuilt

- **The five continuing categories are already a declared list** — `LICENCE_UNGATED_ACTS` — and
  `license-gate.e2e-spec.ts` carries five POSITIVE assertions that they still go through, which is
  the right shape: an absence of refusal is not something a negative test can show.

  ⚠️ **But measure the unit before planning on it.** That file holds **exactly ONE `it()`** —
  *«refuses ز.١'s acts under a recorded suspension and leaves ز.٢'s work running»* — so the five
  are assertions inside one test, not five tests. **And its scenario is a recorded SUSPENSION, not
  a lapsed licence**, which is a different state from all three of decision 128's. ⟶ Criterion 6
  («what continues, continues in all three states») therefore needs **three new scenarios**, not a
  line added to an existing one; this file supplies the shape and the five-assertion list, and
  nothing more.
- **`RegulatoryAction` already folds an append-only series on a TOTAL comparator**
  (`effectiveFrom` → `recordedAt` → `id`), so the two new kinds need no new ordering.
- **The gate's `branch` parameter is already required** and accepts a thunk, so adding a condition
  to `deriveLicenseStanding` does not touch the 8 call sites.

---

## 7. Why this is a paper and not a commit

Measured size: one migration touching **an enum, `BrokerLicense`, a new FORCED append-only table,
and four models plus a document path**; one new permission moving **four pinned totals** and
forcing a full ~22-minute e2e run; a rewrite of `deriveLicenseStanding`; a screen; and **nine
criterion tests, each planted**. Message 39 §5 forbids stopping inside §3 or shipping its server
half without its screen, so it starts as one piece or not at all.

**The two findings that change what gets built are §1 (a new table, not `DeclaredAct`) and §3 (the
sixth act has no row to stamp).** Both would otherwise have been discovered mid-migration.
