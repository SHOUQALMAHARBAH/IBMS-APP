# Module 1, message 35 — the tables that are the owner's

**11 November 2026.** Four tables message 35 routes to the owner rather than deciding, plus the one
measurement that stops §4.4 being wired in this batch. Every figure here was measured on the dev
database or by reading the schema on 11 November 2026, and the command is beside each one.

---

## 1 · §4.4 — THE FIVE ART. 15/d EXEMPTIONS AGAINST THE SCHEMA

Decision 129 §3 sets the rule and gives an expectation per exemption:

> **النظام يسم وحده حين تكون كلُّ واقعةٍ يتوقّف عليها الإعفاء مسجَّلةً عنده أصلاً. فإن نقصت واقعة
> واحدة، يُعرَض الإعفاء اختياراً، واختيار الموظف هو إعلانه لتلك الواقعة.**

The measurement, and **it disagrees with the expectation in three of the five**. Every absence in
the table below was read off `packages/db/prisma/schema.prisma` and the dev database **on 2026-11-11**
— so each "there is no such field" is a statement about the schema on that date and nothing more,
and the re-run wins over the reading:

| # | the exemption | the facts it depends on | the owner expected | **MEASURED** | why |
|---|---|---|---|---|---|
| **1** | renewal · individual medical | it is a renewal · it is individual medical | **the system tags it** | 🔴 **a CHOICE** | *renewal* IS a recorded fact (`Opportunity.isRenewal`, `renewalCaseId`). **`individual medical` is not.** `MEDICAL_HEALTH` is ONE catalogue line with no individual/group split — unlike LIFE, which has `LIFE_INDIVIDUAL` and `LIFE_GROUP`. `Customer.customerType` (INDIVIDUAL \| CORPORATE) is a different fact: who the policyholder is, not what the cover is. |
| **2** | renewal · group medical · at most 3 consecutive years | renewal · group medical · **the consecutive-year count** | *tagged if the count is recorded; otherwise a choice* | 🔴 **a CHOICE** | the count is **not recorded anywhere**. `RenewalCase.policyId` points at the policy being renewed, and the renewal produces a NEW opportunity and a NEW policy **with no link back** — measured: zero `previousPolicy`/`renewedFrom`/`renewalCount` fields in the schema. So the chain is one hop at most and "three consecutive" is not countable. |
| **3** | contracts with defined benefits and coverages | the product carries that tag | **the system tags it from the tag** | 🔴 **a CHOICE, and the tag does not exist** | there is no product tag, and the LIST the tag would be drawn from is `DEFINED_BENEFIT_CONTRACT_LIST` — one of the three codes the Central Bank has not issued, which ships **dormant with no value**. A dormant field tags nothing (criterion 6). |
| **4** | motor/medical/goods · annual premium ≤ 2,000 JOD · *relying on three insurers' underwriting policies* | the branch · the premium · the condition | *a choice, offered only when the branch and the premium hold* | ⚠️ **a CHOICE, and the PREMIUM cannot gate the offer** | the branch IS known (`RFQ.insuranceLineId`, 74/74 and 89/89 populated). **The premium is not, by construction**: art. 15/d is about SENDING the request, and `Quotation.premium` comes back AFTER. Nothing on `RFQ`, `Opportunity` or `InsuranceProgramLine` holds a premium — `sumInsuredBasis` is a sum insured, and `Prospect.expectedPremium` is a pre-customer expectation two hops away and nullable. ⟶ **the system can pre-filter by BRANCH only; the premium is the employee's declaration.** |
| **5** | at the customer's request, per the approved notification means | the customer's request | *a choice, with evidence* | ✅ **a CHOICE** — as expected | there is no field for it and there should not be one before the shape is decided. `CommunicationLog` exists on the RFQ and is the obvious home for the evidence, which is a design question rather than a measurement. |

### 🔴 AND THE MEASUREMENT THAT STOPS THIS BEING WIRED IN THIS BATCH

| what | measured on dev, 2026-11-11 | command |
|---|---|---|
| RFQs | **89** | `SELECT count(*) FROM "RFQ"` |
| RFQs with FEWER than three insurers | **89** | a `GROUP BY` over `RFQInsurer` |
| RFQs with EXACTLY ONE insurer | **89** | the same |
| opportunities that are renewals | **0 of 90** | `count(*) FILTER (WHERE "isRenewal")` |
| `InsuredPerson` rows | **0** | `SELECT count(*) FROM "InsuredPerson"` |
| api e2e spec files that create an RFQ | **7**, and **every `insurerIds` literal in them holds ONE id** | `grep -n 'insurerIds: \[' apps/api/test/*.e2e-spec.ts` |

