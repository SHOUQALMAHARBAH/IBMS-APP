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
    commonClear: 'مسح',
    entitySearchResultsLabel: 'نتائج البحث',
    commonSearchPlaceholder: 'الاسم، بالعربية أو الإنجليزية',
    commonEdit: 'تعديل',
    commonRename: 'إعادة تسمية',
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
    // THE REFUSAL SENTENCE — the one place all 91 permission refusals are worded.
    // `{act}` is the screen's own act, in the language of the WORK rather than of the permission. The
    // grantor is named BY FUNCTION, never by role name: an office defines its own role names, so
    // «مسؤول المكتب» would be a sentence that can be false in any given office. The code goes in the
    // parenthetical, never in the sentence. See lib/i18n/permission-refusal.ts.
    permissionRefusal:
      'ليست لديك صلاحية {act} — اطلبها ممن يدير الصلاحيات في مكتبك. ({code})',
    // أي واحدة — a ROUTE guard, which ORs its codes (`required.some`).
    permissionRefusalAnyOf:
      'ليست لديك صلاحية {act}، وتكفي أي واحدة من هذه الصلاحيات — اطلبها ممن يدير الصلاحيات في مكتبك. ({code})',
    // كلها — a SCREEN that loads several endpoints together and closes if any one of them refuses.
    permissionRefusalAllOf:
      'ليست لديك صلاحية {act}، وهي تحتاج إلى هذه الصلاحيات كلها — اطلبها ممن يدير الصلاحيات في مكتبك. ({code})',
    // THE SECOND SHAPE — a reader who is partially enabled rather than refused. Keeps the half that says
    // what still works, and adds the grantor the eight originals all lacked.
    reducedCapability:
      'يمكنك {can}، لكن لا يمكنك {cannot} — اطلب ذلك ممن يدير الصلاحيات في مكتبك. ({code})',
    // An action that FAILED where a missing grant is the likely cause, not a certainty.
    permissionMayBeMissing:
      'تعذّر {act} — قد لا تكون لديك الصلاحية اللازمة. اطلبها ممن يدير الصلاحيات في مكتبك. ({code})',
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
    entitySearchCustomerPlaceholder: 'الاسم أو رقم السجل التجاري — ثلاثة أحرف على الأقل',
    customerPickerNonePlaceholder: '— اختر عميلاً —',
    customerPickerNoMatches: 'لا يوجد عميل مطابق لما أدخلته.',
    customerPickerSearchError: 'تعذّر تنفيذ بحث العملاء. حاول مرة أخرى.',
    entitySearchActorLabel: 'ابحث عن شخص',
    entitySearchActorPlaceholder: 'اسم الشخص الذي نفّذ الإجراء',
    entitySearchActorNone: '— كل الأشخاص —',
    entitySearchActorNoMatches: 'لا يوجد شخص بهذا الاسم في سجل التدقيق.',
    entitySearchActorError: 'تعذّر تنفيذ البحث عن الأشخاص. حاول مرة أخرى.',
    // THE FOUR PICKERS added 2026-10-02 — insurer, policy, user, branch. Each placeholder names what a
    // person actually HAS in front of them, which is the whole defect being fixed: the screens asked for
    // a uuid, which is in nobody's hand.
    entitySearchEmployeeLabel: 'ابحث عن موظف',
    entitySearchEmployeePlaceholder: 'اسم الموظف — حرفان على الأقل',
    entitySearchEmployeeNoMatches: 'لا يوجد موظف بهذا الاسم.',
    entitySearchEmployeeError: 'تعذّر تنفيذ البحث عن الموظفين. حاول مرة أخرى.',
    // A FORMER employee of the same name is exactly the case a picker has to disambiguate.
    entitySearchEmployeeFormer: 'لم يعد على رأس عمله',
    entitySearchInsurerLabel: 'ابحث عن شركة تأمين',
    entitySearchInsurerPlaceholder: 'اسم الشركة بالعربية أو بالإنجليزية',
    entitySearchInsurerNoMatches: 'لا توجد شركة تأمين مطابقة لما أدخلته.',
    entitySearchInsurerError: 'تعذّر تنفيذ البحث عن شركات التأمين. حاول مرة أخرى.',
    entitySearchPolicyLabel: 'ابحث عن وثيقة',
    entitySearchPolicyPlaceholder: 'رقم الوثيقة أو اسم العميل — ثلاثة أحرف على الأقل',
    entitySearchPolicyNoMatches: 'لا توجد وثيقة مطابقة لما أدخلته.',
    entitySearchPolicyError: 'تعذّر تنفيذ البحث عن الوثائق. حاول مرة أخرى.',
    // A policy is placed before it is issued, and the number arrives with issuance. Stated as a state
    // rather than left as an empty first column, which reads as a fault in the data.
    entitySearchPolicyUnnumbered: 'لم يُصدر لها رقم بعد',
    entitySearchUserLabel: 'ابحث عن مستخدم',
    entitySearchUserPlaceholder: 'اسم الموظف',
    entitySearchUserNoMatches: 'لا يوجد مستخدم بهذا الاسم.',
    entitySearchUserError: 'تعذّر تنفيذ البحث عن المستخدمين. حاول مرة أخرى.',
    entitySearchBranchLabel: 'ابحث عن فرع',
    entitySearchBranchPlaceholder: 'اسم الفرع',
    entitySearchBranchNoMatches: 'لا يوجد فرع مطابق لما أدخلته.',
    entitySearchBranchError: 'تعذّر تنفيذ البحث عن الفروع. حاول مرة أخرى.',
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
    dutyModeRefusalAct: 'الاطلاع على كيفية فصل المهام في هذا المكتب',
    dutyModeSaveError: 'تعذّر إعلان الوضع. حاول مرة أخرى.',
    dutyModeReadOnly:
      'لديك صلاحية الاطلاع على هذا الوضع دون تغييره. من يعلن الوضع ليس من يراجع الأعمال التي يسمح بها.',
    dutyModeCombinedBlocked:
      'لا يمكن إعلان الوضع المدمج بعد: تقرير الاعتمادات الذاتية الذي يعتمد عليه غير موجود حتى الآن.',
    dutyModeSaved: 'تم إعلان الوضع وتسجيله في سجل التدقيق.',
    // The act ON the record (step 5). «الشخص نفسه» — names what happened, not a euphemism for it.
    combinedDutyOnRecord: 'نفّذ الشخص نفسه طرفي هذه العملية بصفته ({roles})، والسبب المسجّل:',
    // When MORE THAN ONE of the actor's roles granted the checker permission, the record says it
    // cannot tell which — naming one would assert something the system does not know.
    combinedDutyOnRecordAmbiguous:
      'نفّذ الشخص نفسه طرفي هذه العملية، وكانت أكثر من صفة من صفاته تمنح هذه الصلاحية ' +
      '({roles})، فلا يمكن تحديد أيها استُند إليه. والسبب المسجّل:',
    combinedDutyReasonLabel: 'سبب تنفيذك لطرفي العملية',
    combinedDutyReasonHint:
      'أنت من سجّل هذا الطلب، ومكتبك أعلن السماح لك باعتماده أيضاً. اذكر السبب — يُحفَظ بشكل دائم ويظهر في تقرير الاعتمادات الذاتية.',
  },
  EN: {
    commonLoading: 'Loading…',
    commonWorking: 'Working…',
    commonSaving: 'Saving…',
    commonSave: 'Save',
    commonCancel: 'Cancel',
    commonSearch: 'Search',
    commonClear: 'Clear',
    entitySearchResultsLabel: 'Search results',
    commonSearchPlaceholder: 'Name, in Arabic or English',
    commonEdit: 'Edit',
    commonRename: 'Rename',
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
    permissionRefusal:
      'You do not hold permission to {act} — ask whoever manages permissions in your office. ({code})',
    permissionRefusalAnyOf:
      'You do not hold permission to {act}, and any one of these permissions grants it — ask whoever manages permissions in your office. ({code})',
    permissionRefusalAllOf:
      'You do not hold permission to {act}, and it needs all of these permissions — ask whoever manages permissions in your office. ({code})',
    reducedCapability:
      'You can {can}, but not {cannot} — ask whoever manages permissions in your office to change that. ({code})',
    permissionMayBeMissing:
      'Could not {act} — you may not hold the permission for it. Ask whoever manages permissions in your office. ({code})',
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
    entitySearchCustomerPlaceholder: 'Name or commercial registration number — at least three characters',
    customerPickerNonePlaceholder: '— select a customer —',
    customerPickerNoMatches: 'No customer matches what you entered.',
    customerPickerSearchError: 'The customer search could not run. Try again.',
    entitySearchActorLabel: 'Find a person',
    entitySearchActorPlaceholder: 'The name of whoever did it',
    entitySearchActorNone: '— everyone —',
    entitySearchActorNoMatches: 'Nobody by that name appears in the audit log.',
    entitySearchActorError: 'The person search could not be run. Try again.',
    // THE FOUR PICKERS added 2026-10-02 — see the note in the Arabic block above.
    entitySearchEmployeeLabel: 'Find an employee',
    entitySearchEmployeePlaceholder: "The person's name — at least two characters",
    entitySearchEmployeeNoMatches: 'No employee by that name.',
    entitySearchEmployeeError: 'The employee search could not run. Try again.',
    entitySearchEmployeeFormer: 'no longer employed here',
    entitySearchInsurerLabel: 'Find an insurer',
    entitySearchInsurerPlaceholder: 'The company name, in Arabic or English',
    entitySearchInsurerNoMatches: 'No insurer matches what you entered.',
    entitySearchInsurerError: 'The insurer search could not run. Try again.',
    entitySearchPolicyLabel: 'Find a policy',
    entitySearchPolicyPlaceholder:
      "Policy number or the customer's name — at least three characters",
    entitySearchPolicyNoMatches: 'No policy matches what you entered.',
    entitySearchPolicyError: 'The policy search could not run. Try again.',
    entitySearchPolicyUnnumbered: 'no number issued yet',
    entitySearchUserLabel: 'Find a user',
    entitySearchUserPlaceholder: "The person's name",
    entitySearchUserNoMatches: 'No user by that name.',
    entitySearchUserError: 'The user search could not run. Try again.',
    entitySearchBranchLabel: 'Find a branch',
    entitySearchBranchPlaceholder: 'The branch name',
    entitySearchBranchNoMatches: 'No branch matches what you entered.',
    entitySearchBranchError: 'The branch search could not run. Try again.',
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
    dutyModeRefusalAct: 'view how this office separates duties',
    dutyModeSaveError: 'Could not declare the setting. Try again.',
    dutyModeReadOnly:
      'You can see this setting but not change it. Whoever declares it is not whoever reviews the acts it permits.',
    dutyModeCombinedBlocked:
      'Combined cannot be declared yet: the self-approval report it depends on does not exist.',
    dutyModeSaved: 'Declared, and recorded in the audit trail.',
    combinedDutyOnRecord:
      'One person performed both halves of this, acting as {roles}. Recorded reason:',
    // When MORE THAN ONE of the actor's roles granted the checker permission, the record says it
    // cannot tell which — naming one would assert something the system does not know.
    combinedDutyOnRecordAmbiguous:
      'One person performed both halves of this. More than one of their roles grants that ' +
      'permission ({roles}), so which one authorised it cannot be determined. Recorded reason:',
    combinedDutyReasonLabel: 'Why you are doing both halves',
    combinedDutyReasonHint:
      'You raised this, and your office has declared that you may also approve it. Say why — it is kept permanently and appears in the self-approval report.',
  },
} as const;
