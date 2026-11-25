# IBMS — القرار ١٦٤: رسالة «تم إنشاء الدور بنجاح»، وسطر «العميل» في بطاقة الفرصة (٢٥ تشرين الثاني ٢٠٢٦)

## القرار بجملة

بعد إنشاء الدور تظهر رسالة صغيرة «تم إنشاء الدور بنجاح» بعلامة صحّ خضراء وبشكل الشاشة، وسطر «العميل» يُحذَف من بطاقة الفرصة لأن الاسم صار في عنوانها.

## كلام الإدارة بحرفه

«1- تم إنشاء الدور بنجاح و بتطلع زي بوب أب صغيرة شكلها متناسق مع الشاشة و فيها صح أخضر. … 3- اوكيه.»

**على ماذا:** أسئلة جلسة التنسيق بعد قياس رسالة ٥٣ (`IBMS-DOC\msg-53\measure-msg-53.md`).
**المديول:** مديول ١ (شاشات). يكمّل ١٦٣/٥ و١٦٣/١.

## الأحكام

| # | الحكم |
|---|---|
| ١ | **«تم إنشاء الدور بنجاح»** — نصّ الإدارة بحرفه، مصادَق عليه. يظهر بعد نجاح «إنشاء الدور» رسالةً صغيرة منبثقة، بعلامة صحّ خضراء، بألوان النظام وخطّه، وتختفي وحدها. لا تمنع الشاشة ولا تحتاج كبسة. |
| ٢ | **سطر «العميل: …» في بطاقة الفرصة يُحذَف** (فعله المهندس في رسالة ٥٣). الاسم في العنوان «فرصة تجارية — {اسم العميل}». المفتاح `oppListCustomerLabel` يبقى في القاموس. |

## مفتوح

«(sample rating)»: سُئلت الإدارة عنه بعد الشرح (رسالة الإدارة ١٣:٤٣، سؤال ٢).

---

## For the engineer — decision 164 (English)

**Copy this file into `docs/` verbatim, with an index row.** **Do not print, echo or paste any secret value anywhere in your report — name variables, never values.** No role is granted a permission code.

**§1 — the role-created message.** After `POST` creates a role on `/settings/roles`, show «تم إنشاء الدور بنجاح» (the owner's words, byte-exact; English: "Role created successfully.") as a small non-blocking toast with a green check mark, on the design tokens, that dismisses itself and is announced to assistive technology (`role="status"`). If the product already ships a toast or a saved-message component, use it and say which; do not build a second one. Byte-exact assertion; an e2e that creates a role and sees the toast.

**§2 — the opportunity card's «العميل» row** is removed, as message 53 did. Nothing to build.
