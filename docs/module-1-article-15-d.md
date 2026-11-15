# Art. 15/d — three insurance companies, the five exemptions, and what the system cannot yet tag

**Written 2026-11-12, message 36 §4.** A quote request must reach **three** insurance companies or
more. OWNER DECISION 130's first ruling is that the office sends to three or more **because that is
what the law says** — so fewer than three is the exception, and the window belongs on the exception
rather than on the routine.

Both figures are rows in the legal-values table and **never literals** (OWNER DECISION 123, third
form), each with its article and the printed page it was read on:

| code | article | page | value |
|---|---|---|---|
| `MIN_INSURERS_PER_REQUEST` | art. 15/d | 17 | 3 |
| `SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD` | art. 15/d/4 | 17 | 2000 |

Both are read **at the request's own date**, never today's — decision 129's criterion 4.

---

## What the system would need to TAG exemptions 1–3 by itself — **each sized, none built**

Message 36 §4 requires this measured and reported before anything rests on it. **On the 2026-11-12
measurement not one of the five can be tagged**, so every exemption recorded today is
`CHOSEN_BY_PERSON` and the choice is the employee's declaration of the fact. `TAGGED_BY_SYSTEM`
exists in the shape and is unused; **it must not be deleted**, because the distinction belongs to
the record and a column that cannot express *the system established this* could never record it
later.

### 1 · An individual/group split on the medical line — **ABSENT ENTIRELY**

**Measured:** `InsuranceLine` has **no** field naming individual, group, coverage type or segment —
its whole shape is `code`, `nameEn`, `nameAr`, `category`, `displayOrder`, `createdAt` plus
relations. `MEDICAL_HEALTH` is **one row**, and `InsuranceLineCategory` has exactly two members
(`GENERAL`, `LIFE`), neither of which is the distinction.

**Size:** this is the largest of the three and it is a **product decision before it is work**,
because there are two incompatible shapes:

- a new column on `InsuranceLine` (say `medicalCover: INDIVIDUAL | GROUP | null`) — cheap, but it
  puts a medical-only property on a table 32 rows share, and nothing else on that table is
  line-specific in that way;
- **two catalogue rows** (`MEDICAL_INDIVIDUAL`, `MEDICAL_GROUP`) replacing the one — truer to the
  model, and it touches every row that names `MEDICAL_HEALTH`: measured on dev, **10 of 89 RFQs**
  carry the programme line `Group Medical`, plus the policies taken from them.

⟶ **Blocks exemptions 1 and 2 both.** Neither can be tagged until this exists, and whichever shape
is chosen, the migration has to decide what the existing medical rows become — which is exactly the
question a reader should not have to re-derive.

### 2 · The consecutive-renewal count — **THE CHAIN EXISTS AND IS BROKEN AT ONE LINK**

This is the sharpest of the three and the smallest.

**Measured:** the chain is already in the schema —

```
Policy  <--  RenewalCase.policyId (@unique)  -->  RenewalCase  -->  Opportunity.renewalCaseId
                                                                      |
                                                                      v
                                                             RFQ  -->  Quotation  -->  Policy
```

`RenewalCase.policyId` is `@unique` and names the **expiring** policy, and `RenewalCase` already
has an `Opportunity?` back-relation. So a new policy *could* be walked back to the one it renews,
and the consecutive count would be the length of that walk.

**It is broken at exactly one link: `Opportunity.renewalCaseId` is never written.** Message 36 §2
measured it — three live readers, no writer anywhere; `CreateOpportunityInput` is exactly
`{ customerId, insuranceProgramId, createdByUserId }`.

**Size:** write that one field where a renewal opportunity is created, then the count is a graph
walk with a depth bound. ⚠️ **And it is still a product decision, not only a wiring job**, for two
reasons: nothing today creates an opportunity *from* a renewal case at all (so there is no code path
to add the field to), and the walk needs a rule for what breaks a chain — a lapse, a gap in cover,
a change of insurer. «ثلاث سنوات متتالية» means consecutive, and consecutive is the part the schema
cannot answer by itself.

⟶ **Blocks exemption 2's three-year limit.** Exemption 2 can still be *offered*, and the limit is
part of what the employee declares.

### 3 · The defined-benefit list — **ZERO ENGINEERING; IT NEEDS THE CENTRAL BANK**

**Measured:** the home already exists. `DEFINED_BENEFIT_CONTRACT_LIST` is one of the three
office-owned codes seeded with its **shape and no value**, because the Central Bank has issued no
list — which is decision 123's sixth criterion working exactly as intended.

**Size: none.** There is nothing to build. When the list is issued it becomes a value on that row
and exemption 3 becomes a lookup.

⟶ **And note the direction of the current behaviour**: with no list, nothing can say a product is
**not** defined-benefit, so the exemption is OFFERED rather than withheld. Withholding it would be
the system asserting a fact it does not have, which is the opposite error from offering it.

---

## The two measurements §4 asked for before wiring

### Exemption 5's evidence — **`CommunicationLog` carries it as it stands**

