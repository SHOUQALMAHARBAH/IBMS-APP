# سجل مشية المالكة — ٢٦/١٠/٢٠٢٦ · The owner's walk register

> **لماذا هذا الملف موجود.** قالت: «بديش أعيد المشية ألاقي ما في شي تغير و ع الفاضي
> ضيعت ٦ ساعات». فهذا الجدول هو قائمة إعادة المشية: لكلّ بندٍ جملتها كما كتبتها،
> وما تغيّر، والشاشةُ والحسابُ اللذان يُعاد الفحصُ عليهما، والـcommit الذي أغلقه.
>
> **والبندُ الذي لم يُغلَق له صفٌّ أيضاً، ومعه السبب.** الصفُّ المعلَن أمانة؛
> الصفُّ الغائب هو كيف تُضيَّع ستُّ ساعاتٍ أخرى.

**Why this file exists.** Her standing fear, in her words: *I do not want to re-walk
it and find nothing changed, having lost six hours for nothing.* So this is her
re-walk checklist — one row per item she reported, with her own sentence, what
changed, the screen and account to re-check it on, and the commit that closed it.
**Anything NOT closed has a row too, with why.** A declared row is honest; a missing
row is how she loses another six hours.

Read it with `docs/first-run.md` § 7 open: the account column names which of the
seven accounts she walked opens that screen, because **a screen that looks missing
is usually the account, not the screen.**

---

## كيف تُقرأ الحالة · Reading the state column

| الحالة · State | المعنى · What it means |
|------|--------|
| **مُغلَق · CLOSED** | أُصلح، ومعه اختبارٌ يحمل اسمَ ما رأيتِه، وزُرِع العيبُ وشوهد الاختبارُ يسقط. Fixed, with a test named after what she saw, and the defect planted so the test was watched failing. |
| **قرارُك · YOURS** | قِيس وبُلِّغ ولم يُغيَّر: البديلان كلاهما مشروع والاختيار قرارٌ لا هندسة. Measured and reported, not changed — both options are legitimate and the choice is a decision rather than engineering. |
| **مُعلَن · DECLARED** | لم يُغلَق، والسببُ في الصفّ. Not closed, and the reason is in the row. |

---

## المجموعة ١ — أفعالٌ لا تقول ما فعلت · Group 1: acts that do not say what they did

| البند | جملتُها · Her words | الحالة | ما تغيّر · What changed | الشاشة والحساب · Screen + account | Commit |
|------|--------|------|--------|--------|--------|
| 1.1 | «لما أضغط ع زر الاحتواء بس بغيّر الحالة إلى تم احتوائه، و لما أضغط ع زر تقييم الأثر بس بظهرلي إنه تم تقييم أثره وأنا كل الي عملته ضغط ع الزر، ما قيّمت ولا عملت شي. فيها عطب و غلط.» | **قرارُك · YOURS** | **لا شيء، بعد. وهي محقّة تماماً: قِيس فتبيّن أنّ الزرّين لا يجمعان شيئاً على الإطلاق** — `contain()` و`assessImpact()` لا يقبلان أيّ حقلٍ في الطلب، ويكتبان طابعاً زمنيّاً فقط (`containedAt` / `impactAssessedAt`). الخياران وتكلفةُ كلٍّ منهما في القسم أدناه، والاختيارُ لك. *Nothing yet — and she is exactly right. Measured: both routes take NO request body and write a timestamp only. The two options and what each costs are below; the choice is hers.* | `/incidents` · `demo.compliance` | — |
| 1.2 | «الأزرار الي فيها مش شغالة، بضغط عليها ما بيظهر الي اشي.» | **مُغلَق · CLOSED** | **الفعلُ كان يعمل.** قِيس: المزامنة تُنزِّل قائمتين عامّتين بمهلة ١٢٠ ثانية ومحاولتين إضافيّتين لكلّ مصدر، فقد تستمرّ **نحو ست دقائق** ولم يكن يتغيّر على الشاشة إلّا تعطيلُ الزرّ. الآن: الزرّ يقول «جارٍ التنفيذ…» أثناء العمل، وسطرٌ معلَنٌ بعده يسمّي كلّ مصدرٍ ونتيجتَه وعددَ سجلّاته، والفشلُ يُعلَن فشلاً لا صمتاً. *The act ran. The screen said nothing for up to six minutes.* | `/watchlist-sync` · `demo.compliance` · اضغطي «مزامنة قوائم الحظر الآن» | `4d1bd64` |
| 1.3 | «لما نضغط ع الأزرار الموظف رح يشعر بالضياع لأن فش اشي بيظهر اله ولا كأنه عمل اشي… بس بنضغط زر وبنضيع فيه.» | **مُغلَق · CLOSED** | **الفعلُ كان يعمل أيضاً** — يُحدِّث الصفَّ ويعيد قراءة حجز الفحص، فتتغيّر شارةٌ على بعد ثلاثة أعمدة ولا شيء يقول لماذا. الآن: كلُّ صفٍّ يقول «جارٍ التنفيذ…» أثناء الفعل، ثمّ **يسمّي الحالةَ التي صار إليها السجلّ** («الحالة: قيد الفحص») لا كلمةَ «تمّ» وحدها، والرفضُ يُعلَن في صفّه. *The act ran; a badge three columns away changed and nothing said why.* | `/customers/kyc-queue` · `demo.compliance` · اختاري سجلّاً حالتُه «مُرسل» واضغطي «تشغيل الفحص» | `4d1bd64` |

