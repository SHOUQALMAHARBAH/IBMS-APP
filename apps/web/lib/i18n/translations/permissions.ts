// One short line per permission, saying what holding it ALLOWS — the text under each checkbox on
// `/settings/roles`.
//
// ## Why these live in the dictionary
//
// They are user-facing text, and this system has ONE home for user-facing text. They used to live in
// `lib/admin/permission-descriptions.ts`, a second bilingual map outside the dictionary and therefore
// outside its guards — no parity check, no single-ownership check, no test of its own. The argument for
// leaving them there was that the dictionary's parity guard would fail on codes whose Arabic line was
// deliberately empty, so moving would mean weakening a working guard. That argument did not survive
// contact with the work: a permission that does nothing today gets a line SAYING it does nothing, which
// is more use to an office manager than falling through to a technical English string. With no empty
// lines to protect, the only obstacle to moving was gone.
//
// Moving GAINS checks rather than losing them. The two coverage checks — every catalogue code has a line,
// and no line exists for a code the catalogue lacks — are about the relationship between the catalogue and
// the text, so they have to be written wherever the text lives. The dictionary adds AR/EN parity and
// single-ownership on top of them, already written and already maintained.
//
// ## THE KEY SHAPE: `perm:<code>`, the code verbatim
//
// A permission code is not a translation key — it carries dots and hyphens — so it is prefixed and
// quoted rather than transformed. The mapping is therefore mechanical in BOTH directions with no parsing:
//
//     key  = 'perm:' + code          `permissionDescriptionKey` in ./permission-key.ts
//     code = key.slice('perm:'.length)
//
// Nothing is camel-cased, abbreviated or lower-cased, because every one of those is lossy: `customer.360-view.read`
// and `customer.360.view.read` would collide under any separator-stripping scheme, and a guard that walks
// catalogue → key would then match the wrong line. Verbatim cannot collide.
//
// It also fails in the right direction on a RENAME. Rename a code and its key changes with it, so the old
// line shows up as an orphan and the new code shows up as missing — both of which the coverage guard names.
// A pattern-matching key (say, the last segment, or a fuzzy match) would silently keep pairing the renamed
// code with the old sentence, which is the failure this shape exists to make impossible.
//
// ## What is wanted in a line
//
// What the person can then DO, in the language of the work — not the code restated, and not the stored
// English description, which is a developer-facing hint. An office manager reads this to decide whether to
// grant it. Long lines are fine: measured on the real screen, a 720-character Arabic line wraps to five
// lines with no clipping, no row overflow and no horizontal scroll (`e2e/permission-description-length.spec.ts`).
export const PERMISSIONS = {
  AR: {
    'perm:role.read': 'الاطّلاع على أدوار المكتب وصلاحيات كل دور، دون تعديلها.',
    // `role.manage` split into three in four-action Phase 1, and its single Arabic sentence described all
    // three at once — so it could not be copied onto each. These three are the owner's to word; until she
    // does, the line says plainly that the wording is pending rather than falling back to English, because
    // a fallback is what let three of these sit empty and unnoticed.
    'perm:role.create': 'إنشاء دور جديد في قائمة أدوار المكتب. (الوصف بانتظار المراجعة)',
    'perm:role.update':
      'تعديل اسم الدور وما يمنحه ومتطلبات المصادقة الثنائية فيه. (الوصف بانتظار المراجعة)',
    'perm:role.deactivate':
      'إيقاف دور أو إعادته للعمل أو حذف دور لم يُستخدم قط. (الوصف بانتظار المراجعة)',
    'perm:user.manage':
      'إنشاء حسابات الدخول وإسناد الأدوار أو سحبها وتفعيل الحساب أو إلغاؤه.',
  },
  EN: {
    'perm:role.read': "See the office's roles and what each one grants, without changing them.",
    'perm:role.create': "Define a new role in the office's catalogue. (wording pending review)",
    'perm:role.update':
      'Rename a role, change what it grants, and set its MFA requirements. (wording pending review)',
    'perm:role.deactivate':
      'Retire a role, bring a retired one back, or delete one that was never used. (wording pending review)',
    'perm:user.manage': 'Create login accounts, grant or revoke roles, activate or deactivate access.',
  },
} as const;
