# First run — الدليل الأول للاستخدام

> **What this is.** A walkthrough for signing into IBMS for the first time and doing a
> normal day's work, written for someone who does not read code. Arabic first, English
> second — the two halves say the same thing.
>
> Every step below was performed against a running system before it was written: the stack
> was started, the browser opened, the administrator signed in, the authenticator paired,
> and the populated screens reached. Where a number appears (how long the API takes to
> start, which permissions an account holds), it was measured on this machine on
> 2026-09-23, not estimated.

---

# بالعربية

## ١. قبل أن تبدئي

يجب أن يكون على الجهاز:

- **Docker Desktop** ويعمل (منه تعمل قاعدة البيانات).
- **Node.js 20.19.0** (الإصدار مكتوب في ملف `.nvmrc`).

تحتاجين نافذة أوامر (PowerShell) مفتوحة على مجلد المشروع:
`C:\Users\user\Downloads\ibms-app`

## ٢. الخطوة الأولى: اختاري كلمة المرور بنفسك

**لا تستخدمي كلمة المرور المكتوبة في ملف المتطلبات.** أي كلمة مرور مكتوبة في ملف لم تبقَ
سرًّا. النظام الآن يرفض تجهيز البيانات بدون كلمة مرور تختارينها أنتِ في هذه الجلسة.

اكتبي هذا السطر، ثم اكتبي كلمة المرور عندما يسألك:

```powershell
$env:DEMO_PASSWORD = (Read-Host "اختاري كلمة مرور للنظام التجريبي")
```

سبب كتابتها بهذه الطريقة: `Read-Host` لا يحفظ ما تكتبينه في سجل الأوامر، فلا تبقى كلمة
المرور في أي ملف على الجهاز.

**شروط كلمة المرور**: ١٢ حرفًا على الأقل، وتحتوي على حرف كبير، وحرف صغير، ورقم، ورمز
(مثل `!` أو `#`).

هذه الكلمة ستكون كلمة مرور **كل** الحسابات التجريبية.

## ٣. الخطوة الثانية: شغّلي النظام

```powershell
docker compose up -d db
npm run dev
```

**كيف تعرفين أنه بدأ فعلًا؟**

- الواجهة (الموقع) تجهز بسرعة — بحدود ٣ ثوانٍ — ويظهر في النافذة السطر
  `✓ Ready in 3.1s` مع العنوان `http://localhost:3000`.
- الخدمة الخلفية (API) **أبطأ بكثير: نحو ٧٥ ثانية** على هذا الجهاز، لأنها تترجم الكود أولًا.
  هذا طبيعي. إذا فتحتِ الموقع في هذه الفترة فقد يقول إنه لا يستطيع الوصول للخدمة — انتظري.
- الفحص الأكيد: افتحي هذا العنوان في المتصفح:

  `http://localhost:4000/health/db`

  إذا ظهر `{"status":"ok"}` فهذا يعني أن الخدمة تعمل **وأنها تصل إلى قاعدة البيانات**.
  (العنوان `http://localhost:4000/health` يخبرك أن الخدمة تعمل فقط، بدون قاعدة البيانات.)

**اتركي هذه النافذة مفتوحة.** إذا أغلقتِها توقف النظام.

## ٤. الخطوة الثالثة: جهّزي البيانات

افتحي نافذة أوامر **ثانية** على نفس المجلد (الأولى مشغولة بتشغيل النظام)، واكتبي فيها كلمة
المرور مرة أخرى بنفس الطريقة، ثم:

```powershell
$env:DEMO_PASSWORD = (Read-Host "نفس كلمة المرور التي اخترتِها")
npm run seed:demo -w api
```

هذا الأمر يبني بيانات كاملة عبر واجهة النظام نفسها (وليس بكتابة مباشرة في قاعدة البيانات)،
فيأخذ عدة دقائق. ما ينشئه:

- **مكتبان** (مؤسستان منفصلتان): `Default Brokerage Office` و
  `Rawabi Insurance Brokerage (demo)`. المكتبان ضروريان — دليل شركات التأمين لا يُظهر شيئًا
  ذا معنى بمكتب واحد.
- **١٠ موظفين و٢٥٠ عميلًا لكل مكتب في كل تشغيل**، مع عروض وطلبات تسعير ووثائق ومطالبات
  وفواتير وشكاوى. **والتشغيل يضيف ولا يستبدل**: تشغيلان يعطيان ضعف العدد. إن أردتِ الرقم
  الذي سجّلتِه — ٢٠ موظفًا و٥٠٠ عميل — في تشغيل واحد، اضبطي المتغيرين قبل الأمر:

  ```powershell
  $env:DEMO_EMPLOYEES_PER_ORG = '20'
  $env:DEMO_CUSTOMERS_PER_ORG = '500'
  ```