§4.6: *measure whether `CommunicationLog` on the RFQ can carry that evidence as it stands. If it
can, use it.* **It can, and nothing new was built.** Measured 2026-11-12, it already holds:

| what exemption 5 needs | the column |
|---|---|
| it is the CUSTOMER's request, not ours | `direction` — `CommunicationDirection` has **INBOUND** |
| on this request | `rfqId` (and `rfqInsurerId`) |
| from this customer | `customerId` |
| through an approved means | `channel` — `InteractionChannel`, 12 members |
| what was said | `subject`, `body` |
| when, and who recorded it | `sentAt`, `loggedByUserId` |

**⚠️ ONE QUESTION GOES UP, AND IT IS NOT AN ENGINEERING ONE.** Art. 15/d/5 says «وفق وسائل التبليغ
المعتمدة» — through the **approved** means of notification. `InteractionChannel`'s twelve members are
not all plausibly means of notification: `MEETING`, `CALL`, `EMAIL`, `WHATSAPP`, `VISIT`, `PORTAL`
and `SMS` are channels; `PROPOSAL`, `RENEWAL`, `CLAIM` and `COMPLAINT` are document or case types;
and `OTHER` is a catch-all. **Which of them count as approved is the owner's to say**, and until she
does the system requires only that the evidence be INBOUND and attached to the request, and records
the channel so the answer can be applied afterwards. Requiring a subset now would be inventing a
legal rule.

### Exemption 4's three words are **FOUR LINE CODES**

«مركبات أو طبي أو بضائع», measured against the 32-row catalogue:

| the article's word | the catalogue |
|---|---|
| motor | `MOTOR_COMPREHENSIVE`, `MOTOR_TPL_COMPULSORY` |
| medical | `MEDICAL_HEALTH` |
| goods in transit | `MARINE_CARGO` |

**⛔ AND `MONEY` IS DELIBERATELY EXCLUDED.** Its name is *"Money (Cash in Safe / in Transit)"*, so any
match on the words *in transit* sweeps it in — and **cash in transit is not goods in transit**.
Admitting it would widen a statutory exemption by a substring match. A test asserts it stays out,
which is what stops the four-code list being "simplified" into a regex.

---

## The condition inside exemption 4 that the system does not hold

Art. 15/d/4 is not only a line and a ceiling. It reads «**شريطة الاعتماد على سياسات اكتتابية لثلاث
شركات**» — conditional on relying on the underwriting policies of three companies.

**That is not a fact this system records anywhere**, and it is why exemption 4 is a CHOICE even
though both of its measurable halves (the line and the premium) are known. The system offers the
exemption only when the line and the premium qualify, and the employee's choice is their
declaration of the remaining condition. ⟶ **So "the system knows the line and the premium" must not
be mistaken for "the system can tag exemption 4."**

---

## **2026-11-12 — BOTH TABLES ARE ON `main` AND BOTH ARE INERT**

Message 37 §0. `RfqArticle15DExemption` and `Article15DPremiumAlert` merged to `main` in PR #58
(migration `20261218100000_article_15_d_exemption`), so the schema holds them, the migration's own
DO block asserts their eleven properties, and `from-empty.sh` builds them from nothing — **and
nothing in the application reads or writes a row in either one.**

**Measured on the merge commit, every tracked reference outside the migration and the generated
client:**

| where | what it is |
|---|---|
| `schema.prisma` (10 sites) | the models and their relation fields |
| `money-fields.inventory.ts:45-48` | the four `Decimal` columns classified as MONEY — a declaration, which is what that gate demands of a new money column |
| `article-15-d.config.ts:210,214` | two comments, explaining where the comparison's answer gets recorded and why a quote exactly AT the ceiling is within it |
| `insurer-deactivation.e2e-spec.ts:442` | the §4 pin — a `.count()` asserting a one-insurer RFQ writes **no** exemption row |

⟶ **That single `.count()` is the only Prisma client call against either table in the repository.**
There is no `create`, no `update`, no read on any request path.

⟶ **This is deliberate and is the state §4 required**, not an oversight: art. 15/d is not enforced
until its strings are ratified (`docs/module-1-strings-for-ratification.md`) and its screen ships
with the server in one batch. A table that exists before its writer is the safe order here — the
reverse would mean a window with nowhere to record what it says.

⛔ **So do not read their presence as the feature being live**, and do not wire a writer to either
one without the screen: a recorded exemption nobody can see is worse than none, because it reads
as a declared act that was never declared.

---

## ✅ WIRED — 2026-11-14, message 38 §3. Server and screen in one batch, as §4 required.

The paragraph above is the state until 2026-11-14 and is kept as the history. What shipped:

| piece | where |
|---|---|
| the rule, pure | `article-15-d.config.ts` (unchanged) |
| the evaluation | `article-15-d.service.ts` — `evaluate` refuses, `apply` writes |
| the question the screen asks | `GET /rfqs/article-15-d/options`, gated on `rfq.create` |
| the record | `POST /rfqs` — `RfqArticle15DExemption` or a `DeclaredAct`, never both |
| the alert | `quotation.service.ts` `capture` → `checkQuotationAgainstCeiling` |
| the window | `components/rfq/Article15DWindow.tsx`, on `/rfqs/new` |
| the approved means | `approved-means.config.ts`, total over the 13-member channel enum |
| the tests | `article-15-d.e2e-spec.ts` — **15/15**, each named by its criterion |

