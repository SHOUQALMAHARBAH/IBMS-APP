# IBMS — القرار ١٥٦: شكل التاريخ على الشاشات، وجملة الجرس بلا تكرار، و«تعطيل» بدل «تقاعد» (١٩ تشرين الثاني ٢٠٢٦)

## القرار بجملة

التاريخ على الشاشات بشكل واحد «31/12/2028» والشهادة الورقية تبقى كما هي؛ وجملة الجرس لا تكرّر اسم الصلاحية وشرحها؛ وكلمة الفعل بجانب اسم العائلة في جدول الصلاحيات «تعطيل» لا «تقاعد».

## كلام الإدارة بحرفه

«القرار 1: أ. القرار 2: أ. القرار 3: أ.»

**على ماذا أجابت:** ثلاثة أسئلة عُرضت عليها في المحادثة بعد قياسَي ١٩ ت٢: `measure-permission-names-before-msg-50.md` و`measure-date-sites-before-msg-50.md` (في `IBMS-DOC\demo\`).
**المديول:** مديول ١. يكمّل ١٢٧ · ١٣١ · ١٤٤ · ١٤٦.
**رقم القرار:** أُخذ ١٥٦ من ورقة الاستلام (`msg-48\handover-19nov.md`، البند ٣٤: «رقم القرار التالي: ١٥٦»). **جلسة التنسيق تبدأ من ١٥٧.**

---

## الأحكام

| # | السؤال | الحكم | ما يعنيه |
|---|---|---|---|
| ١ | شكل التاريخ على الشاشات | **أ** | كل تاريخ على شاشة يُطبَع بالشكل الشغّال في معظم الشاشات: «31/12/2028». **الشهادة الورقية والأوراق الأربع تبقى «31 كانون الأول 2028».** |
| ٢ | جملة الجرس حين تنزل صلاحية جديدة | **أ** | حين يكون اسم الصلاحية مقتطَعاً من شرحها، يُطبَع الشرح وحده مرّة واحدة، بالجملة الشغّالة اليوم. |
| ٣ | كلمة «تقاعد» بجانب اسم العائلة | **أ** | تصير **«تعطيل»**، وهي الكلمة التي على أزرار النظام للفعل نفسه. |

---

## الحكم ١ — التاريخ

**مثال:** أحمد يفتح شاشة الترخيص. اليوم يقرأ انتهاء الترخيص «2028-12-31». بعد القرار يقرأ «31/12/2028»، كما يقرؤه في باقي الشاشات.

- **ما يتغيّر:** اللوحات السبع وشاشة الترخيص (عشرة تواريخ)، وملفّان مشتركان يخدمان ستّ شاشات تقارير أخرى، فتتغيّر معها. المواضع بالملف والسطر في ورقة القياس.
- **ما لا يتغيّر:** الشهادة الورقية والأوراق الأربع (اسم الشهر مكتوباً) · خانات إدخال التاريخ · اسم الشهر وحده تحت أرقام اللوحات («خلال تشرين الثاني 2026»)، وهو يُشحَن اليوم.
- **الشهر المطبوع خاماً «2026-11»** في ثلاثة مواضع يُطبَع بالدالّة نفسها التي تطبع «تشرين الثاني 2026» تحت الأرقام. هذا ليس شكلاً جديداً: هو الشغّال على الشاشة نفسها.
- **رأس المال** في شاشة الترخيص يُطبَع بشكل المبالغ الواحد (رسالة ٤٩): «JOD 10,000.000».
- **الساعة في «صُدِّر في»** (مؤشرات الأداء وخمس شاشات تقارير) تصير بساعة جهاز الموظف بدل التوقيت العالمي. **شكلها بالحرف لم يُرَ بعد:** المهندس يكتب في تقريره ما تطبعه الدالّة الشغّالة، وإن كان غير مقروء يرجع خانةً فارغة للإدارة.

## الحكم ٢ — جملة الجرس

**مثال:** تنزل صلاحية الإقرار بالتجديد. مدير المكتب يقرأ في الجرس: «صلاحية جديدة في النظام: يُقرّ بأن ترخيص المكتب قيد التجديد، وأنه لم يصله من البنك المركزي رفض ولا إشعار نقص، فيُفتح إصدار الوثائق. وهي غير صلاحية الإصدار. تتحكّم في: …». مرّة واحدة.

**القاعدة:** إن كان شرح الصلاحية يحتوي اسمها، تُطبَع الجملة الشغّالة التي بلا خانة الاسم (`notifNewPermissionSentenceNoName`). وإلا تُطبَع الجملة التي فيها الاسم (`notifNewPermissionSentence`). **لا كلمة جديدة في أي من الجملتين.**

| أيّ الأسماء | العدد | الجملة |
|---|---|---|
| مقتطَع من شرحه | ١٥٨ (١٥٦ من أوله، و٢ من وسطه) | الشرح وحده |
| بكلمة الإدارة | ١٧ | الاسم ثم الشرح، كما صودق |
| صلاحية من عائلة («الاسم · الفعل») | ٥٩ | الاسم ثم الشرح: الاسم ليس في الشرح فلا تكرار |

**قراءتي لا كلمتها، وتُشطَب إن اعترضت:** الاسمان المقتطَعان من وسط الشرح (`commission-reversal.create` · `user.manage`) يدخلان القاعدة نفسها، لأن سبب الحكم هو منع التكرار.

**ومعه، بلا كلمة:** الشرح الذي ينتهي بنقطة لا تُضاف بعده نقطة ثانية (اليوم تُطبَع «الإصدار.. تتحكّم في»).

## الحكم ٣ — «تعطيل»

**مثال:** أحمد يفتح جدول الصلاحيات. اليوم يقرأ «أدوار المكتب» وتحتها المربّعات «عرض · إنشاء · تعديل · تقاعد». بعد القرار: «عرض · إنشاء · تعديل · تعطيل».

| المفتاح | الملف والسطر | كان | صار | مصدر الكلمة |
|---|---|---|---|---|
| `roleVerbDeactivate` | `apps/web/lib/i18n/translations/operations.ts:655` | تقاعد | تعطيل | شغّالة على ثلاثة أزرار: `usrDeactivate` (`operations.ts:526`) · `orgUnitRetire` (`:626`) · `slapDeactivate` (`compliance-screening.ts:196`) |

**تظهر في سبع عائلات:** فروع المكتب · أقسام المكتب · شركة تأمين · وسائل الدفع المعتمَدة · أدوار المكتب · مهلة خدمة · سجل المورّدين. وفي جملة الرفض بعد رسالة ٥٠ («أدوار المكتب · تعطيل»).

---

## ما لم يغطّه الحكم ٣ أول مرّة، وسُئلت عنه الإدارة — **أُغلق في التكملة أدناه**

**على شاشة الأدوار نفسها ثلاثة نصوص أخرى فيها «تقاعد»، ولم تكن في السؤال:**

| المفتاح | الملف والسطر | النص اليوم |
|---|---|---|
| `roleRetireButton` | `operations.ts:723` | تقاعد الدور |
| `roleStatusInactive` | `operations.ts:696` | متقاعد |
| `roleSystemExplain` | `operations.ts:699` | … لا يمكن تغيير اسمه ولا **تقاعده** ولا تعديل صلاحياته … |

بعد الحكم ٣ يقرأ أحمد في الجدول «أدوار المكتب · تعطيل»، وعلى الزرّ في الشاشة نفسها «تقاعد الدور». **سُئلت الإدارة في اليوم نفسه فأجابت «أ»: الثلاثة تتبع الحكم ٣** (التكملة أدناه).

**و«متقاعد» لمفتاح التشفير** (`operations.ts:557` وشرح `encryption-key.read`) معنى آخر، ولا يدخل.

**والنصف الإنجليزي:** `roleVerbDeactivate` بالإنجليزية «Retire»، والأزرار «Deactivate». لم يُحكَم فيه؛ لجلسة التنسيق.

---

## ما يترتّب

1. **رسالة ٥٠ غير موقوفة.** بند التواريخ فيها يُكتَب «ابنِ» بالحكم ١.
2. **الحكمان ٢ و٣ يدخلان قسم أسماء الصلاحيات في رسالة ٥٠** لأنهما على الشاشة نفسها.
3. **أسماء الصلاحيات ١٩٦، وكلها مصادَق عليها** (قياس ١٩ ت٢): ١٧٢ من ملحق ١٤٤ §٣ · اثنان من ملحق ١٤٦ · واحد من القرار ١٤٥ · و٢١ اسم عائلة.

---

## تكملة القرار ١٥٦ (١٩ تشرين الثاني، بعد عرض النصوص الثلاثة على الإدارة)

**كلام الإدارة بحرفه:** «قراري أ»

**على ماذا:** النصوص الثلاثة الأخرى على شاشة الأدوار التي فيها «تقاعد». الخيار «أ» كما عُرض عليها: «تعطيل الدور» · «معطّل» · «ولا تعطيله».

| المفتاح | الملف والسطر | كان | صار | مصدر الكلمة |
|---|---|---|---|---|
| `roleRetireButton` | `operations.ts:723` | تقاعد الدور | **تعطيل الدور** | «تعطيل» شغّالة (`operations.ts:526`)؛ والتركيب صادقت عليه الإدارة |
| `roleStatusInactive` | `operations.ts:696` | متقاعد | **معطّل** | مقتطَعة من «معطّلة» الشغّالة (`finance.ts:114`) |
| `roleSystemExplain` | `operations.ts:699` | ولا تقاعده | **ولا تعطيله** | كلمة الإدارة. لا تتغيّر كلمة أخرى في الجملة |

**النصّ الكامل للجملة بعد القرار:** «دور يحدّده النظام لا يحدّده المكتب: لا يمكن تغيير اسمه ولا تعطيله ولا تعديل صلاحياته. هذه العلامة لا تمنح أي صلاحية بحد ذاتها.»

**فصار على شاشة الأدوار كلمة واحدة للفعل الواحد:** «تعطيل» في الجدول وعلى الزرّ، و«معطّل» في الحالة.

**قِيس قبل الكتابة (على `2cb95423`):** في النصف العربي من `operations.ts` لا نصّ خامس للأدوار فيه «تقاعد». و«متقاعد» لمفتاح التشفير (`operations.ts:557`، وشرح `encryption-key.read`) **لا يُمَسّ:** المفتاح المتقاعد شيء آخر.

**لم يبقَ من القرار ١٥٦ شيء مفتوح عند الإدارة.** الباقي عند جلسة التنسيق: النصف الإنجليزي («Retire» · «Retired» · «Retire role»).

---

## For the engineer — decision 156 (English)

**Copy this file into `docs/` verbatim, with an index row.** Measured on `2cb95423`. **Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** No Arabic word is invented; a string you need that is not here is an empty cell in your report. No role is granted a permission code.

**§1 — one date shape on screens (ruling 1-أ).** Every date rendered on a screen goes through `formatDate` (`apps/web/lib/i18n/format.ts:148`), a date with a time through `formatDateTime` (`:154`), a raw `YYYY-MM` label through `formatPeriodLabel` (`:132`), and the two capital cells through `formatMoney` (`:51`). The sites, by file and line, and the three things to report (the six other screens that share `ReportProvenance`, date-only against instant under `Asia/Amman`, the exact Arabic string `formatDateTime` renders) are in `measure-date-sites-before-msg-50.md`, English section. **Not touched:** the certificate and the four paper templates (`formatDocumentDate`), every `<input type="date">`, and `regulatory-compliance/page.tsx:305-306`.

**§2 — the bell sentence does not repeat (ruling 2-أ).** In `lib/notification/new-permission-sentence.ts:73-85`: when the permission's description CONTAINS its name, render `notifNewPermissionSentenceNoName`; otherwise render `notifNewPermissionSentence`. Neither template's words change (`nav.ts:134-138`). The name comes from the single name table message 50 builds; `OWNER_SUPPLIED_PERMISSION_NAMES` (`:34-38`) stops being a second home. A description that already ends in a full stop is not followed by the template's own. Assert in a test: `license-renewal.declare` renders its description once and no «..»; `retention.archive.retrieve` (an owner-worded name) still renders name then description.

**§3 — one word, four strings (ruling 3-أ and its continuation).** All in `apps/web/lib/i18n/translations/operations.ts`, Arabic block. Change the span and nothing else; byte-exact assertions on the four keys.

| key | line | was | becomes |
|---|---|---|---|
| `roleVerbDeactivate` | `:655` | تقاعد | تعطيل |
| `roleStatusInactive` | `:696` | متقاعد | معطّل |
| `roleSystemExplain` | `:699` | ولا تقاعده | ولا تعطيله |
| `roleRetireButton` | `:723` | تقاعد الدور | تعطيل الدور |

«تعطيل» is sliced from `usrDeactivate` (`:526`); «معطّل» from `pcDisabled` «معطّلة» (`finance.ts:114`); the other two are the owner's ratified words. **Do not touch** `secKeysRetired` (`:557`) or the description of `encryption-key.read` (a retired KEY is a different thing), and **do not touch the English half** (`:1343`, `:1384`, `:1386`, `:1412`): no ruling covers it. **A guard at budget zero, with a plant:** no Arabic dictionary value whose key begins with `role` contains «تقاعد».