- **شركات تأمين بالطريقتين**: شركات مرتبطة بالكتالوج العام، وشركات سجّلها المكتب بنفسه
  ولا وجود لها في أي كتالوج (مثل `Petra Takaful (demo)` و`Yarmouk Insurance (demo)`).
- **شركة موقوفة عن التعامل على الأقل، ولها التزامات قائمة**، حتى تظهر أرقام حقيقية في شاشة
  الإيقاف بدلًا من أصفار. كل تشغيل يوقف الشركة الأكثر وثائق إن لم تكن موقوفة، فقد تجدين أكثر
  من واحدة بعد عدة تشغيلات.
- في نهايته **يفتح الحسابات التجريبية للدخول البشري**: يمسح أي تسجيل مصادقة قديم ويطبع
  قائمة الحسابات. هذه الخطوة مهمة — اقرئي القسم ١٠ لمعرفة السبب.

انتظري حتى ترى في النهاية سطرًا مثل:
`All 16 demo accounts released — password-only sign-in, MFA enrolment on first login.`

**اتركيه يُكمل.** تحرير الحسابات للدخول البشري يحدث في **آخر** خطوة من الأمر. إن أوقفتِه في
المنتصف (Ctrl+C أو إغلاق النافذة) تبقى الحسابات الستة عشر مربوطة بتطبيق مصادقة لا يملك أحد
سرّه — وهذه بالضبط حالة «الرمز صحيح ويقول خطأ». العلاج سطر واحد:
`npm run demo:release -w api`.

## ٥. الخطوة الرابعة: العنوان والحساب

افتحي في المتصفح:

```
http://localhost:3000
```

سجّلي الدخول بـ:

| | |
|---|---|
| **البريد** | `demo.admin@office-a.ibms.internal` |
| **كلمة المرور** | التي اخترتِها في الخطوة الأولى |

هذا حساب **الإدارة** في المكتب الأول. (لبقية الحسابات انظري القسم ٧.)

## ٦. الخطوة الخامسة: أول تسجيل دخول — ماذا سيُطلب منك

بالترتيب، وهذا ما حدث فعليًا عند تجربة المسار:

1. **شاشة تسجيل الدخول**: البريد وكلمة المرور، ثم زر الدخول.

2. **تصلين إلى الصفحة الرئيسية** — لكن **معظم الشاشات لن تعمل بعد**. سيظهر في أعلى كل
   شاشة تنبيه بلون تحذيري يقول:

   > خطوة واحدة قبل أن يعمل النظام: اربط تطبيق المصادقة

   هذا ليس خطأ ولا نقص صلاحيات. النظام يشترط **مصادقة ثنائية** قبل فتح أي شاشة عمل.

3. **اضغطي على الرابط في التنبيه**: «اذهب إلى الأمان لإتمام الربط» — أو من أسفل القائمة
   الجانبية: **الأمان**. هذه هي الشاشة الوحيدة التي تعمل قبل الربط، بشكل مقصود.

4. في شاشة **الأمان** ستجدين الحالة: `غير مسجَّلة — مطلوبة قبل استخدام معظم أجزاء النظام`،
   وزرًّا لبدء التسجيل. اضغطيه.

5. **سيظهر رمز QR**. افتحي تطبيق مصادقة على هاتفك — Microsoft Authenticator أو Google
   Authenticator أو ما شابه — واختاري «إضافة حساب» ثم «مسح رمز QR»، وامسحي الرمز.

6. سيعطيك التطبيق **رقمًا من ست خانات يتغير كل ٣٠ ثانية**. اكتبيه في الخانة واضغطي التأكيد.
   إن تغيّر الرقم قبل أن تُكملي الكتابة، اكتبي الرقم الجديد — الرقم القديم يصبح غير صالح.

7. تتحول الحالة إلى `مُفعَّلة`. **الآن يعمل النظام كله**، والتنبيه يختفي من جميع الشاشات.

8. **تنبيه آخر قد يبقى ظاهرًا**، ولا حاجة للقلق منه: رسالة تقول إن سياسة المصادقة غير
   مستوفاة بالكامل. السبب أن الدور مضبوط على اشتراط **مفتاح أمان مادي** (USB)، وهذه الميزة
   غير مبنية في النظام بعد. التنبيه لا يمنع أي شيء — وقد قِيس ذلك على حسابك تحديدًا:
   الدوران المسندان إليه كلاهما يشترط المفتاح المادي.