### 🔴 THE DEFECT THE e2e FOUND, WHICH IS THE THING WORTH READING HERE

The first version evaluated art. 15/d **after** `insertRfqRow`, because the exemption and the
declared act both point AT the request and neither can be written before one exists. That is true
of the **writes** and false of the **refusals** — and the consequence was real:

> a refused request left the RFQ row behind. The employee corrected their mistake, submitted
> again, and got **409 Conflict** from `@@unique([opportunityId, insuranceLine])` — told that a
> request they could not see already existed, with **no way to proceed on that line at all**.

Found on the spec's second run, where a refused WhatsApp evidence was followed by a valid attempt
on the same opportunity and line. ⟶ Split into `evaluate` (refuses, before the row) and `apply`
(writes, after it), and pinned by a test that drives the exact human sequence — refused, then
corrected — because that is the only form in which the bug was visible.

### 🔴 AND THE ALERT WAS WIRED ON `capture` AND NOT ON `revise` — HALF A WARNING

The second defect, and it was found by reading the sibling path rather than by a failure.
`QuotationService.capture` compared the quote against the ceiling; `revise` did not.

⟶ So an insurer's opening quote of 1,800 would have raised nothing (correctly) **and its revised
quote of 2,400 would have raised nothing either.** The system would have warned on the cheapest
path and gone silent on the expensive one — which is worse than no alert, because an office that
has seen the mechanism work once will read its silence as "within the ceiling".

Message 36 §4.5 is «ولمّا ترجع العروض يقارن النظام» — when the quotes come back the system
compares — and **a revision IS a quote coming back.** Both paths call it now, and the revision
raises its OWN alert rather than editing the first: a revision is a new `Quotation` row, the index
is `(exemptionId, quotationId)`, and the alert is a TABLE rather than a flag precisely so a second
high quote cannot be swallowed by the first.

⚠️ **And the route carries `quotation.negotiate`, not `quotation.capture`** — measured when the
test answered 403. The compiler cannot see that, and neither can a reader who assumes the two
quote-writing routes share a code.

### AND THE CUSTOMER CHECK FIRES BEFORE THE CHANNEL CHECK

Also found by getting it wrong: evidence from the wrong customer is refused as *the wrong
customer*, not as *the wrong channel*. Whose message it is comes before how it arrived, and a
message from the wrong customer is not improved by having come by email.

### ⛔ AND EXEMPTION 5's EVIDENCE CANNOT BE «ON THIS RFQ», WHICH CORRECTS THE SCHEMA COMMENT

`RfqArticle15DExemption`'s own comment says the evidence is «an INBOUND `CommunicationLog` on this
RFQ». Measured while wiring it: **the customer asks BEFORE the request exists**, so at creation
there is no RFQ for the log to be on — the strict reading makes exemption 5 unreachable on the
only path that needs it. ⟶ The evidence is an INBOUND log **on the opportunity's own customer**,
by an approved means, and nothing wider: any log in the office would let an unrelated message
stand as proof that THIS customer asked for THIS request.

### 🔴 AND THE ENFORCEMENT IS IN THE ROUTE, SO A DIRECTLY-WRITTEN ROW ESCAPES IT

Stated plainly because it is the honest limit of what shipped, and because it was already
measured last batch: **`comparison` and `recommendation` create their RFQs through Prisma and
never pass through `POST /rfqs` at all.** Measured 2026-11-14: **15 api e2e specs** write an
`RFQ` row directly.

⟶ Such a row has no exemption and no declared act, and **nothing refuses it.** The database
CHECKs constrain an exemption row that EXISTS; none of them requires one to exist.

**It is not expressible as a constraint today, and that is structural rather than an omission.**
The count art. 15/d turns on is the SHORTLIST, which lives in `RFQInsurer` rows inserted *after*
the parent — so a trigger on `RFQ` fires before the fact it would need, and a trigger on
`RFQInsurer` would have to decide what the *final* shortlist is while rows are still arriving.

⛔ So do not read the CHECKs as the guarantee. The guarantee is the route, and a path that writes
an RFQ some other way is a path art. 15/d does not reach — which is a reason not to build one,
and the reason seeding scripts that do it carry a comment saying so.

### WHAT STILL CANNOT BE TAGGED — unchanged, and the measurement above still holds

Every exemption recorded today is `CHOSEN_BY_PERSON`. ⛔ Decision 129's **criterion 1** asks for
exemption 1 tagged BY THE SYSTEM on an individual medical renewal, and the system holds no fact it
could tag on. The e2e proves what decision 129 actually governs — the exemptions are offered on
the line that can carry them and the record says who chose — and says so in its own header rather
than driving a tag that would mean inventing the fact beneath it.