### ولم يكن هذا ثلاثَ شاشات · And this was never three screens

الشاشاتُ الثلاث عيّنةٌ لا حصر، فقِيس الصنفُ كلُّه
(`scripts/measurements/silent-acts.py`): من **٨٦** ملفّاً يُعطِّل زرّاً أثناء
التنفيذ، **٥٢** لا يُظهر أيّ نصٍّ يقول إنّ العملَ جارٍ، و**٤١** فعلاً نتيجتُه
الوحيدةُ إعادةُ قراءةٍ أو نداءٌ للأب — أي أنّ خليّةً تتغيّر في مكانٍ ما ولا شيء
يقول ما حدث.

**وستُّ شاشاتٍ أخرى ذكرتِها تحت عناوين مختلفةٍ هي من الصنف نفسه**:
`/complaints` و`/service-requests` و`/internal-audit-findings` و
`/transaction-monitoring` و`/retention-disposal` و`/incidents`. ولهذا كان
الإصلاحُ مكوِّناً مشتركاً (`ActionStatus`) لا ثلاثَ تعديلات.

Her three screens are a sample, not a census — which is also what her own header
said to expect. Measured: of **86** files that gate a control on a busy flag, **52**
render no pending text at all and **41** run an act whose only outcome is a reload
or a parent callback. **Six more screens she reported under other headings are in
that second list.** The rollout across the remaining sites is declared below rather
than done quietly inside a correctness batch.

### البند ١.١ — الخيارانِ وتكلفةُ كلٍّ منهما · Item 1.1: the two options and what each costs

ما قِيس أوّلاً، قبل تغيير أيّ شيء · **Measured before anything was changed:**

- `POST /incidents/:id/contain` — **لا يقبل أيّ حقل**. يكتب `containedAt` وينقل
  الحالةَ إلى `CONTAINED` ويُغلق مؤقّتَ الاحتواء. *Takes no body at all.*
- `POST /incidents/:id/assess-impact` — **لا يقبل أيّ حقل**. يكتب
  `impactAssessedAt` وينقل الحالةَ إلى `IMPACT_ASSESSED`.
- والنموذجُ نفسُه يحمل **السابقةَ**: `IncidentReport.rootCauseAnalysis` نصٌّ
  **إلزاميٌّ قبل الإغلاق**، و`POST /incidents/:id/close` يطلبه فعلاً. فالإغلاقُ
  يجمع ما يدّعيه؛ الاحتواءُ وتقييمُ الأثر لا يجمعان شيئاً. *The model already
  carries the precedent: closing REQUIRES a root-cause analysis. Containment and
  impact assessment require nothing.*