## ٧. الخطوة السادسة: أين وصلتِ وبمن تسجّلين الدخول لكل عمل

بعد الربط تصلين إلى الصفحة الرئيسية، ومن **القائمة الجانبية** تتنقلين بين الشاشات.
الشاشات المعروضة تعتمد على صلاحيات الحساب — وهذا مقصود.

**حساب الإدارة `demo.admin` لا يرى العملاء ولا الوثائق ولا المطالبات.** هذه ليست مشكلة:
قِيست صلاحياته فعليًا وهي ٢٩ صلاحية كلها إدارية. لعمل يوم عادي استخدمي حسابًا آخر.

الجدول مقيس على المكتب الأول (يكفي تغيير `office-a` إلى `office-b` للمكتب الثاني):

| الحساب | العملاء | إضافة عميل | العملاء المحتملون | الوثائق | المطالبات | شركات التأمين | تسجيل شركة | الموظفون | المستخدمون | الأدوار |
|---|---|---|---|---|---|---|---|---|---|---|
| `demo.sales` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.manager` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `demo.admin` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `demo.claims` | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `demo.placement` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.compliance` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.policyCheck` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `demo.finance` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

كل الحسابات على الصيغة `demo.<الاسم>@office-a.ibms.internal` وبنفس كلمة المرور. **كل حساب
يطلب ربط تطبيق مصادقة في أول دخول** — نفس خطوات القسم ٦.

**للاطلاع على أوسع مساحة عمل: `demo.sales@office-a.ibms.internal`** — يرى العملاء
المحتملين والعملاء والوثائق والمطالبات، وهو الحساب الوحيد الذي يستطيع **إضافة عميل جديد**.

## ٨. ما يستطيعه المدير وحده — وأين يوجد على الشاشة

| العمل | أين | مجموعة القائمة |
|---|---|---|
| **إنشاء موظف** وتعديله | `الموظفون` ← `/employees` | العمليات |
| **إنشاء مستخدم** ومنحه دورًا أو سحبه | `المستخدمون` ← `/settings/users` | العمليات |
| **تعريف دور جديد** وتحديد صلاحياته، أو إيقافه | `الأدوار والصلاحيات` ← `/settings/roles` | العمليات |
| **تسجيل شركة تأمين** (بالكتالوج أو محليًا)، تعديلها، **إيقافها عن التعامل** | `شركات التأمين` ← `/insurers` | الأعمال الجديدة |
| **البحث في دليل الشركات** عبر المكاتب | `دليل شركات التأمين` ← `/insurer-directory` | الأعمال الجديدة |

**«إدخال العملاء الحاليين» ليس من عمل المدير في هذه النسخة.** لا يملك حساب الإدارة أي
صلاحية قراءة أو إضافة عميل — الصلاحية الوحيدة المتعلقة بالعملاء التي يملكها هي الاستيراد
المجمّع، ولا توجد لها شاشة (انظري القسم ١١). لإضافة عميل استخدمي `demo.sales`.

### شاشة الأدوار — ملاحظتان

- لا يوجد **حذف** دور، بل «إيقاف». السبب أن سجلات من كان يحمل الدور ومتى هي نفسها سجل
  المراجعة، وحذف الدور يمحوها.
- لا يمكن للنظام أن يترك المكتب بلا أحد يملك إدارة المستخدمين. إن حاولتِ سحب آخر صلاحية
  إدارة — بإيقاف الدور، أو بإزالة الصلاحية من الشاشة، أو بسحب الإسناد — سيرفض النظام ويشرح
  السبب.

## ٩. جرّبي هذا — الاسم المكرر بإملاء مختلف

في المكتب الأول توجد شركة مسجلة محليًا اسمها `Yarmouk Insurance (demo)`
(بالعربية: شركة اليرموك للتأمين).

من شاشة **شركات التأمين** اختاري تسجيل شركة جديدة، واكتبي الاسم:

```
yarmouk insurance (Demo)
```

**سيرفض النظام التسجيل** ويقول إن الشركة مسجلة أصلًا، ويشير إلى إعادة تنشيطها بدلًا من
إنشاء نسخة ثانية. هذا هو المطلوب: النظام يوحّد الاسم قبل المقارنة — يتجاهل حالة الأحرف
والمسافات الزائدة وعلامات الترقيم، ويرتّب الكلمات، وفي العربية يعالج الهمزات والتاء
المربوطة والتطويل والأرقام العربية-الهندية. فـ `شركة` و`شركه`، و`للتأمين` و`للتامين`،
اسم واحد.

هذه الجملة ليست وعدًا على الورق: **أمر تجهيز البيانات نفسه يحاول هذا التسجيل ويفشل إن لم
يُرفض**، حتى لا تبقى خطوة في هذا الدليل صحيحة على الورق وخاطئة على الشاشة.

**وفي دليل الشركات**: المكتب الثاني سجّل نفس الشركة بإملاء مختلف
(`YARMOUK   insurance (demo)` / شركه اليرموك للتامين). افتحي **دليل شركات التأمين**
وستجدينها **مدخلًا واحدًا لا مدخلين** — وهذا بالضبط ما يفيد وسيطًا يريد أن يعرف إن كانت
الشركة موجودة على المنصة. الإملاء المعروض في المدخل هو إملاء المكتب الذي سجّل الشركة أولًا،
فلا تستغربي إن رأيتِ صياغة المكتب الآخر: هذا دليل على أن الدمج حقيقي وليس مجرد تشابه.

**والشركة الموقوفة**: افتحي من قائمة شركات التأمين الشركة الموقوفة، وستجدين أن الإيقاف
سُجِّل كواقعة لها سبب مكتوب، ومعه **عدّادان منفصلان** للالتزامات القائمة: وثائق سارية،
والتزامات مفتوحة. الأرقام حقيقية لأن الشركة اختيرت على أساس أنها تحمل وثائق فعلًا.

## ١٠. إذا حدث خطأ

| ما ترينه | السبب وما تفعلينه |
|---|---|
| **أدخلتُ الرمز الصحيح من التطبيق ويقول إن الرمز خطأ** | إن حدث هذا **قبل** أن تربطي التطبيق بنفسك، فالحساب كان يحمل تسجيل مصادقة قديمًا أُنشئ داخل أداة التجهيز ولم يره أحد — فكل رمز تكتبينه خاطئ فعلًا عند النظام، ولو كان صحيحًا في تطبيقك. الحل: `npm run demo:release -w api` ثم سجّلي الدخول من جديد وستُطلب منك خطوة الربط. أما إن حدث **بعد** الربط فالسبب الغالب أن ساعة الهاتف غير مضبوطة تلقائيًا، أو أن الرقم تغيّر أثناء الكتابة. |
| **الموقع يقول إنه لا يستطيع الوصول للخدمة** | الخدمة الخلفية لم تكمل الإقلاع بعد (نحو ٧٥ ثانية). تأكدي من `http://localhost:4000/health/db`. |
| **كل شاشة ترفض العمل والتنبيه التحذيري ظاهر** | لم يتم ربط تطبيق المصادقة. القسم ٦. |
| **شاشة تقول إنك لا تملك صلاحية** | هذا الحساب فعلًا لا يملكها — راجعي جدول القسم ٧ واستخدمي الحساب المناسب. |
| **`npm run seed:demo` يتوقف فورًا ويقول `DEMO_PASSWORD is not set`** | نافذة الأوامر هذه لا تحمل كلمة المرور. كرّري سطر `$env:DEMO_PASSWORD = (Read-Host ...)` في **نفس** النافذة. |
| **أوقفتُ أمر تجهيز البيانات في المنتصف** | الحسابات تبقى مربوطة بمصادقة لا يملك أحد سرّها، فلا يمكنك الدخول. نفّذي `npm run demo:release -w api` ثم سجّلي الدخول عادي. البيانات التي أُنشئت قبل الإيقاف تبقى، والتشغيل مرة أخرى يكمل الباقي. |
| **`Port 3000 is in use` ثم `Another next dev server is already running`** | نسخة أخرى من النظام تعمل بالفعل. **المهم أن تعرفي أن الأمر كله يفشل، لا الواجهة وحدها**: يختار Next المنفذ 3001 ثم يرفض العمل، فيتوقف `turbo` ومعه الخدمة الخلفية — فلا تعملي على المنفذ القديم بافتراض أن كل شيء يعمل، لأن الخدمة الخلفية قد لا تكون قائمة. Next يطبع لك رقم العملية والأمر اللازم لإيقافها؛ نفّذيه ثم أعيدي `npm run dev`: `taskkill /PID <الرقم> /F` — ولإيقاف الخدمة الخلفية أيضًا إن بقيت: `netstat -ano | findstr :4000` ثم نفس الأمر على رقمها. |
| **قاعدة البيانات لا تعمل** | افتحي Docker Desktop وتأكدي أن الحاوية `ibms-app-db-1` حالتها `healthy`، أو نفّذي `docker compose up -d db`. |

