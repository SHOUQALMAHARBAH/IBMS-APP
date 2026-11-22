# IBMS — القرار ١٥٧: أجوبة الإدارة عن ورقة الأجوبة الرابعة (كلام إنجليزي باقٍ على شاشات العرض · ١٩ تشرين الثاني ٢٠٢٦)

## القرار بجملة

الكلام الإنجليزي الباقي على شاشات خطّ العرض يأخذ عربيّه من الجدول أدناه، وجملة رفض طلب العرض تسمّي حالة الفرصة باسمها، وجدول «عمليات تحتاج شخصين» يصير ستّ عشرة عملية بلا عمود الأسماء البرمجية، وجمل تعليق «اعرف عميلك» تُكتَب بعد العرض مع مديول ١٥.

## كلام الإدارة بحرفه

«1. أ. 2-10. موافقة ع كلهم. 11. أ. 12.أ.»

**ورقة الأسئلة:** `answer-sheet-4-2026-11-19.md`. **القياس:** `measure-english-left-on-demo-screens.md` (على `2cb95423`). كلاهما في `IBMS-DOC\demo\`.
**المديول:** مديول ١ (صياغة وشاشات). البند ١٢ يُحمَل إلى مديول ١٥. **يكمّل القرار ١٥٣ ويعدّل صفّيه ٧ و١٦.**
**رقم القرار:** ١٥٧، من ورقة الاستلام (`msg-48\handover-19nov.md`، البند ٣٦: «رقم القرار التالي: ١٥٧»). **جلسة التنسيق تبدأ من ١٥٨.**

---

## الأحكام

| # | السؤال | الحكم |
|---|---|---|
| ١ | جملة رفض طلب العرض | **أ:** جملة القرار ١٥٣ نفسها، واسم الحالة يتغيّر وحده. |
| ٢ | ثلاث عشرة كلمة شغّالة في مواضع جديدة | **موافقة.** |
| ٣–١٠ | خانات فارغة باقتراحاتها | **موافقة على كلها.** |
| ١١ | جدول «عمليات تحتاج شخصين» | **أ:** يُشال عمود «العملية»، ويبقى عمود الصلاحية باسمها العربي. و«خمس عشرة» تصير «ستّ عشرة». |
| ١٢ | أسباب تعليق «اعرف عميلك» (إحدى عشرة جملة) | **أ:** بعد العرض، مع مديول ١٥. وقائمة «اعرف عميلك» لا تدخل سيناريو العرض. |

---

## النصوص المصادَق عليها (تُقتطَع من هنا، ولا تُكتَب باليد)

`{…}` موضع قيمة يضعها النظام. المسارات تحت `apps/web/`، وأرقام الأسطر على `2cb95423`.

### أ — يعدّل صفّين من القرار ١٥٣

| صفّ ١٥٣ | الموضع | كان مصادَقاً | صار |
|---|---|---|---|
| ١٦ | رفض طلب عرض على فرصة لا تقبله (جملة الخادم: `apps/api/src/modules/rfq/rfq.service.ts:721`) | لا يُنشأ طلب عرض أسعار على هذه الفرصة لأنها في مرحلة التنسيب. | لا يُنشأ طلب عرض أسعار على هذه الفرصة لأنها في مرحلة «{اسم الحالة}». |
| ٧ | `components/policy/PolicySection.tsx:627-629` | دقّقها: {اسم الموظف} | دقّقها: {اسم الموظف} في {التاريخ} |

**اسم الحالة** من قاموس حالات الفرصة الشغّال (`translations/rfq.ts:188-197`): «العروض مستلمة» · «المقارنة مبنية» · «التوصية مسوَّدة» · «أُرسلت إلى العميل» · «قرار العميل» · «التنسيب» · «إعادة تفاوض» · «مغلقة (خسارة)».

### ب — كلمات شغّالة في مواضع جديدة (البند ٢)

| # | الملف والسطر | يُطبَع اليوم | النص | مفتاح الكلمة الشغّالة |
|---|---|---|---|---|
| ٢-١ | `components/policy/PolicySection.tsx:411` | ` · Issued {المبلغ}` | القسط الصادر: {المبلغ} | `policyIssuedPremiumLabel` |
| ٢-٢ | `PolicySection.tsx:421` | `Expiry {التاريخ}` | تاريخ الانتهاء: {التاريخ} | `rcExpiresAtLabel` |
| ٢-٣ | `PolicySection.tsx:519` | `Effective {التاريخ}` | ساري من {التاريخ} | `endorsementEffectiveFromInputLabel` |
| ٢-٤ | `PolicySection.tsx:523` | ` · perils: ` | الأخطار المسمَّاة: | `policyNamedPerilsLabel` |
| ٢-٥ | `PolicySection.tsx:525` | ` · extensions: ` | التوسعات: | `policyExtensionsLabel` |
| ٢-٦ | `PolicySection.tsx:653` | ` · to {الاسم} · ` | المستقبِل: {الاسم} | `policyDeliveryRecipientLabel` |
| ٢-٧ | `components/claim/ClaimCard.tsx:658` | ` · settled` | مسوّاة | `claimStatusSettled` |
| ٢-٨ | `components/policy/CommissionSection.tsx:221` | `(approved)` | (معتمد) | `claimSettlementApprovedSeparator` |
| ٢-٩ | `CommissionSection.tsx:351` | `Insurer statement amount` | مبلغ كشف الحساب | `polCommStatementAmount` |
| ٢-١٠ | `app/(app)/needs-assessments/new/page.tsx:152` | `— select —` | اختر… | القرار ١٥٣، الصفّ ٢٠-أ |
| ٢-١١ | `components/needs-assessment/NeedsAssessmentReviewPanel.tsx:110` | `Mark reviewed` | تسجيل المراجعة | `dpiaRecordReviewButton` |
| ٢-١٢ | `app/(app)/insurance-programs/[id]/page.tsx:188` | حالة التقييم خاماً | اسمها من قاموس حالات تقييم الاحتياجات | `ENUM_LABEL.NeedsAssessmentStatus` |
| ٢-١٣ | `app/(app)/commission/page.tsx:277` | `Closed` | مغلق | `incStatusClosed` |

### ج — خانات كانت فارغة (البنود ٣ إلى ١٠)

| # | الملف والسطر | يُطبَع اليوم | النص |
|---|---|---|---|
| ٣ | `PolicySection.tsx:413` | ` (Δ {المبلغ})` | (الفرق: {المبلغ}) |
| ٤ | `PolicySection.tsx:629` | ` on {التاريخ}` | (في الجدول أ: «دقّقها: {اسم الموظف} في {التاريخ}») |
| ٥-أ | `ClaimCard.tsx:652` | ` · broker-processed` | الوسيط هو من ينفّذ هذه الدفعة |
| ٥-ب | `ClaimCard.tsx:655` | ` · second-approved` | تمّ الاعتماد الثاني |
| ٥-ج | `ClaimCard.tsx:656` | ` · awaiting a second approver` | بانتظار الاعتماد الثاني |
| ٦-أ | `CommissionSection.tsx:220` | `(pending approval)` | (بانتظار الاعتماد) |
| ٦-ب | `CommissionSection.tsx:351` | `(must equal {المبلغ})` | (يجب أن يساوي {المبلغ}) |
| ٧ | `insurance-programs/[id]/page.tsx:199` | `{العدد} asset(s) surveyed` | عدد الأصول: {العدد} |
| ٨ | `insurance-programs/[id]/page.tsx:187-188` | ثمانية أحرف من الرقم الداخلي ثم `({الحالة})` | تقييم الاحتياجات ({الحالة}) |
| ٩-أ | `NeedsAssessmentReviewPanel.tsx:154` | `Return for changes` | إعادة للتعديل |
| ٩-ب | `components/needs-assessment/NeedsAssessmentForm.tsx:161` | `Save draft & see recommended cover` | حفظ المسودة وعرض التغطية الموصى بها |
| ٩-ج | `NeedsAssessmentForm.tsx:162` | `Save questionnaire` | حفظ الاستبيان |
| ١٠ | `components/access-recertification/StartCyclePanel.tsx:59-61` | `Cycle "…" started — your review queue below now reflects it.` | بدأت الدورة «{اسمها}»، وهي الآن في قائمة المراجعة أدناه. |

**الفاصل « · » بين أجزاء السطر الواحد يبقى كما هو.** والرقم الداخلي في البند ٨ لا يُعرَض.

### د — جدول «عمليات تحتاج شخصين» (البند ١١)

| المفتاح | الملف والسطر | كان | صار |
|---|---|---|---|
| `dutySegIntro` | `translations/operations.ts:703` | خمس عشرة عملية | ستّ عشرة عملية |

**ولا تتغيّر كلمة أخرى في الجملة.** وعمود «العملية» (`app/(app)/settings/roles/page.tsx:728`، وعنوانه `dutySegColOperation`) يُشال. يبقى عمود الصلاحية، ويعرض اسمها العربي بعد رسالة ٥٠.

**عيب معلوم قبلته الإدارة:** صفّا تقييم الاحتياجات (مراجعة، واعتماد) يحملان الصلاحية نفسها، فيظهران متشابهين.

---

## ما يُحمَل لما بعد العرض

**البند ١٢ — مديول ١٥ (غسل الأموال):** إحدى عشرة جملة إنجليزية يركّبها الخادم سبباً لتعليق ملفّ «اعرف عميلك» (`apps/api/src/modules/customer/screening-hold.config.ts:288-398`، تُطبَع في `components/customer/KycQueue.tsx:273`). لكل سبب رمز ثابت. تُكتَب بالعربية بتمهّل وتصادق عليها الإدارة. **وحتى ذلك: قائمة «اعرف عميلك» خارج سيناريو العرض.**

---

## ما لا يحتاج قراراً ويُبنى مع هذا

- زرّ `Start cycle` (`StartCyclePanel.tsx:118`): مفتاحه العربي موجود وغير مستعمَل، «بدء دورة» (`acrStartCycleButton`، `operations.ts:281`).
- `OFFICE_ADMINISTRATOR` في الصفحة الرئيسية (`app/(app)/page.tsx:83-92`): الكلمة الشغّالة «مدير المكتب» (`provider.ts:162`). والدور الذي ينشئه المكتب يُعرَض باسمه العربي لا برمزه.
- مستندات المطالبة (`ClaimCard.tsx:252`): تُعرَض من القاموس الشغّال `ENUM_LABEL.ClaimDocType`.

## ما بقي عند جلسة التنسيق

- الصفّان ١٠ و١١ من القرار ١٥٣ بُنيا بكلمات غير المصادَق عليها («تاريخ الإنشاء: …» · «برنامج التأمين» وتحته «الحالة: …»). تُترَك أم تُطابَق.
- الصفّ ١٨: `crmIntro` نصّه غير `customerCrmIntro`؛ يُقرأ كاملاً قبل أن يُمَسّ.
- **ليس سؤالاً، للعلم:** النصف الإنجليزي لهذه المواضع هو المكتوب اليوم داخل الشاشة، فيصير مفتاحاً في القاموس بنصّه الإنجليزي كما هو.

---

## For the engineer — decision 157 (English)

**Copy this file into `docs/` verbatim, with an index row.** Measured on `2cb95423`; paths are under `apps/web/` unless written otherwise. **Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** No Arabic word is invented: every Arabic string is in the tables above; slice from them, never retype. A string you need that is not there is an empty cell in your report. No role is granted a permission code.

**§1 — the strings (tables أ, ب, ج).** Each hardcoded English fragment named in the tables becomes a dictionary key whose Arabic is the table's text and whose English is the fragment as it reads today. Where the Arabic is a shipping word used on another screen, **give the new site its own key with the same text**, so a later change to one does not move the other. The ` · ` separators stay. `PolicySection.tsx:627-629` renders the checker's name, never `checkedByUserId`. `insurance-programs/[id]/page.tsx:187-188` renders «تقييم الاحتياجات ({الحالة})» with the status through `ENUM_LABEL.NeedsAssessmentStatus`, and no part of the id. Byte-exact assertions on every key.

**§2 — the RFQ refusal names the status (table أ, row 16).** `apps/api/src/modules/rfq/rfq.service.ts:721` refuses in every status other than `NEEDS_CONFIRMED` and `RFQ_ISSUED`. The screen renders the ratified sentence with the opportunity's status through the shipping status labels (`oppStatus*`, `translations/rfq.ts:188-197`). How the screen learns the status (a stable code on the error, or the opportunity it already holds) is yours to choose; report which. The server's English sentence may stay as the English text. Assert the sentence for `PLACEMENT` and for `CLOSED_LOST`.

**§3 — the dual-control table (table د).** `dutySegIntro` (`translations/operations.ts:703`): «خمس عشرة عملية» becomes «ستّ عشرة عملية», nothing else. Remove the operation column (`settings/roles/page.tsx:728`) and its header; the permission column stays and renders the permission's ratified name. The two `NeedsAssessment` rows will read alike: the owner knows. **A test asserts the number in the sentence equals the row count from `apps/api/src/common/maker-checker-pairs.config.ts`**, so the next pair added fails a test rather than a reader.

**Not in this decision, do not build:** the eleven KYC hold sentences (`screening-hold.config.ts:288-398`), carried to module 15 · anything in `ConsentCaptureWidget.tsx` (decision 154) · the off-path sites listed in §٥ of the measurement.

**With it, no ruling needed:** `StartCyclePanel.tsx:118` uses `acrStartCycleButton` · `app/(app)/page.tsx:83-92` renders a role's Arabic name, never its code (report what `/auth/me` returns) · `ClaimCard.tsx:252` renders `i.docType` through `ENUM_LABEL.ClaimDocType` · the five blind shapes of `hardcoded-ui-english.py`, in §4 of the measurement.
