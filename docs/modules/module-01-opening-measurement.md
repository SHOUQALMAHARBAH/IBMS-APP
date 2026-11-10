# Module 1 — opening measurement
### القياسُ الافتتاحيُّ لمديول ١ — التنبيه المسجَّل والقيم القانونية

> **Measured 2026-11-10 against `85d9dcbd`, which is an ancestor of `origin/main` (0 ahead, 1 behind).**
> **No code. `git diff --stat` over `apps` and `packages` is EMPTY, against both HEAD and `origin/main`.**
> Template: `docs/modules/00a-day-one-setup-and-verification.md` §5, قالب ١.

---

## 🔴 الخلاصةُ بستِّ جُمَل — read this and nothing else if you read nothing else

**١ · بندٌ من بنودِ المديولِ الخمسةِ مبنيٌّ بالكاملِ ومحروسٌ في CI، وهو البندُ الذي قالت الورقةُ إنّ قاعدةَ البياناتِ ترفضه.** §4.5 «وضعُ المكتبِ المُعلَن» — *يُسمَح ويُعلَن ويُسجَّل* — شُغِّل في ٢٨ تشرين الأول: ١٦ قيدَ `CHECK` كلٌّ منها اكتسبَ فاصلاً ثالثاً، ومُشغِّلٌ واحدٌ على `CombinedDutyAct`، وخدمةٌ ومتحكّمٌ وشاشةٌ وورقةُ تصميمٍ من ٧١٣ سطراً. **الحجمُ صفر.**

**٢ · ونصفُ «جدولِ القيمِ القانونية» مبنيٌّ أيضاً، والنصفُ المبنيُّ هو النصفُ الصعب.** `SlaPolicy` يحمل القيمةَ ووحدتَها ومرجعَها القانونيَّ (`sourceReference`/`sourceDocument`/`sourceSection`) وتاريخَ نفاذِها (`effectiveFrom`/`effectiveTo`) ومن حدَّثها — **أربعةٌ من أربعةٍ مما يطلبه §4.2** — **والقراءةُ بتاريخِ الحركةِ مُنفَّذةٌ فعلاً** (`sla-policy.repository.ts:49`).

**٣ · والبندُ الذي كبر، لا صغر، هو الإيقافُ الجزئيُّ الجغرافيّ — وهو غيرُ قابلٍ للتعبيرِ اليوم أصلاً.** `branchId` يحمله **ثلاثةُ موديلاتٍ فقط: `Employee` و`SalesTarget` و`User`.** **ولا بوليصةٌ ولا طلبُ تسعيرٍ ولا توصيةٌ ولا شهادةٌ تحمل فرعاً جغرافياً** — فم(٢١/ب/٦) لا يمكن إنفاذُه على أيِّ فعلٍ من الستّةِ المحروسة. **وهذا هو البندُ الذي يُبلَّغ قبلَ البناءِ لا بعده.**

**٤ · والنصفُ التأمينيُّ من الإيقافِ الجزئيِّ جاهزٌ بثلاثِ سوابقَ وبالبيانات.** ٧٤ من ٧٤ بوليصةً و٨٩ من ٨٩ طلبِ تسعيرٍ تسمّي فرعَها التأمينيّ.

**٥ · و«٢٣٠/٢٣٠» صحيحةٌ ولها حارسٌ له أسنانٌ — لكنّه موجَّهٌ إلى مرآةٍ على بُعدِ خطوتَين من حيث تُكتَب الصلاحية، وفحصانِ يخصّانِها أحمرانِ اليومَ على شجرةٍ نظيفة، وليس أيٌّ منهما في CI.**

**٦ · والتسعُ كلماتٍ ليست تسعاً: صفر.** سبعٌ منها تشحَن اليومَ بعربيّها، والاثنتانِ الباقيتانِ أُقفِلَتا بالقرار ٥٣ **بلا ما تُكتَب كلمةٌ واحدة.**

---

## What exists, measured today