## ١١. ما لا يمكن فعله بعد — بصراحة

هذه ليست أعطالًا، بل أجزاء لم تُبنَ بعد. من الأفضل معرفتها قبل أن تبحثي عنها:

1. **لا يمكن إنشاء مكتب ثانٍ من داخل النظام.** المكتبان الموجودان أنشأهما أمر التجهيز.
   لا توجد شاشة ولا واجهة لتسجيل مؤسسة جديدة، وصفحة إنشاء الحساب الأولى ترفض ذلك صراحةً
   وتقول السبب بدلًا من أن تفشل بصمت.
2. **ثلاث صلاحيات يحملها حساب الإدارة ولا يستطيع استخدامها**، لعدم وجود شاشة لها:
   - `customer.bulk-import` — استيراد العملاء بملف (الواجهة البرمجية موجودة، الشاشة لا).
   - `email.integration.read` و `email.integration.manage` — ربط البريد الإلكتروني.
3. **لا يوجد مفتاح أمان مادي (WebAuthn)** — وهذا سبب التنبيه في الخطوة ٨ من القسم ٦.
4. **الشركة الموقوفة لا تُحذف** ولا يوجد حذف لشركة أو لدور — بالتصميم: السجل هو الدليل.
5. **دليل الشركات للقراءة فقط** ولا يُظهر علاقات المكاتب الأخرى بالشركة — فقط أن الشركة
   موجودة وما الفروع التي تكتبها. هذا حد أمني مقصود ومبني في قاعدة البيانات نفسها.