⟶ **Art. 15/d's window would appear on 89 of 89 quote requests**, exemptions 1 and 2 can never apply
(zero renewals), exemption 3's list is dormant, exemption 4's premium is unknowable at send time and
exemption 5 has no evidence field. **So on today's data every single RFQ gets the window.**

That is precisely the failure decision 123's SECOND form was corrected for — «نافذةٌ على الشغلِ
العاديّ» — and the owner's own rule, stated in that decision and repeated in message 35 §2, is:

> **before any window, ask whether the act is EXCEPTIONAL or the routine work; routine takes one
> standing declaration and a tag, and the measurable test is to count the clicks added to the most
> frequent transaction.**

Counted: **+1 window, +1 written reason, +1 hand-ticked acknowledgement on 100% of quote requests.**

**This is not an argument against art. 15/d.** It is an argument that the thing being measured —
*how many insurers did this request reach* — is at 1 on every row the system holds, so either the
dev data does not represent the office's real practice, or the office is in breach on every request.
**Both readings need the owner, and both change what gets built.** Three questions follow, and they
are the owner's:

1. **Is one insurer per RFQ the real shape of the office's work, or an artefact of seeded data?** If
   it is real, the window is correct and the clicks are the cost of compliance. If it is seeded, the
   measurement that matters has not been taken yet.
2. **Does «التواصل مع ثلاث شركات» count the insurers on ONE RFQ, or the insurers approached for the
   whole programme?** An opportunity can carry several RFQs, one per line. On dev, 89 opportunities
   each hold exactly one RFQ — so the two readings give the same answer today and different answers
   the first time a two-line programme goes to market.
3. **Exemption 4's premium is the employee's to type.** That makes the figure a declaration rather
   than a fact — which is fine under decision 129's own rule, but it means the 2,000 ceiling is
   checked against a number nobody verified. Is that acceptable, or should the exemption wait until
   a premium estimate exists on the request?

---

## 2 · §4.2 — THE SEVEN CALLERS, read from the module papers rather than re-decided

Decision 126's table, as the module-1 paper §٨.٢ records it. **Nothing here is built in this batch**;
the permission codes are proposals, named by the convention the existing catalogue uses.

| # | caller | article | the module paper that owns it | the permission code it will need |
|---|---|---|---|---|
| 1 | fewer than three insurance companies on a quote request | م(١٥/د) | **م٦** — request for quotes | `declared-act.insurer-minimum` |
| 2 | an unpaid premium entered as a debt on the broker, or set off against commission | م(١٩/أ/٣) | **م٨** — collection, remittance, trust account | `declared-act.premium-as-debt` |
| 3 | the broker collecting a group-medical premium | م(١٦/ي/٨) | **م٨** — collection, remittance, trust account | `declared-act.group-medical-collection` |
| 4 | working after the mandate has been withdrawn | م(١٥/هـ) | **م٤** — mandates, consents and channel | `declared-act.withdrawn-mandate` |
| 5 | staff below the minimum at issuance | م(٤/ز) and م(٢٢/ج-د) | **م٧** — issuance and invoice | `declared-act.staff-below-minimum` |
| 6 | the office manager also holding data protection | PDPL م(١١/أ) | **م١٦** — staff fit-and-proper and the DPO | 🔴 **ALREADY BUILT — see below** |
| 7 | one person for both life and general | م(٣/أ/١) | **م١٦** — staff fit-and-proper and the DPO | `declared-act.one-person-both-types` |

### 🔴 CALLER 6 IS ALREADY BUILT, BESPOKE, AND THAT IS THE SHARPEST §4 FINDING

`Organization` carries **four columns, ALL FOUR OR NONE by CHECK** (`schema.prisma:343-361`):
`dpoManagerCombinedNoticeShown` — **the sentence the office was shown, stored verbatim** —
`dpoManagerCombinedAcknowledgedAt`, `dpoManagerCombinedAcknowledgedByUserId`, and
`dpoManagerCombinedAcknowledgedPerson`, the canonical key of the person it was about. It shipped in
module 0-ب item 1a, and `conflict-of-interest.e2e-spec.ts` exercises it.