**ولماذا هذا أثقلُ من «زرٌّ يبالغ»:** تقييمُ الأثر هو ما يقرّر التصنيف
(`MATERIAL` أو لا)، والتصنيفُ `MATERIAL` هو ما يُشعِل الإبلاغَ التنظيميّ وتوقيعَ
الإدارة العليا خلال ساعة. فسجلُّ خرقٍ يقول «قُيِّم الأثر» دون أن يحتفظ بالتقييم
هو سجلٌّ يُعرَض على جهةٍ رقابيّةٍ ولا سند له. *The impact assessment is what
decides the classification, and a MATERIAL classification is what triggers
regulator notification and a senior co-sign within the hour. A breach register
that says the impact was assessed while holding no assessment is a register shown
to a regulator with nothing behind it.*

| الخيار · Option | ما يكلّف · What it costs | ما يبقى غيرَ محسوم · What stays open |
|------|--------|--------|
| **(أ) يجمعُ ما يدّعيه** — حقلٌ لما فُعِل للاحتواء، وحقلٌ للتقييم نفسه، إلزاميّان كما `rootCauseAnalysis` إلزاميٌّ قبل الإغلاق. *Collect it.* | **ترحيلُ قاعدة بيانات** (عمودان على الأقلّ)، وحقلان في كلٍّ من الطلبين، ونموذجٌ على الشاشة لكلّ زرّ، واختباران. الشكلُ معروفٌ ومُجرَّبٌ في النموذج نفسه. *A migration, two DTO fields, a form behind each button. The shape is proven one field over.* | **ما الحقولُ بالضبط.** `PRIV-FRM-06` هو نموذجُ الخرق المعتمد وليس داخلَ هذا المستودع، فقائمةُ حقولِه ليست عندي — واختراعُها هو ما يرفضه هذا المستودع في كلّ مرّة. *Which fields exactly: `PRIV-FRM-06` is the governing breach form and is not in this repo, so its field list is not available to me, and inventing one is the thing this repo refuses.* |
| **(ب) يتوقّف عن الادّعاء** — الزرُّ والحالةُ يقولان إنّ أحداً **سجّل** الاحتواء في هذا الوقت، لا إنّ الاحتواء جرى. *Stop claiming it.* | **لا ترحيل**، تعديلُ نصوصٍ فقط — وكلمةٌ عربيّةٌ أو كلمتان قد تُحتاجان وهما لك. *No migration; wording only, and one or two Arabic words that would be yours.* | **يبقى السجلُّ فارغاً.** فالنظامُ يسجّل متى قال أحدٌ إنّه احتوى، ولا يحتفظ بما فُعِل — وهو أصدقُ من الآن، وأضعفُ ممّا يحتاجه مفتّش. *The register stays empty of substance: honest, and weaker than an inspector needs.* |

**ولم يُلمَس `/incidents` في هذه الدفعة إطلاقاً** — ولا حتى صمتُ أزرارِه، وهو عيبُ
المجموعة نفسِه — لأنّ الفعلَ إن صار يجمع نموذجاً فسطرُ النتيجة يتغيّر معه، وتهذيبُ
شاشةٍ على وشك أن تتغيّر عملٌ مهدور. */incidents was left entirely alone, including
its silent-act defect, because an act that gains a form changes its own outcome
line with it.*

---

## ما هو مُعلَنٌ ولم يُنفَّذ · Declared, not done

| البند | السبب · Why |
|------|--------|
| تعميمُ `ActionStatus` على الـ٥٢ + ٤١ موقعاً الباقية · Rolling `ActionStatus` across the remaining 52 + 41 sites | الشاشاتُ الثلاثُ التي ذكرتِها مُغلَقة، والمكوِّنُ موجودٌ فالباقي رخيص — لكنّ ٩٣ موقعاً داخل دفعةِ «صحّة» تعني مراجعةً لا يستطيع أحدٌ قراءتَها. أُعلِن هنا بعدده المقيس ليُقرَّر حجمُه بصراحة. *Her three screens are closed and the mechanism exists, so the rest is cheap — but 93 sites inside a correctness batch is a diff nobody can read. Declared with its measured figure so the size is visible rather than absorbed.* |

---

## ما تبقّى من المجموعات · The remaining groups

المجموعاتُ ٢ إلى ٨ لم تبدأ بعد، وستُضاف صفوفُها هنا مجموعةً مجموعةً كما تُغلَق.
Groups 2–8 have not started; their rows are appended here group by group as each
closes, so this file is never a promise about work that has not happened.