6. **البيانات تجريبية** ومولّدة عشوائيًا: الأسماء والأرقام غير واقعية، والفحص الأمني
   للعملاء (العقوبات/الأشخاص المعرضون سياسيًا) يعمل على بيانات تجريبية.

---

# In English

## 1. Before you start

You need **Docker Desktop** running (it hosts the database) and **Node.js 20.19.0** (pinned
in `.nvmrc`). Open a PowerShell window in the project folder,
`C:\Users\user\Downloads\ibms-app`.

## 2. Step one: choose your own password

**Do not use the password written in the requirements document.** A password in a file
stopped being a secret the moment it was written there. The seeding tool now refuses to run
without a password you choose in the session.

```powershell
$env:DEMO_PASSWORD = (Read-Host "Choose a demo password")
```

`Read-Host` is used rather than typing the password on the command line because PowerShell
saves command lines to a history file — what you type at a `Read-Host` prompt is not saved.

**Policy**: at least 12 characters, with an upper-case letter, a lower-case letter, a digit
and a symbol. This becomes the password for **every** demo account.

## 3. Step two: start the system

```powershell
docker compose up -d db
npm run dev
```

**How to know it actually started:**

- The website is ready in about **3 seconds** — the window prints `✓ Ready in 3.1s` and
  `http://localhost:3000`.
- The API is much slower: about **75 seconds** on this machine, because it compiles first.
  Opening the site during that window may say it cannot reach the server. That is expected.
- The definitive check: open `http://localhost:4000/health/db`. `{"status":"ok"}` means the
  API is up **and** reaching the database. (`http://localhost:4000/health` proves only that
  the API process is alive.)

**Leave that window open** — closing it stops the system.

## 4. Step three: build the data

Open a **second** PowerShell window in the same folder (the first is busy running the
system), set the same password again, and run the seed:

```powershell
$env:DEMO_PASSWORD = (Read-Host "The same password you chose")
npm run seed:demo -w api
```

It drives the real API rather than writing to the database directly, so it takes several
minutes. It creates:

- **Two offices** — `Default Brokerage Office` and `Rawabi Insurance Brokerage (demo)`. Two
  are necessary: the cross-office insurer directory shows nothing meaningful with one.
- **10 employees and 250 customers per office, per run**, with opportunities, RFQs, policies,
  claims, invoices and complaints. **A run ADDS rather than replaces**, so two runs give twice
  as much. To get the figures you recorded — 20 employees and 500 customers — in a single run,
  set both variables before the command:

  ```powershell
  $env:DEMO_EMPLOYEES_PER_ORG = '20'
  $env:DEMO_CUSTOMERS_PER_ORG = '500'
  ```
- **Insurers registered both ways** — linked to the shared catalogue, and registered locally
  by the office with no catalogue row behind them (`Petra Takaful (demo)`,
  `Yarmouk Insurance (demo)`).
