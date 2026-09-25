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
  },
} as const;