**That is decision 126's declared-act pattern, already implemented for one caller.** It has the
article's text as displayed, the acknowledgement, the actor, the timestamp and the subject — five of
§٨.١'s nine elements — and it is missing the written reason, the separate permission, the
responsibility sentence and the network address.

⟶ **So the general machine must either ABSORB this caller or leave it alone explicitly.** Building a
seventh declared-act row type beside those four columns would be *a second answer to "what did this
office declare"*, which is the one thing the module paper says this must not become. Which way round
is the owner's call, and it is a real choice: absorbing it means a migration that moves a live
declaration, and leaving it means the inspection report reads two tables.

**Caller 7's detection already exists too**, as `breachesNaturalPersonOneTypeRule` in
`broker-license-scope.config.ts`, called from `broker-license-scope.service.ts:156` — and today it
REFUSES. Under decision 126 it declares and records instead, so that call site changes direction,
which is a behaviour change on a shipped refusal rather than new work. **Caller 5's detection exists
as `assessStaffing`** and is already a warning rather than a refusal, which is the direction
decision 126 wants.

---

## 3 · §4.3 — THE TWO GRANTS THAT NEED RATIFICATION

Both codes were written `roles: []` first, on the standing rule that no role is granted a new code so
that a screen works. **`packages/db/prisma/seed-data/permissions.spec.ts` refused it**, and its
reason is sound: *"a code granted to nobody is a checkbox that removes nothing"* — an OFFICE-scoped
code must reach at least one role, and only a PLATFORM-scoped code may carry an empty list.

So the seed's rule was followed and the grant is reported rather than decided. **These are template
defaults in decision 80's sense — what ships, not a lock.**

| code | role(s) granted | why this role, and what is deliberately excluded |
|---|---|---|
| `legal-value.declare` | **BRANCH_DEPARTMENT_MANAGER** | decision 123 says the three conditions on an office-supplied value fall «على المدير مرّةً واحدة» — on the manager, once, and never on the employee. It is separate from every permission to DO the act the value governs, which is why a placement officer who works under art. 15/d's ceiling every day cannot move it. |
| `legal-value.read` | **BRANCH_DEPARTMENT_MANAGER** and **COMPLIANCE_OFFICER** | the manager because declaring a value one cannot read back is not a capability; the compliance officer because `license.manage` is already theirs and these figures are what the licence rules read. |

**EXECUTIVE_MANAGEMENT is deliberately NOT included**, on the recorded rule that widening a grant the
owner has not named is not a tidy-up. Measured after the change: the catalogue is **232 codes** and
`from-empty.sh` reads `permission codes seeded 232`.

---

## 4 · §6 — EVERY NEW STRING, AND WHERE IT WAS SLICED FROM

Message 35 §6's own instruction, and the state as at 2026-11-11:

**No screen ships in this batch.** The strings below are the ones this batch wrote or would need;
each row names the shipped text it came from. **An empty cell is a cell that goes to the owner.**

### 4.1 · What this batch actually wrote

| site | the string | sliced from, with its key |
|---|---|---|
| `perm:legal-value.read` (the role matrix) | «يقرأ القيم التي يحسب بها النظام: ما نصّت عليه تعليمات البنك المركزي الأردني رقم 9 لسنة 2026 ومعه المادة التي ورد فيها، وما أعلنه هذا المكتب. ويرى السجل كاملاً لا القيمة السارية اليوم وحدها، لأن كل معاملة حُسبت بالقيمة السارية يومها» | **COMPOSED, not sliced whole.** «يقرأ» from 28 sibling descriptions in `translations/permissions.ts`; «تعليمات البنك المركزي الأردني رقم 9 لسنة 2026» and «المادة» byte-exact from `rcStandingNoTermNote` (`compliance-risk.ts:117`); «السارية» from the same dictionary. The connective prose is mine and is a placeholder in her register. |
| `perm:legal-value.declare` (the role matrix) | «يعلن لهذا المكتب قيمةً أحالتها تعليمات البنك المركزي الأردني رقم 9 لسنة 2026 إلى قرار لم يصدر، ومعها المرجع وتاريخ العمل بها. ولا يملك إدخال رقم نصّت عليه التعليمات نفسها ولا تغييره» | **COMPOSED.** «يعلن» ships once in `permissions.ts`; «المرجع» from `rcCapitalShortNote` (`compliance-risk.ts:226`) and `compliance-screening.ts:184` («المرجع والمستند مطلوبان»); the instrument's name as above. |