- **At least one insurer deactivated while holding live commitments**, so the deactivation
  screen shows real impact counts instead of zeros. Each run deactivates the insurer holding the
  most policies if it is not already deactivated, so several runs can leave more than one.
- At the end it **releases the demo logins for human sign-in**, clearing any stale
  authenticator registration. That step matters; see §10.

Wait for the closing line:
`All 16 demo accounts released — password-only sign-in, MFA enrolment on first login.`

**Let it finish.** Releasing the logins for human sign-in is the command's **last** step. Stop it
half-way — Ctrl+C, or closing the window — and all sixteen accounts stay paired to an
authenticator whose secret nobody holds, which is exactly the "correct code is rejected" state.
One line fixes it: `npm run demo:release -w api`.

## 5. Step four: the address and the account

Open `http://localhost:3000` and sign in with:

| | |
|---|---|
| **Email** | `demo.admin@office-a.ibms.internal` |
| **Password** | the one you chose in step one |

That is the **administrator** of the first office. Other accounts are in §7.

## 6. Step five: what the first sign-in asks for

In order — this is what actually happened when the path was walked:

1. **The sign-in screen** — email, password, submit.

2. **You land on the home page, and most screens will not work yet.** A warning-coloured
   banner appears at the top of every screen:

   > One step before the system works: pair an authenticator app

   This is not an error and not a permissions problem. The system requires two-factor
   authentication before it opens any working screen.

3. **Click the link in the banner** — "Go to Security to finish pairing" — or use
   **Security** at the bottom of the sidebar. It is deliberately the only screen that works
   before pairing.

4. On **Security** the status reads `Not enrolled — required before using most of the
   system`, with a button to begin. Click it.

5. **A QR code appears.** In an authenticator app on your phone (Microsoft Authenticator,
   Google Authenticator, or similar) choose "add account" → "scan QR code", and scan it.

6. The app shows a **six-digit number that changes every 30 seconds**. Type it in and
   confirm. If it changes while you are typing, use the new one — the old one is no longer
   valid.

7. The status becomes `Enabled`. **The whole system now works**, and the banner disappears
   everywhere.

8. **A second banner may remain**, and it is safe to ignore: it says the MFA policy is not
   fully satisfied. Both roles on this account require a **physical security key**, and that
   feature is not built yet. It blocks nothing.

## 7. Step six: where you landed, and who to sign in as

After pairing you land on the home page and navigate from the **sidebar**. Which screens
appear depends on the account's permissions — by design.

**The `demo.admin` account cannot see customers, policies or claims.** That is not a fault:
its 29 permissions were measured and they are all administrative. For a normal day's work,
use a different account.

Measured on the first office (swap `office-a` for `office-b` for the second):

| Account | Customers | Add customer | Leads | Policies | Claims | Insurers | Register insurer | Employees | Users | Roles |
|---|---|---|---|---|---|---|---|---|---|---|
| `demo.sales` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.manager` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `demo.admin` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `demo.claims` | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `demo.placement` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.compliance` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `demo.policyCheck` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `demo.finance` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Every account is `demo.<name>@office-a.ibms.internal` with the same password, and **every
one asks for authenticator pairing on its first sign-in** — the same §6 steps.

**For the widest view of a working day, sign in as `demo.sales@office-a.ibms.internal`** —
leads, prospects, customers, policies and claims, and the only account that can **add a new
customer**.

## 8. What the administrator can do that nobody else can, and where

| Task | Where | Sidebar group |
|---|---|---|
| **Create and edit an employee** | `Employees` → `/employees` | Operations |
| **Create a user**, grant or revoke a role | `Users` → `/settings/users` | Operations |
| **Define a role**, set its permissions, retire it | `Roles & permissions` → `/settings/roles` | Operations |
| **Register an insurer** (catalogue or local), edit it, **deactivate** it | `Insurers` → `/insurers` | New business |
| **Search the cross-office directory** | `Insurer directory` → `/insurer-directory` | New business |

**"Entering existing customers" is not the administrator's job on this build.** The account
holds no customer read or create permission at all — its only customer-related code is bulk
import, which has no screen (§11). Use `demo.sales` to add a customer.

### Two notes on the Roles screen

- There is no **delete**, only retire. The records of who held a role and when *are* the
  audit trail, and deleting the role erases them.
- The system will not let an office end up with nobody who can administer users. Retiring
  the role, unchecking the permission in the matrix, or revoking the last grant are all
  refused, with the reason stated.

## 9. Try this — the same name spelled differently

The first office holds a locally registered insurer called `Yarmouk Insurance (demo)`
(Arabic: شركة اليرموك للتأمين).