| area | measured | command |
|---|---|---|
| models | **`RegulatoryAction` + `RegulatoryActionBasis` + `RegulatoryActionKind` exist and are mature** (`schema.prisma:7549`). **`CombinedDutyAct` exists.** **`SlaPolicy` exists and is a date-effective, source-cited values table.** **ZERO** `LegalValue`/`LegalParameter`/`StatutoryValue`; **ZERO** `DeclaredAction`/`ActionNotice` | `grep -n "^model RegulatoryAction" -A 40 packages/db/prisma/schema.prisma` · `grep -n "^model .*Legal\|^model .*Statut" packages/db/prisma/schema.prisma` |
| routes | **`POST /broker-license/regulatory-actions`** writes the act. **`GET /orgs/resolve`** is the only reader of `Organization.status`. Duty-segregation mode has its own controller | `grep -rn "RegulatoryAction" apps/api/src/modules/compliance-risk/broker-license.controller.ts` |
| screens | **`/settings/duty-segregation` EXISTS.** No legal-values screen, no declared-action register screen, no suspension-state screen | `ls apps/web/app/\(app\)/settings/` |
| permissions | **230 in the catalogue, 230 on the dev database, 230 Arabic description keys — all three agree** | `select count(*) from "Permission"` · `grep -c "^    code: \"" packages/db/prisma/seed-data/permissions.ts` (231 minus the interface's own `code: string;`) |
| rows in dev DB | `RegulatoryAction` **0** · `CombinedDutyAct` **0** · `BrokerLicense` **4** · `InsuranceLine` **32** (GENERAL 27 / LIFE 5) · `OfficeInsuranceLine` **0** · `Branch` **9, all live** · `Organization` **8** (4 BROKERAGE_OFFICE, 3 INSURANCE_COMPANY, 1 PROVIDER), **all 8 `SEGREGATED` and all 8 `ACTIVE`** · `Policy` **74** · `RFQ` **89** · `User` **34, of which 2 carry a `branchId`** | `node` + `$queryRawUnsafe` through `dotenv -e .env` — probe kept at `scratchpad/m1-db-probe.cjs`, not committed |
| tests | **16 maker/checker pairs = 16 live `CHECK` constraints, both directions, in CI.** `license-gate.inventory.spec.ts`, `license-standing.config.spec.ts`, `permission-descriptions.test.ts` (9 tests) all green | `npm run check:maker-checker-pairs` → exit 0 |

---

## What is missing, and how I know

| missing | the command that shows the absence |
|---|---|
| A legal-values table for **non-duration** values (money, percentages, counts) | `grep -n "^model .*Legal\|^model .*Statut" packages/db/prisma/schema.prisma` — only `LegalHold` and `LegalForm`, neither is this |
| A declared-action register | same pattern — no `DeclaredAction`, no `ActionNotice` |
| **A geographic branch on any transaction** | `grep -n "branchId" packages/db/prisma/schema.prisma` resolved to its owning model → **`Employee`, `SalesTarget`, `User` only** |
| **A location or country on `Branch`** — so art. 21/b/6's «داخل المملكة أو خارجها» is not expressible either | `grep -n "^model Branch " -A 18 packages/db/prisma/schema.prisma` → `name`, `nameAr`, `deactivatedAt`, and nothing else |
| Any scope column on `RegulatoryAction` | the 40-line model read in full — `kind`, `basis`, `effectiveFrom`, `decisionRef`, `documentId`, `suspendedUntil`, `recordedBy*`, and no scope |
| A scope argument on the licence gate | `LicenseGateService.assertMayPractise(act, now)` — `license-gate.service.ts:136` |
| A CI step for either permission-description check | `grep -n "fixture:permissions\|permission-descriptions" .github/workflows/ci.yml` → **nothing** |

---

## Claims in the documents I re-measured

| document claim | still true? | measured |
|---|---|---|
| §2 «وضعُ المكتبِ المُعلَن — قاعدةُ البياناتِ ترفضه اليوم» | 🔴 **NO — it is BUILT** | `maker-checker.util.ts` records it in its own header: each of the 16 CHECKs gained `OR "combinedDutyActId" IS NOT NULL` in migration `20261028100000`; a trigger on `CombinedDutyAct` refuses an act for a non-`COMBINED` office. **Live dev DB: 16 constraints, 1 non-internal trigger.** `docs/duty-segregation-mode.md` is 713 lines |
| §4.5 «ومعها تنحلُّ عقدةُ `dpoAlternateApproverUserId`» | **resolved already** | `apps/api/src/modules/duty-segregation/dpo-designation.config.ts` + `.service.ts` + a 10 KB spec exist |
| §2 «جدولُ القيمِ القانونية — ما في جدول أبداً · من الصفر» | ⚠ **half false** | `SlaPolicy` holds value+unit, `sourceType`/`sourceReference`/`sourceDocument`/`sourceSection`, `effectiveFrom`/`effectiveTo`, `createdByUserId`/`updatedByUserId`. `SlaSourceType.REGULATORY` makes the reference MANDATORY by CHECK constraint. **True only for non-duration values** |
| §6 criterion 2 «القيمةُ تُقرأ بتاريخِ الحركةِ لا بتاريخِ اليوم» | ⚠ **already true on one of two paths** | `sla-policy.repository.ts:49-50` filters `effectiveFrom <= at` / `effectiveTo > at`; `sla-timer.service.ts:206` passes `baseDate` (the transaction's). **`:247` passes nothing and defaults to `new Date()`** |
| §2 «الشرحُ العربيُّ مكتملٌ ٢٣٠/٢٣٠ — يُتحقَّق منه ولا يُبنى» | ✅ **TRUE** | 230 catalogue codes, 230 `perm:` keys, **zero in either direction** by `comm -23`/`comm -13` over both sorted sets |
| §2-ب م١ row: «الكياناتُ الموجودةُ فعلاً — —» (a dash: nothing exists) | 🔴 **NO** | `RegulatoryAction`, `CombinedDutyAct` and `SlaPolicy` are all module-1 entities and all exist |
| §3 «الرموزُ الثلاثةُ غير المنفَّذة — الإدارة» | **not the management's, and already gated** | `permission-enforcement.inventory.spec.ts:42-49` declares all three with a written reason each, and gates the declaration in both directions |
| The pre-module «nine words owed by the management» | 🔴 **ZERO owed** | see § Rule 72 below |
| `0-ب`'s note that `check:dead-helpers` is local-only and its CI step is owed | **closed since** | `grep -o "npm run [a-z:-]*" .github/workflows/ci.yml` lists `check:dead-helpers` **and** `check:maker-checker-pairs` |

---

# §1 — The four measurements

## 1 · The partial-suspension shape

### What `RegulatoryAction` can express today

A **whole-office** act, correctly and with real care: which provision it was taken under (`basis`, separating art. 14/a from art. 21/b/5-6), when it takes effect as distinct from when it was recorded, the CBJ decision reference (required — «an act with no decision behind it is an assertion about the regulator that nobody can check»), the document, and the period under art. 21/b.

`deriveLicenseStanding` folds the whole append-only act series into **six** derived statuses with `mayPractise` beside them, applies art. 14/c **only** to a `BROKER_REQUEST` suspension, and is consumed by **one** gate — `LicenseGateService.assertMayPractise` — at **8 production call sites across 6 modules**, over a closed list of **6 gated acts** with a deliberately-recorded list of **5 ungated** ones.

> **Correction to §2.1 of the brief, measured:** `documentId` is **`String?` — NULLABLE**, not required. `document Document? @relation(..., onDelete: Restrict)`. The `Restrict` is real; the requirement is not. `decisionRef` is the field that is genuinely non-null.

### What it cannot express, and this is the whole gap

**No scope of any kind.** Not by insurance branch, not by geographic branch. And `assertMayPractise(act, now)` takes no scope argument, so there is no parameter for one to arrive on.

### The shape I would use — and I would NOT invent it

**For the insurance-branch half (art. 21/b/5): a `RegulatoryActionScopeLine` join table, copied from three existing precedents rather than designed.**

| precedent | scopes | schema |
|---|---|---|
| `BrokerLicenseScopeLine` | a licence term → insurance branches | `:679` |
| `EmployeeCbjApprovalBranch` | a person's CBJ approval → insurance branches | `:713` |
| `RoleScopeBranch` | a role → insurance branches | `:1234` |

All three are byte-for-byte the same shape: a nullable pair (`insuranceLineId` for a standard catalogue row, `officeInsuranceLineId` for an office addition), `onDelete: Restrict` on both, and **two PARTIAL uniques in raw SQL** rather than a compound unique — because Postgres treats NULLs as distinct, which is the § 1.25 trap this repo has already been bitten by on `CommissionAgreement`.

**And one thing the paper asks for should NOT be built: §4.3 asks for a state per `(نوع · فرعِ تأمين)`.** `EmployeeCbjApprovalBranch`'s own comment settles it — *«a branch is a row of a managed catalogue, standard or office-added, and the TYPE is the branch's own `category` rather than a second column … storing a type here would be the same second home for one fact»*. The type is `InsuranceLine.category` (GENERAL/LIFE, 27/5 of 32). **So it is one scope row per branch, with the type derived — not a `(type × branch)` matrix.** Building the matrix would put one fact in two homes on the first table of the module every other module copies.

**An empty scope set means the whole licence**, so every existing row keeps its current meaning and nothing migrates — the same property the duty-segregation migration chose (`Every office reads SEGREGATED after this runs, by the column default. Nothing changes for anybody.`).

### 🔴 And the geographic half cannot be built at all yet — this is the finding to read

Art. 21/b/6, verbatim from `docs/legal/cbj-instructions-9-2026-source-text.md:867`:

> **(6) جزئية بالفرع الجغرافي/المكتب:** وقف أو إلغاء الترخيص في **فرع أو أكثر داخل المملكة أو خارجها**.

Two measured obstacles, and neither is a column:

**(a) No transaction records a branch.** `branchId` is on `Employee`, `SalesTarget` and `User` — nothing else. A `Policy` carries an insurance line and **no branch**; so do `RFQ`, `Recommendation`, `Endorsement` and the certificate path. The only route from a gated act to a branch is through the **acting user** (`User.branchId`, populated on **2 of 34** dev rows) — and *the branch the person belongs to* is a different fact from *the branch the business was written at*. A person in Amman can place business for Irbid. **Enforcing art. 21/b/6 through the actor's own branch would refuse the wrong transactions and permit the wrong ones, in both directions.**

**(b) `Branch` has no location and no country.** Its whole shape is `name`, `nameAr`, `deactivatedAt`. So «داخل المملكة أو خارجها» is not expressible, and art. 23's separate two-year window for **الفروعِ الخارجية** has nothing to attach to.

⟶ **Under §7 prohibition 5 — *«ولو لقيتَ إنّ الشكلَ غلط، أبلِغ فوراً قبل أن يُبنى عليه، لا بعد»* — this is reported now and not designed.** The question that has to be answered before a column is added is a product question, not a modelling one: **does a transaction belong to a branch, and if so which field decides it?** Five modules will copy whatever this module does.

### Size

| piece | size | why |
|---|---|---|
| insurance-branch scope table + two partial uniques | **small** | three precedents, copied; data already present (74/74, 89/89) |
| `assertMayPractise` grows a scope, 8 call sites resolve theirs | **medium** | each of the 6 acts must name its own branch; all 6 can reach one through `Policy`/`RFQ`/`InsuranceProgramLine` |
| `deriveLicenseStanding` returns a per-scope standing | **medium** | the fold is already total and ordered; it becomes a fold per scope. `refusal()` is `switch`-total on purpose, so a scope clause fails the compiler rather than producing a vague sentence |
| geographic-branch scope | 🔴 **BLOCKED** | not a size — a modelling decision that does not exist yet |

---

## 2 · `assertDifferentActors` — **the answer is that it is already built, and nothing should be touched**

### Every call site

**Three production invocations.** Not fourteen, not sixteen:

| site | what |
|---|---|
| `duty-segregation/duty-segregation.service.ts:115` | **the `@Global()` engine** — the mode read, the reason check and the act write in ONE place |
| `policy/policy-checking.service.ts:193` | |
| `recommendation/recommendation.service.ts:664` | |

`needs-assessment.service.ts:52` is a **comment**, not a call. 85 occurrences of the name across 52 files; the rest are the definition, doubles, specs, permission descriptions and the pairs registry.

### Every CHECK constraint, and the migrations

**16 constraints across 15 tables** — the pair count and the table count differ by one on purpose, because `NeedsAssessment` carries two pairs with two escape columns, so a declared combined REVIEW cannot excuse a self-APPROVAL.

**Measured on the live dev database: 16.**
```
select count(*) from pg_constraint
 where contype='c' and conname like '%_maker_checker_distinct'   -->  16
```

> **Correction to §2.3 of the brief:** `grep -rln assertDifferentActors packages/db/prisma/migrations` returns five — correct for that literal — **but the population is eight.** The three later ones use the `combinedDutyAct` wording instead: `20261028100000_duty_segregation_mode`, `20261031100000_recertification_self_review_decision_act`, `20261128100000_retention_schedule_maker_checker`. **The migration that matters most is in the three the literal cannot see.**

### What `npm run check:maker-checker-pairs` asserts

Run, exit 0:

```
registered maker/checker pairs         16   (DERIVED - matches the 16 `*_maker_checker_distinct`
                                             CHECK constraints the migrations create, by name, both ways)
  live                                 16
    projecting the act on the record   16
    writing it and showing nobody       0
view call sites found                  18
```

Both directions, keyed on the **constraint name** and never the table — which is why `NeedsAssessment`'s two pairs do not collapse into one. **It is a CI step.**

### 🔴 The smallest honest change that permits a declared exception without removing the constraint for everyone

**None. It shipped on 2026-10-28.** The mechanism, measured:

1. **`Organization.dutySegregationMode`** — an enum (`SEGREGATED`/`COMBINED`), not a boolean, *so a third value must be addable without rewriting every reader*. `NOT NULL DEFAULT 'SEGREGATED'`, plus `dutySegregationModeDeclaredAt` and `...ByUserId`. **All 8 dev organizations read `SEGREGATED`.**
2. **`CombinedDutyAct`** — one row per act, written in the same transaction as the write it excuses: the office, the entity and its id, **the constraint it excuses** (not a label of our own), the one actor, a `NOT NULL` reason with a floor, the time, and every role the actor held at that moment plus the subset that actually granted the checker permission.
3. **Each of the 16 CHECKs gained exactly one disjunct** — `OR "combinedDutyActId" IS NOT NULL` — with each predicate taken **verbatim from `pg_get_constraintdef`** rather than regenerated from a template, because the 16 do not share a shape and *re-deriving them is exactly how one would come back looser than it went in*.
4. **One trigger, on `CombinedDutyAct` alone**, refuses an act for an office that is not `COMBINED`. **Measured: 1 non-internal trigger on that table.**

So the guarantee is precisely stated in `maker-checker.util.ts`'s own header, and the distinction is the thing to carry forward: **not** *"the database refuses a self-approval"* but *"the database refuses a SILENT self-approval always, and a DECLARED one unless the office has declared otherwise and the act exists."* In a segregated office the escape column cannot be populated at all, so even raw SQL is still closed.

**`CombinedDutyAct` holds 0 rows on dev — the escape has never been used.**

⟶ **§2 of the module paper, §4.5, and §2-ب's م١ row are wrong on this item, and this is a shrink of the module, not a growth.** Nothing is weakened, because nothing needs to be. And the honest version the brief asked for — *«a narrow, audited exception rather than a mode»* — is already what it is: narrow (one constraint per act, never per table), audited (reason floor, actor, the roles held, the hat worn), and visible (16 of 16 pairs project the act **on the record**, not only in a report).

---

## 3 · Legal numbers already in the code

### The discriminator, stated before it was run

> **A numeric constant is a LEGAL NUMBER iff a legal instrument states its value.**

That is not mechanically decidable from a number, so the gate's unit is not *numeric literal* — a gate that flagged every literal would flag thousands and be switched off in a week. The decidable proxy is:

> **a numeric constant DECLARATION whose own doc comment or trailing comment CITES a legal source** — `art. N`, `Article N`, «المادة», `Instructions No`, «تعليمات رقم (…)», `PDPL`, `Law No`, «قانون رقم», `CBJ Instructions` — **within a 12-line lookback**, matching the `DATE_LOOKBACK` window `undated-absence-claims.py` already uses.

**Declaration, not expression:** only `const`/`readonly`/`static readonly NAME = <bare number>;`. A call argument `foo(50)` is out of scope by construction, and `X = LEGAL_VALUES.firstTranche` is not a literal and is not flagged.

**That is also the proxy's weakness, and it is reported rather than hidden: an UNCITED legal number is invisible to it.** What it rides on is this repo's existing standing rule that a change touching a regulatory obligation must cite its source document (`AGENTS.md`), so the gate's real contract is *a cited legal number may not be a literal* — and the uncited case stays a review question, not a gate question.

### Self-tested both ways — 7/7

| planted case | must flag? | result |
|---|---|---|
| `/** Art. 23 — one year … */ export const TRANSITION_PERIOD_DAYS = 365;` | **yes** | ok |
| `/** How many rows the directory page shows. */ export const PAGE_SIZE = 50;` | **no** | ok |
| `/** Art. 11 — days before expiry … */ const RENEWAL_NOTICE_DAYS = 45;` (not exported) | **yes** | ok |
| `/** Retry budget for the mail queue. */ export const MAX_RETRIES = 3;` | **no** | ok |
| `/** المادة (22) البند (م) … */ export const AGENT_BAR_DAYS = 90;` | **yes** | ok |
| a citation **13 lines** above an unrelated constant | **no** | ok |
| `export const FIRST_TRANCHE = LEGAL_VALUES.firstTranche;` under an art. 4/a comment | **no** | ok |

> **🔴 And the self-test caught a real gap in my own instrument before any number rested on it.** The first run was **5/7**: the citation pattern was case-sensitive `art\.`, and this repo's house form is a lowercase `art. 21/b/5` **mid-sentence** while a doc comment **opens** with `Art. 23 — …`. Two planted legal numbers read as technical constants. Fixed case-insensitively, with `\b` before `art` so the pattern does not match the tail of `"part."`.

### The population

```
numeric constant declarations scanned : 130
  CITED a legal source (candidates)   :   4
  no legal citation in window         : 126
```

Hand-read, all four — **3 real, 1 false positive**:

| site | value | verdict |
|---|---|---|
| `compliance-risk/broker-license.config.ts:83` `RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY` | **45** | ✅ **a legal number.** Art. 11, and its comment says so: *«this one IS art. 11: the filing deadline is the article's whole content»* |
| `compliance-risk/license-standing.config.ts:72` `ARTICLE_14C_SUSPENSION_LIMIT_YEARS` | **2** | ✅ **a legal number.** Art. 14/c, verified against the scan, printed page 16 |
| `compliance-risk/license-renewal-notice.config.ts:58` `FIRST_NOTICE_DAYS_BEFORE_EXPIRY` | **45** | 🔴 **a legal number, AND A SECOND HOME — see below** |
| `compliance-risk/license-renewal-notice.config.ts:64` `SECOND_NOTICE_DAYS_BEFORE_EXPIRY` | **30** | ⚠ **FALSE POSITIVE.** Its own comment is explicit: *«The owner's second threshold. NO ARTICLE — stated plainly, because a figure displayed beside a citation it does not have is this product telling a broker the law says something it does not.»* My 12-line window dragged in the **neighbouring** declaration's art. 11 comment. **The window is the wrong unit; the right unit is the declaration's OWN comment block.** Recorded so the gate is built on the block and not the window |

### 🔴 The defect this measurement found

**Art. 11's `45` is written as a literal TWICE, and the second one's comment says it is not.**

`license-renewal-notice.config.ts:57-58`:
```ts
/** Art. 11's own figure, reused through `renewalApplicationDueBy` rather than restated here. */
export const FIRST_NOTICE_DAYS_BEFORE_EXPIRY = 45;
```
It **is** restated there, and it is **read** — `license-renewal-notice.config.ts:162`, `if (daysToExpiry <= FIRST_NOTICE_DAYS_BEFORE_EXPIRY)`. The file reuses `renewalApplicationDueBy` correctly for the **date arithmetic** (`:141`) and keeps its own literal for the **threshold**.

⟶ **Change art. 11's figure and `broker-license.config.ts:83` moves while `license-renewal-notice.config.ts:58` does not.** The first renewal notice would then fire at a threshold the regulation no longer states — and the comment a reader consults to check for exactly this says the number is not there. **One fact, two homes, and the second home denies being one.** This is criterion 1's gate justifying itself before it exists.

### And the half of §4.2 that is already built

`SlaPolicy` is a provider-owned, per-office, **date-effective** values table whose rows carry their own legal reference:

| §4.2 requires | `SlaPolicy` has |
|---|---|
| القيمة | `durationValue` + `durationUnit` |
| ومرجعَها القانونيَّ بمادّتِه | `sourceType` + `sourceReference` + `sourceDocument` + `sourceSection`, and `SlaSourceType.REGULATORY` makes the first two **mandatory by CHECK constraint** |
| وتاريخَ نفاذِها | `effectiveFrom` + `effectiveTo`, **applied in the repository so no caller can forget it** |
| ومن حدَّثها | `createdByUserId` + `updatedByUserId` |

**And `SlaSourceType.INTERNAL_POLICY` is already «the honest home for a drafted figure with no authority behind it»** — which is exactly what the module needs for the seven configurable values that have no number yet, and for `SECOND_NOTICE_DAYS_BEFORE_EXPIRY`'s 30.

⟶ **So §4.2's shape is designed, proven and live for durations (20 rows on dev for 20 registry entries). What is from scratch is the non-duration values** — capital tranches, percentages, counts, the vehicle reference values.

**Two limits of that table, measured, that the non-duration extension must not inherit:**
1. **`@@unique([organizationId, policyCode])`** — one row per code, so a superseded value cannot sit beside its replacement under the same identity. §4.2's own warning — *«فجدولٌ يحمل القيمةَ الحاليةَ وحدَها يخرّب كلَّ حسابٍ قديم»* — applies to this table as it stands.
2. `sla-timer.service.ts:**247**` calls `findActiveFor(workflowName, null)` with **no `at`**, so it defaults to `new Date()`. `:206` passes `baseDate` correctly. **One of two paths reads by today's date.**

---

## 4 · The 230/230 Arabic descriptions

### The verification

| measured | figure |
|---|---|
| `Permission` rows on the dev database | **230** |
| `code:` entries in `packages/db/prisma/seed-data/permissions.ts` | **230** (231 `code:` lines minus the interface's own `code: string;` at `:68`) |
| distinct `perm:` description keys in `apps/web/lib/i18n/translations/permissions.ts` | **230**, each appearing exactly twice (ar + en) |
| catalogue codes with **no** description key | **0** (`comm -23`) |
| description keys with **no** catalogue code | **0** (`comm -13`) |

> **My own first count said 231 and the instrument was the thing that was wrong.** `grep -o "'perm:[^']*'"` matched the **comment** at `permissions.ts:25` — `key = 'perm:' + code` — yielding an empty-string 231st "key". Same class as the `PROVIDER_CODES` 14-vs-13 reading and the three other times this repo has been bitten by a comment quoting the pattern. **230 is right.**

### The raw output of the check the paper names — **and it is RED**

```
$ npm run db:permission-descriptions:check
permission-descriptions: 2 Arabic line(s) are written in
  docs/permission-catalogue-for-descriptions.txt, which is a MIRROR and is not read by anything.
  Move each one into apps/web/lib/i18n/translations/permissions.ts under its `perm:<code>` key,
  then regenerate.
  First: customer.update: …
EXIT=1
```

**On a clean tree, at an ancestor of `origin/main`.** It is not a missing description — it is a **stale mirror**: `permissions.ts` was last written 2026-11-07 and `docs/permission-catalogue-for-descriptions.txt` was not regenerated. The check is doing its job; nobody is running it.

**And a second one is red for the same reason:**
```
$ npm run db:fixture:permissions:check
role-permissions fixture: STALE. apps/web/e2e/fixtures/role-permissions.ts does not match the
  seeded grid (12 roles, 519 grants).
EXIT=1
```
The fixture's own header declares **518** grants. **Neither check is a CI step** (`grep -n "fixture:permissions\|permission-descriptions" .github/workflows/ci.yml` → nothing), which is why both stayed red.

### The plant — and the first one did NOT fail, which is the finding

**Plant 1: a catalogue code with no Arabic description, added to `packages/db/prisma/seed-data/permissions.ts`.**
⟶ **`permission-descriptions.test.ts` stayed GREEN. 9 passed / 9.**

**Why**, measured: the guard's first import is
```ts
import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';
```
— a **web e2e fixture**, generated from the **seeded database** by `npm run db:fixture:permissions`, not from the seed input file. A permission written into the seed is **two hops** from what the guard reads.

**Plant 2: the same code, planted where the guard actually reads.**
⟶ **2 of 9 tests failed, naming it:**
```
AssertionError: 1 codes have no description, above the budget of 0. … First few: plant.module1.measurement
AssertionError: 231 codes exist, but 223 are recorded as owner-reviewed and 7 as awaiting review:
              expected 230 to be 231
```

**Both plants reverted; `git diff --stat` is empty.**

### So the honest answer to the brief's question

**The 230/230 is a fact, and it DOES have a guard with teeth** — `MISSING_DESCRIPTION_BUDGET = 0`, fail-on-any, ratcheted in both directions, plus a fail-on-any orphan check and a provenance balance (`OWNER_REVIEWED_COUNT = 223` + 7 awaiting review = 230). **It is not a formality.**

**But the guard cannot see a new permission at the moment it is written.** The chain is:

```
seed input  →  (CI runs db:seed)  →  dev/db-test DB  →  db:fixture:permissions  →  fixture  →  the guard
                                                        ^^^^^^^^^^^^^^^^^^^^^^^
                                                   NOT run in CI, and its --check is not either
```

⟶ **A permission added with no Arabic description ships GREEN through CI today.** Closing it is small and is not this batch's: either make `db:fixture:permissions:check` a CI step after `db:seed` (CI already seeds, so the DB is there), or point the coverage guard at the seed input it is really about. **The second is the better answer** — the guard's question is *does every catalogue code have a line*, which is a question about the seed, not about what `/auth/me` answers.

---

# §3 — Rule 72: the naming walk

## 🔴 The nine words are ZERO, not nine — and seven of them already ship

The brief asks for the table nobody has written: two for record type, two for coverage branches, five for screening-file status. **Measured, all three groups are closed.**

| group | the words | measured | derived from / status |
|---|---|---|---|
| **five · screening-file status** | `ScreeningAttemptOutcome` — `NO_MATCH`, `POTENTIAL_MATCH`, `NOT_CONFIGURED`, `SCREENING_FAILED`, `UNABLE_TO_SCREEN` (`schema.prisma:1922`, exactly five) | ✅ **all five ship** | `enum-labels.ts:326-331` → «لا يوجد تطابق» · «تطابق محتمل» · «غير مُهيّأ» · «فشل الفحص» · «تعذّر الفحص» |
| **two · coverage branches** | `InsuranceLineCategory` — `GENERAL`, `LIFE` (`schema.prisma:6029`, exactly two) | ✅ **both ship** | `enum-labels.ts:47-50` → «عام» · «حياة». Its own comment records why it is labelled centrally: the licence scope, the insurance-lines admin screen **and** the insurer directory all render it |
| **two · record type** | the record-category names on `/internal-controls` | ✅ **CLOSED, by decision 53** | `docs/decision-53-type-record-number-cell.md` — the rejected alternative was *«نخلّي العمودين، ونكتب تسع كلمات عربية جديدة»*, and it was rejected because **«التسع كلمات كلهن كنّ مُشتَقّات من نصوص شغّالة عندنا أصلاً»**. Its own words: *«والبندُ اللي كان متوقفاً بانتظار «تسع كلمات مطلوبة من المالكة» انقفل بالقرار ٥٣ — بلا ما تُكتَب كلمة واحدة»* |

⟶ **The «nine» the pre-module papers remember is decision 53's rejected alternative, and that decision closed it.** It is the same count because it is the same nine. **No question goes up, and none should** — asking for a word that already ships is the thing §4 of `00a` and §4.4 of the index both forbid.

> **And decision 53 carries its own reopening condition, which is worth knowing before anyone tidies that column:** *«من يفصلهم مرة ثانية … يرجّع سؤال التسع كلمات اللي انقفل»* — splitting the cell back into two columns **reopens the closed item**. The change is not a column layout; it is a decision.

## Derived names this measurement would need — and I derived none, because none is needed

**Zero new Arabic in this batch, and zero candidates to ratify.** Every name the three measured items need already ships. The two items that WOULD need a word are both blocked before the word:

| place | what would need a name | status |
|---|---|---|
| the geographic-branch scope (§4.3 / art. 21/b/6) | a label for a branch-scoped suspension state, and `Branch` has no location field to name either | 🔴 **not a naming question yet** — the modelling decision comes first. Asking for a word now would get an answer for a shape that may not be the shape |
| the declared-action window (§4.1 / §5.1) | nothing | ✅ **already answered** — §3 of the module paper records the art. 15/د notice text as *«صاغَها المستشارُ بحرفِها، تُستعمَل كما هي ولا تُخترَع»* |

**An honest «cannot derive», stated with its cause, in the shape the brief asked for:** the precedent it names — `toMachineName('دور جديد')` returning an empty string, so an Arabic-only name cannot yield a machine name — is a *mechanical* impossibility. Nothing in this measurement reached one. What it reached instead was the opposite: **four separate claims that a word was owed, and in all four the word was already in the repository.** `00a`'s own note predicted the ratio — *«آخرُ مرّة: ١٠ من ١١ كلمةً كانت موجودةً أصلاً»* — and this batch is 7 of 7 plus 2 closed.

---

# §4 — Four things measured against the brief's §2

| brief | reproduces? | measured |
|---|---|---|
| §2.1 — `RegulatoryAction` is better than the paper assumes | ✅ **confirmed, and more so** | It carries `basis`, derives art. 14/c rather than storing it, folds an append-only series on a **total** comparator (`effectiveFrom`, then `recordedAt`, then `id` — the first two were added after an e2e failed on a recommendation send because a suspension and its reinstatement shared a date), and feeds **one** gate at 8 sites. **One correction: `documentId` is nullable.** |
| §2.1 — «extend `RegulatoryAction` with a scope» is a smaller module | ⚠ **half** | **Smaller for the insurance-branch half** (three precedents + data). **Not smaller for the geographic half**, which is blocked on a modelling decision, not sized |
| §2.2 — `OrgStatus.SUSPENDED` vs `RegulatoryAction` conflation is the hazard | 🔴 **does NOT reproduce — and the real state is stranger** | **`OrgStatus` appears in ZERO TypeScript files** (`grep -rn "OrgStatus" --include=*.ts --include=*.tsx .` excluding `node_modules`/`dist` → exit 1). `Organization.status` has **exactly one reader**: `organization-resolution.service.ts:94`, which returns it on the public `GET /orgs/resolve`. **No web file calls that route** (`grep -rn "\"/orgs" apps/web` → nothing) and **nothing in `modules/auth/` reads it.** ⟶ **No code path treats the two as the same thing, because no code path reads the commercial one at all.** The schema comment *«blocks login, data retained»* describes behaviour that **is not implemented** — the inverse of an absence claim, and false in the same quiet way. Both failure directions the brief names are currently **unreachable**, and the second one — reporting a non-payment suspension as a sanction — **cannot happen**, because nothing reads `Organization.status` to report |
| §2.3 — `assertDifferentActors` is enforced in the database, not just the app | ✅ **confirmed, and the enforcement is 16 constraints + 1 trigger on the live DB** | **But the conclusion inverts: «allow it, declare it, log it» is not a boolean AND is not work — it shipped on 2026-10-28.** And the migration population is **eight**, not five; the three that matter most are invisible to the `assertDifferentActors` literal |

**One more, not on the brief's list:** **four different enums in this codebase have a `SUSPENDED` member** — `OrgStatus` (commercial, unread), `DerivedLicenseStatus` (the CBJ sanction, derived), `CbjApprovalStatus` (a person's approval), `CustomerStatus`. The conflation hazard §2.2 names is real as a *reading* hazard across those four even though no code path commits it, and `DerivedLicenseStatus.SUSPENDED` is the only one that means what module 1 means by it.

---

# §5 — The size of the module as a whole

**The paper calls it «متوسط». Measured, that still holds — but the composition is different, and one piece is not sized at all.**

| §4 item | paper's assumption | measured | delta |
|---|---|---|---|
| **4.5** وضعُ المكتبِ المُعلَن | the DB refuses; work owed | **BUILT** — 16 CHECKs + 1 trigger + engine + screen + 713-line design doc | **−** removed entirely |
| **4.2** جدولُ القيمِ القانونية | from scratch | **half built** — `SlaPolicy` is the shape, date-effective and source-cited, live. Non-duration values from scratch; two limits recorded | **−** roughly halved |
| **4.1** سجلُّ الأفعالِ المُعلَنة | from scratch | **from scratch, with a proven template**: `CombinedDutyAct` already is *allow + declare + log* with a reason floor, the actor, the roles held and the hat worn. A separate permission to authorise the declaration is the one genuinely new piece | ≈ unchanged, de-risked |
| **4.3** علم «موقوف» الجزئيّ | «وهو وحده شغل» | insurance half **small** (3 precedents); geographic half 🔴 **BLOCKED on a modelling decision** | **+** and partly unsizeable |
| **4.4** فترةُ السماحِ المشروطة | — | **small** — `renewalRequestedAt` and `isValidPendingRenewalDecision` exist and already drive `RENEWAL_PENDING`/`mayPractise`; the addition is gating it on uploaded proof | small |
| **criterion 6** الشرحُ العربيّ | verify, don't build | verified **230/230**; two red checks and one CI step owed | small |

### ⟶ So: **«متوسط» stands, and I am not stopping.** But two sentences qualify it:

**1 · One sub-item is larger than the paper says and is not a size.** §4.3's geographic half needs *does a transaction belong to a branch, and which field decides it?* answered before a column is written. Under §7 prohibition 5 that is reported now. **The rest of the module can be built around it** — the insurance-branch half, §4.1, §4.2 and §4.4 do not depend on it.

**2 · And the first batch is smaller than the paper implies**, because §4.5 is done and §4.2's shape already exists. **The honest first batch is criterion 1's gate** — which is also the one the brief asks for and the one worth having early.

---

# §6 — The four quality criteria that need a plant each

| criterion | satisfiable today? | what it needs |
|---|---|---|
| **1 · صفرُ رقمٍ قانونيٍّ في الكود، بفحصٍ يفشل لو انكتبَ رقمٌ جديد** | ⚠ **the gate is buildable NOW; the state it ratchets is not zero** | The discriminator is specified and **self-tested 7/7 both ways** above. The population is **3 real** (one of them a duplicate), so it lands as a **budget of 3 ratcheted in both directions**, not a fail-on-any — the shape `MISSING_DESCRIPTION_BUDGET` uses, which reached 0 by being lowered as the work got done. **Build it on the declaration's own comment BLOCK, not a 12-line window** — that is what produced this batch's one false positive. **Needs no application code**, so it is the next batch |
| **2 · القيمةُ تُقرأ بتاريخِ الحركةِ** | ⚠ **partly already true** | A plant is possible **today** on the `SlaPolicy` path: set `effectiveTo` on a row, insert a successor, assert a past-dated transaction reads the old value. Blocked by `@@unique([organizationId, policyCode])` — **so the first plant on this criterion is against the uniqueness, not against the read.** `sla-timer.service.ts:247`'s missing `at` is a second, independent plant |
| **3 · الإعلانُ ما يمرُّ بلا صلاحيتِه المنفصلة** | ❌ **needs code** | The permission does not exist. **But the plant shape is proven**: `duty-segregation` already asserts the mode/act/reason triple, and `permission-enforcement.inventory.spec.ts` already refuses a declared-but-unenforced code in both directions — a new code must gate a real route or that spec fails |
| **4 · الإيقافُ الجزئيُّ مُجرَّبٌ بمثالٍ مركَّب** | ❌ **needs code, and the geographic half needs a decision first** | The insurance-branch half is plantable the day the scope table exists (suspend LIFE, assert a GENERAL policy still places and a LIFE one does not — dev has 27 GENERAL and 5 LIFE lines and 74 scoped policies). **The composite example the criterion names — «موقوفٌ في إربد وفي تأمينِ الحياةِ وحدَهما» — is NOT plantable at any point on the current schema**, because no transaction carries a branch |
| **5 · فترةُ السماحِ لا تشتغل بلا إثبات** | ❌ **needs code** | `isValidPendingRenewalDecision` + `renewalRequestedAt` are the half that exists; the proof-document gate is the plant target |
| **6 · ٢٣٠/٢٣٠ ويُحرَس** | ✅ **verified; the guard bites; two gaps** | **Planted both ways this batch** — at the seed (green, the finding) and at the fixture the guard reads (2 of 9 red, naming the code). The two gaps are the two red checks and their missing CI step |

---

## What I will NOT build, and why

1. **The geographic-branch scope** — reported under §7 prohibition 5 instead. Five modules copy this shape; building it on *the acting user's branch* would be wrong in both directions, silently.
2. **Nothing for §4.5.** It is built. Re-building or "completing" it would be a second answer to *what may one person do* in a system under Central Bank supervision.
3. **No fix for the two red permission checks, and no CI step** — a CI edit is not this batch's, for the recorded OAuth-App/`workflow`-scope reason, and the stale-mirror fix touches the owner's reviewed Arabic.
4. **The legal-number gate itself** — specified and self-tested here, not committed, because this batch writes no code. The instrument is at `scratchpad/legal-number-discriminator.py` and its full rules are in §1.3 above so it is re-derivable rather than remembered.
5. **The duplicated art. 11 `45`** — reported, not corrected. It is criterion 1's first customer and belongs in the batch that builds the table, not in a measurement.
6. **Nothing touching the 32→26 mapping**, per §7 prohibition 4 and decisions 9, 20 and 122. Noted only that `InsuranceLine` holds **32** rows (27 GENERAL / 5 LIFE), which is the 32 side and is already built.

---

## Questions only my module's answerer can answer

1. 🔴 **Does a transaction belong to a geographic branch, and which field decides it?** Blocks art. 21/b/6 entirely. **Ask: a practising broker + the existing office** — *«لمّا تكتبوا بوليصة، هي محسوبة على أيِّ فرع — فرعِ الموظفِ اللي كتبها، ولا فرعٍ ثاني؟ وكيف تعرفونها اليوم؟»*
2. 🔴 **Does `Branch` need a country, or is «خارج المملكة» out of scope for this office?** Art. 21/b/6 and art. 23's two-year window both turn on it. **Ask: the office** — a fact about them, not a legal question.
3. **The eight unreadable numbers, and `15(e)(2)`.** Not code's, and not mine — §1 of the module paper. **The Official Gazette, the CBJ, or the brokers' association.** Nothing here hard-codes any of the eight.
4. **Should the non-duration legal values extend `SlaPolicy` or sit in their own table?** A duration and a capital tranche share every column except the value's unit. **Ask: the code and the engineer** — and read `@@unique([organizationId, policyCode])` first, because the answer turns on whether superseded rows must sit beside their replacements.
5. **Is `Organization.status` dead, or unfinished?** Its comment claims it blocks login; nothing reads it. **Either implement it or withdraw the sentence** — an unread column whose comment asserts behaviour is how §2.2's conflation becomes possible later.

---

## Reported, not resolved

| # | finding | where |
|---|---|---|
| 1 | **Art. 11's `45` has two literal homes**, and the second one's comment says it does not | `license-renewal-notice.config.ts:57-58`, read at `:162` |
| 2 | **`db:permission-descriptions:check` exits 1 on a clean tree** — stale mirror, 2 lines | `docs/permission-catalogue-for-descriptions.txt` |
| 3 | **`db:fixture:permissions:check` exits 1 on a clean tree** — 519 grants vs the fixture's declared 518 | `apps/web/e2e/fixtures/role-permissions.ts` |
| 4 | **Neither of those is a CI step**, so a permission with no Arabic description ships green | `.github/workflows/ci.yml` |
| 5 | **`Organization.status`'s comment claims «blocks login»; nothing reads it** | `schema.prisma:776` |
| 6 | **`sla-timer.service.ts:247` reads the SLA policy by today's date**, not the transaction's; `:206` does it right | |
| 7 | **`SlaPolicy`'s `@@unique([organizationId, policyCode])` prevents a superseded value sitting beside its replacement** | `schema.prisma:7122` |
| 8 | **`RegulatoryAction.documentId` is nullable** while the module paper's brief records it as required | `schema.prisma:7574` |
| 9 | **Four enums carry a `SUSPENDED` member** and only `DerivedLicenseStatus`'s is the CBJ one | |
| 10 | **§2-ب's م١ row shows a dash for «الكياناتُ الموجودةُ فعلاً»** while three module-1 entities exist | `00-index-order-assignment-and-questions.md:146` |

---

## Recorded as deferred, with its waking condition

| deferred | wakes when |
|---|---|
| The geographic-branch scope for art. 21/b/6 | questions 1 and 2 above are answered. **Until then no column is added**, and the insurance-branch half ships without it |
| Anything on art. 15(e) | its sub-item (2) is obtained from a non-scanned copy — §1 of the module paper |
| The `SlaPolicy` uniqueness limit | the first non-duration legal value needs a superseded predecessor readable by a past transaction date |

---

## Raw verification — every gate re-run AFTER the last edit

| gate | result |
|---|---|
| `git diff --stat` | **EMPTY** |
| `git diff --stat origin/main -- apps packages` | **EMPTY** |
| `git status --short` | `?? _to_delete/` only — untracked and present at session start |
| `npm run check:maker-checker-pairs` | **exit 0** — 16 pairs / 16 constraints / 16 projecting / 18 view sites |
| `npm run check:rendered-identifiers` | **exit 0** — 106 screens, 11 identifiers, at budget |
| `npm run check:labels` | **exit 0** — no prompt names a column, budget 0 |
| `apps/web` unit: `permission-descriptions.test.ts` | **1 file / 9 tests passed** |
| live dev DB | 230 permissions · 16 `*_maker_checker_distinct` CHECKs · 1 non-internal trigger on `CombinedDutyAct` |
| `npm run db:permission-descriptions:check` | 🔴 **exit 1 — PRE-EXISTING, see Reported #2** |
| `npm run db:fixture:permissions:check` | 🔴 **exit 1 — PRE-EXISTING, see Reported #3** |
| legal-number discriminator `--self-test` | **7/7**, after the first run caught its own case-sensitivity gap at 5/7 |
| plants | **2, and the informative one is the plant that killed nothing** — see §1.4 |

**Both red gates were measured on a clean tree before this branch existed, at `85d9dcbd`, an ancestor of `origin/main`.** Neither is caused by this batch, which changes no code.

**No e2e ran. No database was written to.** Every probe is a `SELECT`; both plants were reverted and verified reverted by an empty `git diff`. **db-test was not touched at all — no reset is owed.**

### Two things that went wrong in my own measuring, recorded because the method matters more than the figures

**1 · `cd` persisted between Bash calls, twice.** The first time a `cd packages/db/prisma/migrations` made the next `grep` answer *No such file or directory* for `apps/api/src`; the second time a `cd apps/web` sent a `cp` and an `npm run` to the wrong root, which **left a plant in place for one extra call**. This is the recorded finding from 2026-11-08 — *«`cd` PERSISTS BETWEEN BASH CALLS — USE `git -C <abs>`»* — hit twice in one session. Every later call is absolute-pathed, and the plant's removal is proven by an empty `git diff` rather than by having run a `cp`.

**2 · Three figures of mine were wrong before they were right, and all three were the instrument.** The `perm:` key count read **231** because the pattern matched a comment quoting itself. The role and grant counts read **29 / 1,346** against the fixture's **12 / 519** because my unit was *all roles in all 8 organizations* and the fixture's is *`isSystem` roles in the default office*. And `Policy` read **0 scoped** because I counted `officeInsuranceLineId` (genuinely 0) and not `insuranceLineId` (**74 of 74**). ⟶ **The counting unit is stated beside every figure in this paper for that reason.**

---

> ### 👤 **مَن يمسك هذا المديول** — written into `module-01-declared-action-and-legal-values.md` as part of this batch
>
> **Claude (Opus 5) · 2026-11-10 · القياسُ الافتتاحيُّ وحده.**
>
> **🔴 وحدٌّ يُقال صريحاً ولا يُترَك ليُفهَم:** سطرُ المالكِ يقول إنّ صاحبَه **يسأل محامياً، ويسأل وسيطاً يعمل فعلاً، ويُسأل عن قراراتِه**. ⟶ **والثلاثةُ خارجَ ما أقدر عليه.** فما أمسكه هو **القياسُ** — وما يحتاج جواباً من بشرٍ مذكورٌ بنصِّه في § Questions، **والبندُ الأوّلُ من المديولِ (تحصيلُ نسخةٍ نصّيةٍ من الصكّ) تقول ورقتُه بنفسِها إنّه «لا يكتبه كود».** **فالسطرُ مكتوبٌ كما أُمِرتُ، ومعه ما لا يغطّيه.**