Both are on `AWAITING_OWNER_REVIEW` **by name**, which is the mechanism the last seven used, and the
balance holds at **232 = 230 + 2**.

### 4.2 · What §4 and §5 would need, and has NOT been written

Listed so the owner can see the size of the Arabic before any of it is built. **Every cell is empty
on purpose: no shipped text yields these, so they are hers.**

| site | what it has to say | sliced from |
|---|---|---|
| the declared-act window — title | that this act breaches a named article | *(the adviser wrote the art. 15/d title: «تحذير تنظيمى: خرق حد التعامل الأدنى مع شركات التأمين» — used verbatim, not sliced)* |
| the declared-act window — the article's text | the article, letter for letter | *(copied from the instrument; the adviser's three window texts are in `docs/answers/legal-counsel-six-items-verbatim.md` and are used as he wrote them)* |
| the reason field's hint | ask for the legal basis or the exemption | *(the adviser's: «الرجاء كتابة السند القانوني أو مبرر الإعفاء للمتابعة...»)* |
| the acknowledgement checkbox | the office bears the regulatory responsibility, the developer is released, **and the release does not cure criminal liability** | *(the adviser's checkbox sentence, plus the LIMIT he states separately — «الإقرار الرقمي لا يلغي الصفة غير المشروعة للفعل». §٨.١ item 9 says the two are never separated, and no shipped Arabic joins them)* |
| the responsibility sentence written INTO the record | that the regulatory responsibility is the office's — as a sentence, not an inference | ⬜ **empty — hers** |
| the five art. 15/d exemption names, as options | each exemption, short enough for a list | ⬜ **empty — hers.** The instrument states them as prose; a list label is not a slice of a sentence. |
| «وسمه النظام» / «اختاره فلان» on the record | which of the two the exemption was | ⬜ **empty — hers.** Decision 129 §4 criterion 7 names the distinction; the words are not in the product. |
| the stamp on a document issued while the renewal is under study | that this was issued with the licence term ended and the renewal pending | ⬜ **empty — hers.** ⛔ And decision 128 forbids «ساري» and «حكماً» here; «قيد التجديد» is the shipped status word (`rcStandingRenewalPending`) and is a STATUS, not a stamp on a document. |
| the filing-proof upload — field labels | the file, the filing date, the inbound/reference number | ⬜ **empty — hers** |
| the standing declaration for a term | that no refusal and no deficiency notice has been received | ⬜ **empty — hers** |
| the two new `RegulatoryActionKind` members | «إشعار نقص» and «رفض تجديد» | **These two ARE in decision 128's own text** (§8 and §5), so they are the owner's words already and need no slice — but they are new STRINGS in the product and are listed here so she sees them before they ship. |

---

**The state below is as at 2026-11-11, the day this batch closed.** Every «not built» in it is a
statement about this commit and nothing more — re-read the row rather than trusting the word.

## 5 · WHAT IS NOT BUILT, AND WHY

| section | state | why |
|---|---|---|
| §0 merge | ✅ done | #54 → main, then #56 retargeted to main carrying #55's content. **#55 merged into its own unretargeted base**, so its merge commit never reached `main` — reported in the batch report. |
| §1 corrections | ✅ done | |
| §2 decisions | ✅ done | index 56/56/56 |
| §3 the legal-values table | ✅ done | 13 provider rows, seven criteria tested, `check:legal-numbers` reads ZERO literals awaiting the table |
| **§4 the declared-act record** | ⛔ **not built** | §4.4's own instruction is *measure each of the five against the schema and report the table BEFORE you wire it* — table 1 above is that report, and **three of five disagree with the expectation**. Wiring art. 15/d as specified puts a window on **89 of 89** quote requests on current data, which is the failure decision 123's second form was corrected for. And caller 6 is already built bespoke, so the general machine's first design question — absorb it or leave it — is the owner's. |
| **§5 decision 128** | ⛔ **not built** | a scope stop, not a blocked one. It needs a filing-proof document record, a standing declaration per term, two new `RegulatoryActionKind` members, a stamp on six issuance acts, and nine planted tests — and every screen string it needs is an empty cell in table 4.2. §8 permits stopping at a section boundary, and this is one. |
| **§6 the strings table** | ✅ done | table 4 above |
| **§7 the permission-name derivation table** | ⛔ **not built** | §7's own clause: *if §3–§5 have already made the batch long, stop before this section and say so.* §3 alone is a migration, a table, a repository, a tenant-extension exception, three constants moved and 42 new tests. It does not block anything. |