From **Insurers**, register a new insurer with the legal name:

```
yarmouk insurance (Demo)
```

**The system refuses it**, says the company is already registered, and points at
reactivating it rather than creating a second copy. That is the intent: the name is
canonicalised before comparison — case, extra spaces and punctuation are ignored, word order
is normalised, and in Arabic hamza forms, ta-marbuta, tatweel and Arabic-Indic digits are
folded. So `شركة` and `شركه`, `للتأمين` and `للتامين`, are one name.

That sentence is not a paper promise: **the seeding tool makes this exact attempt and fails
if it is not refused**, so this step cannot quietly become false on screen while staying
true in the document.

**And in the directory**: the second office registered the same company with a different
spelling (`YARMOUK   insurance (demo)`). Open **Insurer directory** and you will find **one
entry, not two** — which is exactly what a broker asking "is this company on the platform"
needs. The spelling shown is whichever office registered first, so do not be surprised to see
the other office's wording: that is the merge being real rather than a near match.

**The deactivated insurer**: open it from the insurer list. The deactivation is recorded as
an act with a written reason, carrying **two separately-named counts** of live commitments —
in-force policies, and open obligations. The numbers are real because the insurer was chosen
for holding policies.

## 10. If something goes wrong

| What you see | Why, and what to do |
|---|---|
| **I entered the correct code from the app and it says the code is wrong** | If this happens **before** you paired the app yourself, the account was carrying an authenticator registration created inside the seeding tool that nobody ever saw — so every code you type genuinely is wrong server-side, however correct it is in your app. Fix: `npm run demo:release -w api`, then sign in again and you will be asked to pair. If it happens **after** pairing, the usual cause is the phone's clock not being set automatically, or the number changing mid-typing. |
| **The site says it cannot reach the server** | The API has not finished starting (~75 s). Check `http://localhost:4000/health/db`. |
| **Every screen refuses and the warning banner is showing** | The authenticator is not paired. See §6. |
| **A screen says you lack a permission** | That account genuinely lacks it — check the §7 table and use the right account. |
| **`npm run seed:demo` stops immediately with `DEMO_PASSWORD is not set`** | That window does not carry the password. Repeat the `$env:DEMO_PASSWORD = (Read-Host ...)` line in the **same** window. |
| **I stopped the seed half-way** | The accounts stay paired to an authenticator nobody holds a secret for, so you cannot sign in. Run `npm run demo:release -w api`, then sign in normally. Data created before the stop stays; running the seed again completes the rest. |
| **`Port 3000 is in use`, then `Another next dev server is already running`** | Another copy is already running. **The part worth knowing is that the whole command fails, not just the website**: Next picks port 3001, then refuses, and `turbo` brings the API task down with it — so do not carry on against the old port assuming everything is up, because the API may not be. Next prints the PID and the exact command to stop it; run that, then `npm run dev` again: `taskkill /PID <pid> /F`. If an API is also left behind, find it with `netstat -ano | findstr :4000` and stop that PID the same way. |
| **The database is not running** | In Docker Desktop, confirm `ibms-app-db-1` is `healthy`, or run `docker compose up -d db`. |

## 11. What you cannot do yet — honestly

These are not faults; they are parts that have not been built. Better to know before hunting
for them:

1. **You cannot create a second office from inside the system.** Both existing offices were
   created by the seeding tool. There is no screen and no API for registering a new
   organisation, and the initial sign-up page refuses explicitly and says why rather than
   failing silently.
2. **Three permissions the administrator holds and cannot exercise**, because no screen
   exists for them:
   - `customer.bulk-import` — importing customers from a file (the API exists, the screen
     does not).
   - `email.integration.read` and `email.integration.manage` — email integration.
3. **No physical security key (WebAuthn)** — which is why the banner in §6 step 8 stays.
4. **A deactivated insurer is never deleted**, and neither insurers nor roles can be
   deleted — by design: the record is the evidence.
5. **The directory is read-only** and never shows other offices' relationships with a
   company — only that the company exists and which lines it writes. That boundary is
   enforced in the database, not just in the screen.
6. **The data is demo data**, randomly generated: names and figures are not realistic, and
   customer screening (sanctions / politically-exposed persons) runs against test data.

---

## For whoever maintains this

**This document was walked end to end on 2026-09-23, with a throwaway `DEMO_PASSWORD`, before it
was handed over.** The seed ran, the browser signed in, the authenticator was paired, and the
insurer screens were read. Doing that found **five defects that reading the code had not**, all of
them in the tooling around the system rather than in the system:

1. **`npm run seed:demo` was a one-shot.** It boots the app through `createTestApp()`, whose
   one-Organization guard refuses at two offices — and the seed's own first run creates the second
   office. So every run after the first was refused before reaching a line of seeding logic. The
   guard is right for the e2e suite and its premise never applied here: the seed creates Office B
   and every account through `rawPrisma` precisely BECAUSE `POST /auth/signup` refuses at two
   offices. It now passes `multipleOrganizationsAreExpected` — the only caller of 93 that does.
2. **The duplicate-spelling prover sent an incomplete payload.** `RegisterInsurerDto` requires
   `structure`, `companyPhone` and `companyEmail`; without them the request is a 400 from the
   ValidationPipe and the collision check never runs — so the assertion reported "no refusal came"
   about a request the endpoint never considered. It also threw, which took office A's entire seed
   down with it. A check on the DOCS must not be able to cost the DATA: failures are collected now
   and raised at the end, where failing is free.
3. **Commission agreements could not be seeded past the first line per insurer.** The live
   constraint is `UNIQUE (insurerId, insuranceLineId, variantKey) NULLS NOT DISTINCT WHERE
   effectiveTo IS NULL`, and this writer set neither the FK nor the variant — so every agreement for
   one insurer was the tuple `(insurer, NULL, NULL)`. § 1.40's lesson landing on one more writer.
   It now resolves the managed line, matches existing rows on EITHER key (a row written before the
   FK existed carries the string and a NULL FK, and looking it up by FK alone collides on the string
   index — measured, four failures in one run), and backfills the FK when it finds one missing.
4. **The seed asked the API to shortlist an insurer it had itself deactivated.** The deactivation
   step runs last; the next run picked that company for an RFQ and `POST /rfqs` refused with a 422
   naming it. Three failures per run, recurring forever. Deactivated insurers are now held back
   from placement only — they stay registered and stay on the screens.
5. **A killed run strands all sixteen logins.** Observed twice here, both times repaired by
   `npm run demo:release -w api` in seconds. Documented in § 4 and § 10 rather than left to be
   rediscovered.

After all five: a complete run reports **160 rows created, 0 failed attempts**.

**What the browser walk confirmed**, against a live stack with no mocks: sign-in lands on the home
page; the enrolment banner renders with the wording in § 6 and the screen beneath it does NOT claim
a missing permission; the banner's link reaches Security; the QR is issued, the six-digit code is
accepted, the status becomes enabled and the banner clears everywhere. The insurer list shows **11
cards** including both locally-registered companies with their "registered locally" badge and **two
deactivated insurers shown by default**, with no error alerts. The directory went from **12 entries
unfiltered to 1** when searched for `يرموك` — which is § 9's promise, on screen, in Arabic.


- The measured facts above — startup times, the per-account permission table, the 29
  administrator codes, which spellings collide — were taken from the dev database on
  2026-09-23 with the stack running. If the seed's role grants change, re-measure the table
  rather than editing it by hand.
- §9's duplicate-registration step is asserted by `proveDuplicateSpellingIsRefused` in
  `apps/api/scripts/seed-demo.script.ts`: the seed itself attempts that registration and
  fails the run if it is not refused with a 409 naming the attempted spelling. The two
  Yarmouk spellings were measured against the database's own `canonical_name_key()` before
  being written here — an earlier draft used `al-yarmouk insurance`, which does **not**
  collide, because the key is token-sorted and keeps a Latin `al` as a token of its own.
- The "one entry, not two" claim was then measured end to end rather than derived from the
  view's SQL: both spellings were inserted into the two offices inside a transaction, the
  `InsurerDirectory` view returned **1** row for two `Insurer` rows, and the transaction was
  rolled back (0 rows left). That plant also showed the displayed name is ordered by
  `createdAt`, so two rows created in the same instant pick arbitrarily — harmless for two
  offices registering on different days, but it is why the doc says "whichever registered
  first" rather than naming a spelling.
- The banner in §6 is in `apps/web/app/(app)/layout.tsx`, guarded by
  `apps/web/e2e/mfa-enrolment-banner.spec.ts`. Both halves of its condition were planted and
  each has a test that fails without it.
- Office B's `OFFICE_ADMINISTRATOR` was measured **4 grants behind** office A's — 22 codes
  against 26, missing `insurer.relationship.manage` among them — on a database seeded before
  the insurer permissions existed. The seed's `ensureRoleMirroringDefaultOffice` upserts
  every default-office grant, so re-running the seed closes it; but nothing warns you that
  it is open, which is worth a gate of its own.
