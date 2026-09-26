// Part F — Bilingual UI, full-app translation (post-item-#8 follow-up).
// Shared strings reused across many screens — generic verbs/labels, common
// loading/empty/error copy shapes. Domain-specific strings live in their own
// file in this directory (leads.ts, customers.ts, ...), merged into one
// `TranslationKey` union by ../translations.ts. Keyed by a semantic name
// (never by the English phrase itself), the same convention the original
// 6-key dictionary established.
export const COMMON = {
  AR: {
    commonLoading: 'جارٍ التحميل…',
    commonWorking: 'جارٍ التنفيذ…',
    commonSaving: 'جارٍ الحفظ…',
    commonSave: 'حفظ',
    commonCancel: 'إلغاء',
    commonSearch: 'بحث',
    commonSearchPlaceholder: 'الاسم، بالعربية أو الإنجليزية',
    commonEdit: 'تعديل',
    commonDelete: 'حذف',
    commonClose: 'إغلاق',
    commonBack: 'رجوع',
    commonSubmit: 'إرسال',
    commonNext: 'التالي',
    commonYes: 'نعم',
    commonNo: 'لا',
    commonOptional: 'اختياري',
    commonRequired: 'إلزامي',
    commonActions: 'الإجراءات',
    commonStatus: 'الحالة',
    commonTryAgain: 'تعذر تحميل البيانات — حاول مرة أخرى.',
    // Rendered by app/(app)/layout.tsx above EVERY authenticated screen while no authenticator is
    // paired. Without it the first sign-in lands on a home page whose every link answers 403, and
    // nothing on screen connects that to enrolment.
    mfaBannerTitle: 'خطوة واحدة قبل أن يعمل النظام: اربط تطبيق المصادقة',
    mfaBannerBody:
      'معظم الشاشات سترفض العمل حتى تربط تطبيق مصادقة بحسابك. هذه ليست مشكلة في صلاحياتك.',
    mfaBannerCta: 'اذهب إلى الأمان لإتمام الربط',
    pagingAria: 'تصفّح الصفحات',
    pagingRange: 'عرض {from}–{to} من {total}',
    pagingPrevious: 'السابق',
    pagingNext: 'التالي',
    customerPickerSearchLabel: 'ابحث عن عميل',
    customerPickerSearchPlaceholder: 'الاسم، بالعربية أو الإنجليزية',
    customerPickerNonePlaceholder: '— اختر عميلاً —',
    customerPickerNoMatches: 'لا يوجد عميل مطابق لهذا الاسم.',
    customerPickerSearchError: 'تعذّر تنفيذ بحث العملاء. حاول مرة أخرى.',
    entitySearchActorLabel: 'ابحث عن شخص',
    entitySearchActorPlaceholder: 'اسم الشخص الذي نفّذ الإجراء',
    entitySearchActorNone: '— كل الأشخاص —',
    entitySearchActorNoMatches: 'لا يوجد شخص بهذا الاسم في سجل التدقيق.',
    entitySearchActorError: 'تعذّر تنفيذ البحث عن الأشخاص. حاول مرة أخرى.',
    // DiscardControl.tsx — withdrawing a record raised in error, shared by policy / claim / endorsement /
    // recommendation. NOT «إلغاء» anywhere: that word is this product's CANCELLATION (a cancellation
    // endorsement on a live policy), and reusing it here would make a withdrawal read as cancelling the
    // client's cover. «سحب» throughout, including the back button, which is where the collision would
    // otherwise slip in unnoticed.
    discardButton: 'سحب السجل — أُنشئ بالخطأ',
    discardHeading: 'سحب سجل أُنشئ بالخطأ',
    discardExplanation:
      'يبقى السجل ظاهراً ومُعلَّماً كمسحوب، ولا يُحذف. السحب نهائي: لا يمكن التراجع عنه ولا تعديله، ومن يحتاج سجلاً صحيحاً يُنشئ سجلاً جديداً.',
    discardReasonLabel: 'السبب',
    discardReasonHint:
      '{min} أحرف على الأقل. يبقى السبب على السجل بشكل دائم، وهو كل ما سيعتمد عليه من يقرؤه لاحقاً.',
    discardConfirmButton: 'تأكيد السحب',
    discardCancelButton: 'رجوع',
    discardWorkingButton: 'جارٍ الحفظ…',
    discardActionError: 'تعذّر سحب السجل. حاول مرة أخرى.',
    discardedBadge: 'مسحوب — أُنشئ بالخطأ',
    discardedOn: 'سُحب في {when}',
    discardedReasonLabel: 'السبب:',
    // /settings/duty-segregation — Part 4 step 4. Prefixed `dutyMode*`, NOT `dutySeg*`: the readiness list
    // on /settings/roles already owns that prefix (Part 5), and the i18n guard refused the collision — which
    // is the guard doing exactly what it exists for. Two adjacent features, two prefixes. NOT «إلغاء» and NOT «دمج المهام» loosely: «الفصل بين
    // المهام» is the control's own name in Arabic governance language, and the COMBINED mode is described as
    // «تنفيذ الشخص نفسه لطرفي العملية» — what actually happens — rather than a euphemism.
    dutyModeHeading: 'الفصل بين المهام',
    dutyModeIntro:
      'بعض العمليات تتطلب شخصين: من ينفّذها ومن يعتمدها. يحدّد هذا الإعداد ما إذا كان مكتبك يفصل بين الطرفين، أو يسمح للشخص نفسه بتنفيذهما مع تسجيل السبب في كل مرة.',
    dutyModeCurrentLabel: 'الوضع الحالي',
    dutyModeSegregated: 'مفصول — يلزم شخصان',
    dutyModeCombined: 'مدمج — يجوز للشخص نفسه تنفيذ الطرفين، مع تسجيل السبب',
    dutyModeNeverDeclared: 'لم يُعلَن هذا الوضع صراحةً — هو الوضع الافتراضي.',
    dutyModeDeclaredBy: 'أعلنه {who} في {when}',
    dutyModeReasonLabel: 'سبب الإعلان',
    dutyModeReasonHint:
      '{min} أحرف على الأقل. يُحفَظ في سجل التدقيق بشكل دائم، وهو ما يُجيب عن سؤال «من قرّر هذا ومتى».',
    dutyModeDeclareButton: 'إعلان الوضع',
    dutyModeWorkingButton: 'جارٍ الحفظ…',
    dutyModeLoadError: 'تعذّر تحميل وضع الفصل بين المهام. حاول مرة أخرى.',
    dutyModeSaveError: 'تعذّر إعلان الوضع. حاول مرة أخرى.',
    dutyModeReadOnly:
      'لديك صلاحية الاطلاع على هذا الوضع دون تغييره. من يعلن الوضع ليس من يراجع الأعمال التي يسمح بها.',
    dutyModeCombinedBlocked:
      'لا يمكن إعلان الوضع المدمج بعد: تقرير الاعتمادات الذاتية الذي يعتمد عليه غير موجود حتى الآن.',
    dutyModeSaved: 'تم إعلان الوضع وتسجيله في سجل التدقيق.',
    // The act ON the record (step 5). «الشخص نفسه» — names what happened, not a euphemism for it.
    combinedDutyOnRecord: 'نفّذ الشخص نفسه طرفي هذه العملية بصفته ({roles})، والسبب المسجّل:',
  },
  EN: {
    commonLoading: 'Loading…',
    commonWorking: 'Working…',
    commonSaving: 'Saving…',
    commonSave: 'Save',
    commonCancel: 'Cancel',
    commonSearch: 'Search',
    commonSearchPlaceholder: 'Name, in Arabic or English',
    commonEdit: 'Edit',
    commonDelete: 'Delete',
    commonClose: 'Close',
    commonBack: 'Back',
    commonSubmit: 'Submit',
    commonNext: 'Next',
    commonYes: 'Yes',
    commonNo: 'No',
    commonOptional: 'Optional',
    commonRequired: 'Required',
    commonActions: 'Actions',
    commonStatus: 'Status',
    commonTryAgain: 'Could not load this — try again.',
    mfaBannerTitle: 'One step before the system works: pair an authenticator app',
    mfaBannerBody:
      'Most screens will refuse to load until you pair an authenticator app with your account. This is not a problem with your permissions.',
    mfaBannerCta: 'Go to Security to finish pairing',
    pagingAria: 'Pagination',
    pagingRange: 'Showing {from}–{to} of {total}',
    pagingPrevious: 'Previous',
    pagingNext: 'Next',
    customerPickerSearchLabel: 'Find a customer',
    customerPickerSearchPlaceholder: 'Name, in Arabic or English',
    customerPickerNonePlaceholder: '— select a customer —',
    customerPickerNoMatches: 'No customer matches that name.',
    customerPickerSearchError: 'The customer search could not run. Try again.',
    entitySearchActorLabel: 'Find a person',
    entitySearchActorPlaceholder: 'The name of whoever did it',
    entitySearchActorNone: '— everyone —',
    entitySearchActorNoMatches: 'Nobody by that name appears in the audit log.',
    entitySearchActorError: 'The person search could not be run. Try again.',
    // DiscardControl.tsx — see the note in the Arabic block above on why «إلغاء» is not used there.
    discardButton: 'Withdraw as raised in error',
    discardHeading: 'Withdraw a record raised in error',
    discardExplanation:
      'The record stays visible, marked withdrawn — it is not deleted. A withdrawal is terminal: it cannot be reversed or edited, and anybody who needs a correct record creates a new one.',
    discardReasonLabel: 'Reason',
    discardReasonHint:
      'At least {min} characters. The reason stays on the record permanently and is all anybody reading it later has to go on.',
    discardConfirmButton: 'Confirm withdrawal',
    discardCancelButton: 'Back',
    discardWorkingButton: 'Saving…',
    discardActionError: 'Could not withdraw the record. Try again.',
    discardedBadge: 'Withdrawn — raised in error',
    discardedOn: 'Withdrawn on {when}',
    discardedReasonLabel: 'Reason:',
    // /settings/duty-segregation — Part 4 step 4.
    dutyModeHeading: 'Separation of duties',
    dutyModeIntro:
      'Some operations need two people: one to perform them and one to approve them. This setting decides whether your office separates those halves, or allows one person to do both with a recorded reason each time.',
    dutyModeCurrentLabel: 'Current setting',
    dutyModeSegregated: 'Separated — two people required',
    dutyModeCombined:
      'Combined — one person may do both halves, with a recorded reason',
    dutyModeNeverDeclared:
      'Nobody has declared this explicitly — it is the default.',
    dutyModeDeclaredBy: 'Declared by {who} on {when}',
    dutyModeReasonLabel: 'Reason for this declaration',
    dutyModeReasonHint:
      'At least {min} characters. Kept permanently in the audit trail, and it is what answers "who decided this, and when".',
    dutyModeDeclareButton: 'Declare setting',
    dutyModeWorkingButton: 'Saving…',
    dutyModeLoadError: 'Could not load the separation-of-duties setting. Try again.',
    dutyModeSaveError: 'Could not declare the setting. Try again.',
    dutyModeReadOnly:
      'You can see this setting but not change it. Whoever declares it is not whoever reviews the acts it permits.',
    dutyModeCombinedBlocked:
      'Combined cannot be declared yet: the self-approval report it depends on does not exist.',
    dutyModeSaved: 'Declared, and recorded in the audit trail.',
    combinedDutyOnRecord:
      'One person performed both halves of this, acting as {roles}. Recorded reason:',
  },
} as const;
