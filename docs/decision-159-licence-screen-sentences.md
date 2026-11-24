# IBMS — القرار ١٥٩: جمل شاشة الترخيص بعد «التجديد قيد الدراسة»، ومن أقرّ ومتى، وتسمية المراسلة المرفقة (٢٢ تشرين الثاني ٢٠٢٦)

## القرار بجملة

جملة «ما زال ساريًا» تظهر بعد تسجيل الإقرار فقط وتذكر الإثبات والإقرار سبباً، وجملة تنبيه التجديد تذكر الإقرار، وتحت حالة الترخيص يُكتَب من أقرّ ومتى، وبعد إرفاق المراسلة يُكتَب ما أُرفق.

## كلام الإدارة بحرفه

«١ ب · ٢ أ · ٣ موافقة · ٤ موافقة»

**على ماذا أجابت:** الأسئلة الأربعة في آخر `measure-open-walk2-questions.md` (في `IBMS-DOC\demo\`)، كما عُرضت عليها في المحادثة بأمثلتها.
**المديول:** مديول ١. **يكمّل القرار ١٢٨** (الإثبات يفتح الإصدار، لا التاريخ) والقرارين ١٣٣ و١٣٩.
**رقم القرار:** ١٥٩. ورقة الاستلام قالت «التالي ١٥٨»، وأخذت هذه الجلسة ١٥٨ (عربيّ الزرع) ثم ١٥٩ في اليوم نفسه. **جلسة التنسيق تبدأ من ١٦٠.**

---

## الأحكام

| # | السؤال | الحكم |
|---|---|---|
| ١ | جملة «ما زال ساريًا لأن طلب التجديد قُدّم في موعده» | **ب:** تظهر بعد تسجيل الإقرار فقط، ويتغيّر سبب السريان فيها ليطابق القرار ١٢٨ |
| ٢ | جملة تنبيه التجديد عمّا يرفع المنع | **أ:** يُضاف الإقرار |
| ٣ | من أقرّ ومتى، تحت حالة الترخيص | **موافقة** على الجملة الشغّالة |
| ٤ | تسمية المراسلة بعد إرفاقها | **موافقة** على كلمات قائمة الاختيار نفسها |

---

## النصوص المصادَق عليها (تُقتطَع من هنا، ولا تُكتَب باليد)

المسارات تحت `apps/web/`، وأرقام الأسطر على `main` عند `654cb671`. **في كل صفّ يتغيّر المقطع المذكور وحده؛ لا تتغيّر كلمة أخرى ولا حركة.**

### ١ — `rcValidPendingRenewalDecision` (`lib/i18n/translations/compliance-risk.ts:234`)

| كان | صار |
|---|---|
| لأن طلب التجديد قُدّم في موعده، | لأن طلب التجديد قُدّم في موعده بإثباته وسُجِّل الإقرار، |

**النصّ الكامل بعد القرار:** «انتهى تاريخ هذه المدة المطبوع، ويُعامَل الترخيص على أنه ما زال ساريًا لأن طلب التجديد قُدّم في موعده بإثباته وسُجِّل الإقرار، إلى حين صدور قرار البنك المركزي. هذا قرار داخلي للمكتب ولا يستند إلى نص في تعليمات رقم (9) لسنة 2026.»

**ومتى تظهر:** حين تكون حالة الترخيص «قيدَ التجديد» بعد الإقرار، لا قبل. اليوم تظهر كلّما انتهى التاريخ والطلب قُدّم في موعده (`app/(app)/regulatory-compliance/page.tsx:509-515`)، فتقول «ما زال ساريًا» والنظام يمنع.

**مثال:** موظف الالتزام في مكتب الحياة يفتح الشاشة قبل الإقرار. يقرأ «لا يجوز للمكتب مباشرة أعمال جديدة» وحدها. يسجّل الإقرار، فتختفي وتظهر جملة «ما زال ساريًا… وسُجِّل الإقرار».

### ٢ — `rcNoticeFiled` (`compliance-risk.ts:385-386`)

| كان | صار |
|---|---|
| والذي يَرفعُ المنعَ هو تدوينُ | والذي يَرفعُ المنعَ هو تسجيلُ الإقرار، أو تدوينُ |

**النصّ الكامل بعد القرار:** «طلبُ التجديدِ مدوَّنٌ لدينا. وهذا لا يَرفعُ المنعَ ولا يُوقِفُ التنبيه: تقديمُ الطلبِ ليس قرارًا، والذي يَرفعُ المنعَ هو تسجيلُ الإقرار، أو تدوينُ مدّةِ الترخيصِ الجديدةِ مع شهادتِها.»

### ٣ — من أقرّ ومتى

| أين | النص | مصدره |
|---|---|---|
| تحت حالة الترخيص «قيدَ التجديد» | أقرّ به {الاسم} في {التاريخ} | الجملة الشغّالة `dpoAssignAcknowledgedOn` (`lib/i18n/translations/common.ts:316-317`) بحرفها |

الاسم والوقت محفوظان منذ يوم الإقرار (`LicenseRenewalDeclaration`: `actorNameShown` · `declaredAt`). يُعرَض **الاسم كما حُفظ يوم الإقرار**، لا اسم الحساب اليوم.

### ٤ — المراسلة بعد إرفاقها

| أين | النص | مصدره |
|---|---|---|
| مكان علامة «بلا إثبات» بعد الإرفاق (`components/rfq/Article15DRecord.tsx`) | طلب العميل، واصلاً بوسيلة تبليغ معتمدة | `a15dEvidenceLabel` (`lib/i18n/translations/rfq.ts:239`) بحرفها |
| ومعها | تاريخ المراسلة ثم وسيلتها، كما يطبعهما صفّ الاختيار قبل الإرفاق: «{التاريخ} · {الوسيلة}» | المكوّن نفسه؛ لا كلمة جديدة |

---

## مفتوح بعد هذا القرار (قياس، لا كلمات)

1. **هل تبقى جملة التنبيه (البند ٢) ظاهرة بعد الإقرار؟** إن بقيت قالت «وهذا لا يرفع المنع» والمنع مرفوع. لم أقسه. يكتبه المهندس في تقريره، وإن كانت تبقى يرجع سؤالاً للإدارة.
2. **الحالات الأخرى بلا جملة:** للترخيص المنتهي ستّ حالات في الخادم، والشاشة تخصّ واحدة منها بجملة. حالة «قُدّم الطلب بلا إثبات» مثلاً لا شيء يقول فيها للموظف: أرفق الإثبات. **لا يُبنى من هذا القرار**؛ يسرد المهندس ما تطبعه الشاشة في كل حالة.

---

## For the engineer — decision 159 (English)

**Copy this file into `docs/` verbatim, with an index row.** Line numbers are on `main` at `654cb671`; paths are under `apps/web/` unless written otherwise. **Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** No Arabic word is invented: every string is in the tables above; change the named span and nothing else, vowel marks included. No role is granted a permission code.

**§1 — `rcValidPendingRenewalDecision` (ruling 1-ب).** Two changes. *Words:* in `lib/i18n/translations/compliance-risk.ts:234` the span «لأن طلب التجديد قُدّم في موعده،» becomes «لأن طلب التجديد قُدّم في موعده بإثباته وسُجِّل الإقرار،»; byte-exact assertion on the whole string as written above. *Condition:* `app/(app)/regulatory-compliance/page.tsx:509-515` renders it on `license.validPendingRenewalDecision`, which `isValidPendingRenewalDecision` (`apps/api/src/modules/compliance-risk/broker-license.config.ts`) derives from two dates. Render it only when `standing.renewalUnderStudy.state === 'UNDER_STUDY'`. Whether the api flag itself changes is yours to judge: report every other reader of it first. The English half is not ruled: leave its words, move its condition with the Arabic.

**§2 — `rcNoticeFiled` (ruling 2-أ).** `compliance-risk.ts:385-386`: the span «هو تدوينُ» becomes «هو تسجيلُ الإقرار، أو تدوينُ». Byte-exact assertion. Report whether the notice still renders once the state is `UNDER_STUDY`; if it does, do not reword it, report it.

**§3 — who declared, and when (ruling 3).** `LicenseRenewalDeclaration` stores `actorNameShown` and `declaredAt`; the wire carries `{ state: 'UNDER_STUDY' }` alone (`lib/compliance-risk/broker-license-api.ts`). Carry both on that state and render, under the standing, a new key whose Arabic is byte-equal to `dpoAssignAcknowledgedOn` (`lib/i18n/translations/common.ts:316-317`), with the stored name and the date through `formatDate` (decision 156). The name is the one stored at the time, never the account's current name.

**§4 — the attached evidence is named (ruling 4).** After `POST /rfqs/:id/article-15-d/evidence`, `components/rfq/Article15DRecord.tsx` renders nothing where the «بلا إثبات» mark stood. Carry the communication's channel and date with the exemption and render `a15dEvidenceLabel` (`lib/i18n/translations/rfq.ts:239`) followed by the same `{date} · {channel}` row the candidate list renders. No new word.

**Report:** for each of the six `renewalUnderStudy` states and for `UNDER_STUDY`, exactly which sentences the licence screen renders after your change. Build nothing for the states this decision does not name.
