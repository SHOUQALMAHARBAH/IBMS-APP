# Module 0-ب — reference values and new enum members, AS SEEDED

**GENERATED — do not hand-edit.** `npm run db:reference-values`

Read from the seeded database, not from the seed source, for the same reason the permission
catalogue is: what a screen renders is what the database holds, and a document generated from
the source can disagree with it.

## LegalForm — الشكل القانوني — 7 row(s)

**RULE-BEARING.** Art. 10/a/1/a requires a natural-person broker to register as a SOLE ESTABLISHMENT, so the row decides whether a registration is well-formed. Rule-bearing.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `SOLE_ESTABLISHMENT` | Sole establishment | مؤسسة فردية | الشكل القانوني لوسيط التأمين الطبيعي. المادة 10/أ/1/أ من تعليمات رقم (9) لسنة 2026 تشترط تسجيل طالب الترخيص كوسيط تأمين طبيعي كمؤسسة فردية. ولا يجوز لهذا الشكل فتح أكثر من خمسة فروع (المادة 13/ب). |
| `FOREIGN_COMPANY_BRANCH` | Branch of a foreign company operating in the Kingdom | فرع لشركة أجنبية عاملة | شكلٌ قانونيٌّ للوسيط الاعتباري: فرعٌ لشركةٍ أجنبيةٍ عاملةٍ في المملكة. وسندُه المادة (١٠/أ/١/ب) من تعليمات ترخيص وسيط التأمين رقم (٩) لسنة ٢٠٢٦، التي تُوجب أن يكون مقدّمُ طلبِ الترخيص كوسيطٍ اعتباريٍّ مسجَّلاً «كشركةٍ أو فرعٍ لشركةٍ أجنبيةٍ عاملةٍ حسب مقتضى الحال». ولا يُختار هذا الشكلُ لوسيطٍ طبيعيٍّ، لأنّ المادة (١٠/أ/١/أ) تُوجب تسجيلَه مؤسسةً فردية. |
| `PUBLIC_SHAREHOLDING` | Public shareholding company | شركة مساهمة عامة | شركة مساهمة عامة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها. |
| `PRIVATE_SHAREHOLDING` | Private shareholding company | شركة مساهمة خاصة | شركة مساهمة خاصة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها. |
| `LIMITED_LIABILITY` | Limited liability company | شركة ذات مسؤولية محدودة | شركة ذات مسؤولية محدودة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها. |
| `GENERAL_PARTNERSHIP` | General partnership | شركة تضامن | شركة تضامن. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع. |
| `LIMITED_PARTNERSHIP` | Limited partnership | شركة توصية بسيطة | شركة توصية بسيطة. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع. |

## LicensingAuthority — الجهة المرخِّصة — 1 row(s)

**RULE-BEARING.** Which regulator issued the licence. Rule-bearing: the instructions this product implements are the Central Bank’s, and a licence from another authority is not governed by them.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `CBJ` | Central Bank of Jordan | البنك المركزي الأردني | **— OWED —** |

## BusinessModel — نموذج العمل — 2 row(s)

**RULE-BEARING.** Takaful versus conventional. Rule-bearing in WORDING ONLY — it changes terminology on documents and NOTHING may branch on it, or it quietly becomes a second product.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `CONVENTIONAL` | Conventional insurance | تأمين تقليدي | نمط النشاط التقليدي. يحدّد صياغة العروض والوثائق ومصطلحاتها، وتُشتقّ هذه الصياغة من قوالب مرتبطة بهذا السطر — لا من شرط في الشيفرة، حتى يكون إدخال نمط ثالث سطراً وقوالبَ لا إصداراً جديداً. |
| `TAKAFUL` | Takaful insurance | تأمين تكافلي | نمط النشاط التكافلي. يحدّد صياغة العروض والوثائق ومصطلحاتها (اشتراك بدل قسط، وفائض بدل ربح)، وتُشتقّ من قوالب مرتبطة بهذا السطر لا من شرط في الشيفرة. قوالب المصطلحات التكافلية لم تُبنَ بعد — انظر سجلّ المؤجَّل. |

## RatingAgency — وكالة التصنيف — 4 row(s)

**RULE-BEARING.** Paired with a financial-strength rating by `Insurer_rating_carries_its_date`: a rating with no agency and no as-of date is a number nobody can source.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `AM_BEST` | AM Best | إيه إم بست | **— OWED —** |
| `SP_GLOBAL` | S&P Global Ratings | إس آند بي جلوبال للتصنيف | **— OWED —** |
| `MOODYS` | Moody's | موديز | **— OWED —** |
| `FITCH` | Fitch Ratings | فيتش للتصنيف | **— OWED —** |

## Currency — العملة — 3 row(s)

**RULE-BEARING.** Every threshold in Instructions No. 9 of 2026 is in JOD, and there is no conversion path — so a non-JOD amount cannot be compared against any of them. Rule-bearing by its absence.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `JOD` | Jordanian Dinar | دينار أردني | **— OWED —** |
| `USD` | US Dollar | دولار أمريكي | **— OWED —** |
| `EUR` | Euro | يورو | **— OWED —** |

## Country — الدولة — 1 row(s)

**A LABEL.** A label. Not validated against the city, declared.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `JO` | Jordan | الأردن | **— OWED —** |

