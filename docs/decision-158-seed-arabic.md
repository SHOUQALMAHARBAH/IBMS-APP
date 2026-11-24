# IBMS — القرار ١٥٨: عربيّ بيانات التجربة قبل العرض (٢٢ تشرين الثاني ٢٠٢٦)

## القرار بجملة

نصوص بيانات التجربة الإنجليزية التي تظهر على شاشات العرض تأخذ عربيّها من الجداول أدناه، وأسماء شركات التأمين في بيانات العرض تبقى كما هي، ورقم ترخيص مكتبَي العرض رقم واضح أنه تجريبي.

## كلام الإدارة بحرفه

«1.ب، 2. موافقة، 3. موافقة، 4. موافقة، 5. موافقة، 6. موافقة، 7. موافقة، 8. موافقة، 9. موافقة، 10. موافقة عليهم الا هاي " Jordan Reinsurance Facility" مش جهة حقيقية ف اعملها زي ماهي، 11. موافقة، 12. هو عادي حط المعلومات المناسبة عادي مش مهم مثلا لو كتبت تجريبي او لا ما حد رح يدقق عليها لانهم عارفين انها تجريبية ف عادي اتوقع بس انو عادي براحتك هاي اختار الاحسن برأيك انت.»

**ورقة الأسئلة:** `answer-sheet-seed-arabic.md` في `IBMS-DOC\demo\` (قراءة ملف الزرع على `654cb671`).
**المديول:** بيانات العرض (لا مديول من الـ١٩). ما يمسّ الزرع الأساسي مسجَّل لما بعد العرض.
**رقم القرار:** ١٥٨، من ورقة الاستلام (`msg-50\handover-22nov.md`: «رقم القرار التالي: ١٥٨»). **والقرار ١٥٩ أخذته هذه الجلسة في اليوم نفسه (جمل شاشة الترخيص)؛ جلسة التنسيق تبدأ من ١٦٠.**

---

## الأحكام

| # | السؤال | الحكم |
|---|---|---|
| ١ | أسماء شركات التأمين التسع في زرع العرض | **ب: تبقى كما هي.** عُرض على الإدارة أن اثنتين منها على الأقل اسما شركتين قائمتين، فحكمت بإبقائها |
| ٢–٩ و١١ | القطاعات · المسمّيات · ملفّ المخاطر · المراسلة · مبرّر التوصية · المطالبات · الشكاوى · الحوادث · أسماء حدود التغطية | **موافقة** على الاقتراحات كما هي |
| ١٠ | المورّدون الستة | **موافقة**، إلا «Jordan Reinsurance Facility»: ليست جهة حقيقية، فيُعرَّب اسمها كما هو ولا يُستبدَل |
| ١٢ | رقم ترخيص مكتبَي العرض | **تُرك لتقدير جلسة فهم الكود** («اختار الاحسن برأيك»). المختار أدناه |

**ما اخترتُه في البند ١٢ ولماذا:** الرقم يُطبَع على شهادة التأمين تحت اسم المكتب، ومحمد قد يفتح الشهادة أمام الوسطاء. فرقم مكتوب عليه أنه تجريبي أسلم من رقم يشبه رقماً حقيقياً: «تجريبي/001» و«تجريبي/002».

**وما اخترتُه في اسم المورّد:** «مجمّع إعادة التأمين الأردني». كلمة «مجمّع» اختياري أنا لترجمة Facility؛ تُغيَّر إن أرادت الإدارة.

---

## النصوص المصادَق عليها (تُقتطَع من هنا، ولا تُكتَب باليد)

أرقام الأسطر في `apps/api/scripts/seed-demo.script.ts` على `654cb671`، إلا ما كُتب غير ذلك.

### أ — قطاعات العملاء وحجم المنشأة (`:440-451` · `:2165`)

| اليوم | النص |
|---|---|
| Manufacturing | التصنيع |
| Retail Trade | تجارة التجزئة |
| Construction | المقاولات |
| Healthcare | الرعاية الصحية |
| Logistics & Transport | النقل والخدمات اللوجستية |
| Information Technology | تقنية المعلومات |
| Food & Beverage | الأغذية والمشروبات |
| Real Estate | العقارات |
| Professional Services | الخدمات المهنية |
| Hospitality | الضيافة والفنادق |
| Small | صغيرة |
| Medium | متوسطة |
| Large | كبيرة |

### ب — المسمّيات الوظيفية والمؤهّلات (`:1957-1962` · `:1974-1976`)

| اليوم | النص |
|---|---|
| Account Executive | مسؤول حسابات العملاء |
| Underwriting Assistant | مساعد اكتتاب |
| Claims Handler | موظف مطالبات |
| Compliance Analyst | محلّل التزام |
| Office Administrator | إداري مكتب |
| Branch Manager | مدير فرع |
| Chartered Insurance Institute, Dip CII | دبلوم مهني في التأمين |
| ACII | شهادة مهنية متقدّمة في التأمين |
| Jordan Insurance Federation certificate | شهادة مهنية في التأمين |

### ج — ملفّ المخاطر وجهة الاتصال

| السطر | اليوم | النص |
|---|---|---|
| `:2262` | Head Office | المقرّ الرئيسي |
| `:2264` | No prior claims reported in the past 3 years. | لا مطالبات سابقة في السنوات الثلاث الماضية. |
| `:1728` | Underwriting Desk | قسم الاكتتاب |

### د — المراسلة المزروعة على طلب العرض الواقف (`:2498-2501`)

| | اليوم | النص |
|---|---|---|
| العنوان | Request to approach a specific insurer | طلب التوجّه إلى شركة تأمين بعينها |
| النصّ | The customer wrote asking that this line be placed with one named company. | كتب العميل يطلب أن يُوضَع هذا الفرع لدى شركة واحدة سمّاها. |
| الجملة الثانية | Attach this message to the art. 15/d/5 exemption to clear the «بلا إثبات» mark. | **تُحذَف** |

### هـ — مبرّر التوصية وأسبابها (`:2587-2598`)

| اليوم | النص |
|---|---|
| Best overall balance of coverage breadth, competitive pricing and insurer standing for this risk profile. | أفضل توازن بين اتّساع التغطية والسعر ومكانة شركة التأمين لهذا الخطر. |
| Coverage matches every line the needs assessment recommended. | التغطية تطابق كل فرع أوصى به تقييم الاحتياجات. |
| Most competitive premium among the insurers approached. | أقلّ قسط بين الشركات التي طُلب منها عرض. |
| The insurer carries a strong regional financial-strength rating. | للشركة تصنيف قوّة مالية جيّد. |
| Established, responsive local claims-handling track record. | سجلّها في تسوية المطالبات محلياً جيّد وسريع. |
| Deductible level is appropriate for the client size and risk appetite. | مبلغ التحمّل مناسب لحجم العميل. |
| Standard market wording with no unusual exclusions. | نصّ الوثيقة معتاد في السوق وبلا استثناءات غير مألوفة. |

### و — أوصاف المطالبات ومكتب تسوية الخسائر (`:2768-2772` · `:2784`)

| اليوم | النص |
|---|---|
| Storm damage to the warehouse roof. | ضرر في سقف المستودع بسبب عاصفة. |
| Vehicle collision during a delivery run. | تصادم مركبة أثناء التوصيل. |
| Water damage from a burst pipe. | ضرر مياه بسبب انفجار ماسورة. |
| Theft of stock from a storage facility. | سرقة بضاعة من المخزن. |
| Fire damage to office equipment. | ضرر حريق في معدّات المكتب. |
| Regional Loss Adjusters LLC | المكتب الإقليمي لتسوية الخسائر |

### ز — نصوص الشكاوى (`:2957-2960`)

| اليوم | النص |
|---|---|
| The settlement offered was well below the assessed repair cost. | مبلغ التسوية المعروض أقلّ بكثير من كلفة الإصلاح المقدَّرة. |
| The policy documents were delivered over three weeks late. | تأخّر تسليم مستندات الوثيقة أكثر من ثلاثة أسابيع. |
| The renewal premium increased with no explanation given. | زاد قسط التجديد بلا توضيح. |
| No response was received after multiple follow-up calls about an open claim. | لم يصل ردّ بعد اتصالات متابعة متكرّرة عن مطالبة مفتوحة. |

### ح — الحوادث الأمنية (`:2977-2999`)

| العنوان اليوم | العنوان | الوصف |
|---|---|---|
| Phishing email targeting a claims workstation | بريد احتيالي استهدف جهاز موظف مطالبات | أبلغ موظف مطالبات عن بريد مشبوه يطلب بيانات الدخول، ولم يُفتَح الرابط. |
| Laptop left unattended in a client meeting room | حاسوب محمول تُرك بلا رقابة في غرفة اجتماع عميل | تُرك حاسوب موظف تنسيب بلا رقابة لوقت قصير، والشاشة مقفلة ولم يُطّلَع على بيانات. |
| Misdirected email containing a customer document | بريد أُرسل لغير صاحبه وفيه مستند عميل | أُرسل جدول وثيقة إلى مستلم خطأ داخل المكتب نفسه، واستُرجع فوراً. |
| Unusual login pattern flagged for a Finance account | نمط دخول غير معتاد على حساب في المالية | سُجّلت محاولات دخول فاشلة متكرّرة خارج ساعات العمل. |
| Vendor access review overdue | مراجعة صلاحيات مورّد متأخّرة | تبيّن في فحص التزام دوري أن مراجعة صلاحيات مورّد خارجي تأخّرت عن موعدها. |

### ط — المورّدون (`:3029-3034`)

| اليوم | النص |
|---|---|
| Regional Loss Adjusters LLC | المكتب الإقليمي لتسوية الخسائر |
| CloudSecure Hosting Services | السحابة الآمنة لخدمات الاستضافة |
| Al-Nokhba Printing & Archiving | النخبة للطباعة والأرشفة |
| Horizon Marketing & Call Centre | الأفق للتسويق ومركز الاتصال |
| Jordan Reinsurance Facility | مجمّع إعادة التأمين الأردني |
| Apex Office Supplies | القمّة للوازم المكتبية |

### ي — أسماء حدود التغطية ومبالغ التأمين (`:2235-2236`)

| اليوم | النص |
|---|---|
| perOccurrence | لكل حادث |
| aggregate | الإجمالي السنوي |
| total | الإجمالي |

### ك — ترخيص مكتبَي العرض (الأصل في `packages/db/prisma/seed.ts:1590-1592`)

| | اليوم | لبيانات العرض |
|---|---|---|
| رقم ترخيص مكتب ناصر للتأمينات | `CBJ-SEED-DEFAULT` | تجريبي/001 |
| رقم ترخيص مكتب الحياة للتأمينات | `CBJ-SEED-…` | تجريبي/002 |
| وصف نطاق الترخيص | Seeded placeholder — general insurance brokerage | وساطة تأمين عامّة (بيانات تجريبية) |

---

## ما لا يتغيّر

- **أسماء شركات التأمين التسع** في زرع العرض (`:524-622`): تبقى بالعربية والإنجليزية كما هي (الحكم ١-ب).
- **الزرع الأساسي للتنصيب الحقيقي:** رقم الترخيص الافتراضي واسم المكتب الافتراضي لا يُمَسّان؛ زرع العرض هو الذي يضع قيم العرض على مكتبَيه.

## مسجَّل لما بعد العرض (لم يُسأل عنه اليوم)

من الزرع الأساسي، ويدخل كل تنصيب: أحد عشر حساباً باسم `Sample …` · حسابات النظام باسم `IBMS …` · ثلاث شركات `Sample … Insurance Co.` بتصنيف «(sample rating)» · أسماء العطل الرسمية الأربع بالإنجليزية · الاسم الإنجليزي `Default Brokerage Office`.

---

## For the engineer — decision 158 (English)

**Copy this file into `docs/` verbatim, with an index row.** Measured on `main` at `654cb671`; `apps/api/scripts/seed-demo.script.ts` is unchanged since `f32d65bd`. **Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** ⛔ Nothing about how commission or the loss ratio is computed changes. ⛔ No role is granted a permission code, in the demo offices included. Every Arabic string is in the tables above: slice, never retype; a string you need that is not there is an empty cell in your report.

**§1 — the seeded texts (tables أ to ي).** Replace each English literal at its line with the table's Arabic; where a field has an English column beside an Arabic one, keep the English. **Before changing `sector`, `businessSize`, `position` and `productsOfInterest`, report whether the API validates each against a fixed list:** a validated value is an enum that needs a dictionary, not a seed word, and is then left alone and listed. Delete the second sentence of the seeded correspondence body (`:2500-2501`). ⛔ **Insurer names (`:524-622`) are not touched** (ruling 1-ب); the duplicate-spelling demonstration must still collide.

**§2 — the demo offices' licence (table ك).** The demo seed sets the licence number and the scope text on the two demo offices. ⛔ `packages/db/prisma/seed.ts:1590-1592` is not changed for real installs. Assert the certificate of a demo policy prints the demo number.

**§3 — the shape of the data, through the product's own routes** (measured in `measure-open-walk2-questions.md` and the walk-2 papers):
- after each policy is issued, `POST /commission/entries` as the finance actor; correct the comment at `:2718`;
- approve KYC for most seeded customers, and run `POST /claims/follow-up-sweep` once at the end;
- the eighteen quote requests refused with 403 for `declared-act.article-15-d.declare` carry three insurers instead;
- office B: report what stops thirteen of its fifteen pipelines, its missing licensed line, and its two date warnings;
- the obligations calendar: seed a few obligations if a route exists, report if none does.

**§4 — the document.** `docs/first-run.md:200` and `:727` name the two offices by their old names; correct them, and make the seed's promise check compare them with what the run creates.

**Report:** the tally of each new step, every 4xx by reason, and how a presenter starts from an empty development database by the documented route. A second run on a database that already holds the old English rows leaves them in place: say so in the document, and delete nothing.
