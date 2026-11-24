# IBMS — القرار ١٦١: سيناريو ضيّق للعرض، وقاعدة الشكل الأساسية في رسالة ٥٢ (٢٢ تشرين الثاني ٢٠٢٦)

**رقم القرار:** ١٦١، أعطته جلسة التنسيق (١٦٠ أُخذ لـ«بعد تسجيل الإقرار» في اليوم نفسه). كتبت الحكمَ جلسة فهم الكود في `ruling-narrow-scenario-and-base-style-2026-11-22.md`، وهذه الورقة نصّه بحرفه مع الرقم وعنوان القسم الذي يطلبه فهرس القرارات.
**المديول:** مديول ١ (شاشات) وتجهيز العرض.

## القرار بجملة

يُعرَض على الوسطاء طريق واحد محفوظ من نحو ثماني شاشات بالوضع الفاتح، وتدخل رسالة اليوم قاعدة شكل أساسية واحدة للأزرار والخانات، وتُصوَّر شاشات السيناريو يوم ٢٤ لتراها الإدارة قبل محمد.

## كلام الإدارة بحرفه

«الشكل بيخزي و بيعر غير الاغلاط و الاعطال الي لقيناها حاسة بخزي و مش خرج نورجيه لحد الصراحة خايفة اتبهدل عليه» ثم، بعد عرض الاقتراحات الأربعة والسؤال: «تمام موافقة ع اقتراحاتك».

## الأحكام

| # | الحكم |
|---|---|
| ١ | **السيناريو ضيّق:** تكتب جلسة فهم الكود لمحمد الشاشات بترتيبها، وما يقوله، وما لا يفتحه أبداً. شاشة يطلبها وسيط خارج السيناريو: «هذه في المرحلة القادمة». |
| ٢ | **قاعدة الشكل الأساسية تدخل رسالة اليوم:** قاعدة واحدة في `apps/web/app/globals.css` للأزرار والخانات والقوائم وحالة التعطيل، بألوان النظام نفسها، والعنصر الذي له شكل خاصّ يبقى كما هو. القياس في §٢ من `measure-four-papers-dark-theme-window.md` (٥٨٧ من ٩٥٠ عنصراً بلا شكل). |
| ٣ | **يوم ٢٤:** بعد الدمج والزرع، تمشي جلسة فهم الكود على شاشات السيناريو وحدها بالوضع الفاتح، وتصوّرها للإدارة. شاشة ما زالت تُخجل تخرج من السيناريو. |
| ٤ | **محمد يعرض بالوضع الفاتح**، وبحساب واحد في المتصفّح في كل مرّة. |

## ما لا يغيّره هذا الحكم

لا كلمة عربية تتغيّر بقاعدة الشكل · لا شاشة تُحذَف من النظام · قائمة «ما يتجنّبه محمد» في ورقة المشية الأخيرة باقية.

---

## For the engineer — the base style rule (English)

**Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** No word changes. No role is granted a permission code.

One base rule in `apps/web/app/globals.css` for `button`, `input` (not checkbox, radio or file), `select` and `textarea`, and for `:disabled`, built on the existing design tokens (`--surface-card`, `--ink-primary`, `--border-default`, `--radius-md`, `--brand-600`, `--on-brand` and their dark-theme values), matching what `components/auth/auth-form.styles.ts:99-130` already renders. An element that carries its own `style` or `className` keeps it: the rule must not override them. A disabled control must stay readable in both themes. **Check by eye in both the light and the dark theme**, on at least `/settings/roles`, `/settings/users`, `/audit-trail`, `/rfqs/new`, a claim page and the opportunity page, and say in the report what you saw. Report the count of bare controls before and after (it was 587 of 950 on `2cb95423`). If the rule changes how any existing e2e or visual assertion reads, report it; do not suppress the assertion.