## City — المدينة — 12 row(s)

**A LABEL.** A label. Not validated against the country, declared.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `AMMAN` | Amman | عمّان | **— OWED —** |
| `IRBID` | Irbid | إربد | **— OWED —** |
| `ZARQA` | Zarqa | الزرقاء | **— OWED —** |
| `BALQA` | Balqa (Salt) | البلقاء (السلط) | **— OWED —** |
| `MAFRAQ` | Mafraq | المفرق | **— OWED —** |
| `JERASH` | Jerash | جرش | **— OWED —** |
| `AJLOUN` | Ajloun | عجلون | **— OWED —** |
| `MADABA` | Madaba | مادبا | **— OWED —** |
| `KARAK` | Karak | الكرك | **— OWED —** |
| `TAFILAH` | Tafilah | الطفيلة | **— OWED —** |
| `MAAN` | Ma'an | معان | **— OWED —** |
| `AQABA` | Aqaba | العقبة | **— OWED —** |

## Bank — البنك — 14 row(s)

**A LABEL.** A label on the office’s banking details and on a bank guarantee. The art. 15/i client-funds rules are module 14’s and read no row here.

| code | English name | Arabic name | Arabic description |
|---|---|---|---|
| `ARAB_BANK` | Arab Bank | البنك العربي | **— OWED —** |
| `HOUSING_BANK` | Housing Bank for Trade and Finance | بنك الإسكان للتجارة والتمويل | **— OWED —** |
| `BANK_OF_JORDAN` | Bank of Jordan | بنك الأردن | **— OWED —** |
| `JORDAN_AHLI_BANK` | Jordan Ahli Bank | البنك الأهلي الأردني | **— OWED —** |
| `CAIRO_AMMAN_BANK` | Cairo Amman Bank | بنك القاهرة عمّان | **— OWED —** |
| `JORDAN_KUWAIT_BANK` | Jordan Kuwait Bank | البنك الأردني الكويتي | **— OWED —** |
| `BANK_AL_ETIHAD` | Bank al Etihad | بنك الاتحاد | **— OWED —** |
| `CAPITAL_BANK` | Capital Bank of Jordan | كابيتال بنك | **— OWED —** |
| `ARAB_JORDAN_INVESTMENT_BANK` | Arab Jordan Investment Bank | بنك الاستثمار العربي الأردني | **— OWED —** |
| `INVEST_BANK` | InvestBank | بنك الاستثمار | **— OWED —** |
| `ABC_BANK_JORDAN` | Arab Banking Corporation (Jordan) | بنك المؤسسة العربية المصرفية (الأردن) | **— OWED —** |
| `JORDAN_ISLAMIC_BANK` | Jordan Islamic Bank | البنك الإسلامي الأردني | **— OWED —** |
| `ISLAMIC_INTERNATIONAL_ARAB_BANK` | Islamic International Arab Bank | البنك العربي الإسلامي الدولي | **— OWED —** |
| `SAFWA_ISLAMIC_BANK` | Safwa Islamic Bank | بنك صفوة الإسلامي | **— OWED —** |

---

# The enums this module added — FOUR, not two

Measured against `origin/main`: 66 enums there, 70 here. The brief said two; these are the four,
and all eleven members need a description.

## BrokerageKind — نوع الوساطة — 2 member(s)

**Direct insurance brokerage or reinsurance brokerage. RECORDED AND READ BY NOTHING: no guard depends on it, and this product holds no regulatory text for reinsurance brokerage, so it can neither exempt nor bind such a broker. The registration screen says so on the field.**

| member | Arabic description |
|---|---|
| `DIRECT` | **— OWED —** |
| `REINSURANCE` | **— OWED —** |

## RegulatoryActionKind — نوع الفعل الرقابي — 3 member(s)

**What the regulator did. Append-only: the licence STATUS is derived from these acts and never stored (decision 71).**

| member | Arabic description |
|---|---|
| `SUSPENSION` | **— OWED —** |
| `CANCELLATION` | **— OWED —** |
| `REINSTATEMENT` | **— OWED —** |

## RegulatoryActionBasis — سند الفعل — 2 member(s)

**Whether a suspension is at the broker’s OWN REQUEST (art. 14/a) or a SANCTION (art. 21/b). Load-bearing: art. 14/c’s two-year deemed-cancellation applies to the first and whether it reaches the second is UNSETTLED in the text and is not inferred.**

| member | Arabic description |
|---|---|
| `BROKER_REQUEST` | **— OWED —** |
| `SANCTION` | **— OWED —** |

## IntegrationMethod — طريقة التكامل — 4 member(s)

**How the system exchanges data with an insurance company. An enum because these are four genuinely different code paths, and `api_endpoint` is required only for API. NO CREDENTIAL ever enters these tables.**

| member | Arabic description |
|---|---|
| `API` | **— OWED —** |
| `PORTAL` | **— OWED —** |
| `EMAIL` | **— OWED —** |
| `MANUAL` | **— OWED —** |

---

## What is owed, counted

| | count |
|---|---|
| reference-table rows | **44** |
| enum members | **11** |
| **total values needing an Arabic description** | **55** |

The brief estimated "roughly forty". The measured figure is above, and it is higher because the
module added four enums rather than two. Rows that already carry a `descriptionAr` are shown
with it, so what is written is not re-written.
