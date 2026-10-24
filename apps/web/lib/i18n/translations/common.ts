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
    /*
     * OWNER DECISION 55 — ONE KEY FOR THREE SCREENS, not three keys: one concept, one
     * word, one place to change it. `/bcp-dr-plans`, `/dsr` and
     * `/regulatory-compliance` all render it.
     *
     * IT NAMES NO DEADLINE, AND THAT IS MEASURED RATHER THAN TERSE: on all three the
     * marker sits BESIDE THE DATE ITSELF, so the column already says which deadline
     * expired. `/incidents` is the exception and keeps the longer form — see below.
     */
    statusOverdue: '(فات موعده)',
    /*
     * THE EXCEPTION, AND THE REASON IS THE LAYOUT. On `/incidents` this marker sits
     * beside the incident's SEVERITY, not beside a date, so a reader who is not told
     * WHICH clock expired cannot work it out from the row. Do not shorten it to
     * `statusOverdue` for symmetry.
     */
    statusContainmentOverdue: '(فات موعد الاحتواء)',
    /*
     * THE MOST DANGEROUS OF THE ELEVEN, and the wording carries the danger rather than
     * the mechanism. Measured: the loss ratio exceeded `MAX_LOSS_RATIO` (999.9999) and
     * was CLAMPED to fit `LossRatio.ratio @db.Decimal(7, 4)` — so THE DISPLAYED FIGURE
     * IS THE CEILING, NOT THE RATIO, and the renewal workflow depends on that number.
     * An Arabic reader was reading a clamped ratio as the true one.
     *
     * IT DELIBERATELY DOES NOT NAME THE LIMIT, unlike decision 54's «٢٠٠٠٠», so there
     * is NOTHING TO TIE TO `MAX_LOSS_RATIO` and no assertion is owed. A figure in the
     * string would be a second home for that constant; *the true one is higher* is
     * true at any ceiling.
     *
     * Shared by `/claims-analytics` (twice) and `/dashboards/claims`.
     */
    statusRatioCapped: '(بلغت الحدّ — الحقيقية أكبر)',
    /* `/operational-pi-risk` — professional-indemnity cover has ENDED. Speaks about the
     * COVER, which is why the record marker beside it speaks about the RECORD; see
     * `statusRecordCurrent`. */
    statusCoverLapsed: '(التغطية منتهية)',
    /* `/sla-dashboard` — a DRAFTED duration carries no regulatory source, so it must
     * not be read as one. This repository already keeps sourced and drafted SLA
     * durations apart as a decision; this is that distinction on the screen. */
    statusNoRegulatorySource: '(بلا سند نظاميّ)',
    /* `/audit-trail` — this document version is the one that was REQUESTED, not a final one. */
    statusRequestedVersion: '(النسخة المطلوبة)',
    /*
     * A WORDING TRAP THE OWNER RULED ON, AND IT MUST SURVIVE IN THIS COMMENT.
     *
     * A professional-indemnity record can be the CURRENT one while its cover has
     * LAPSED — that is precisely the state `statusCoverLapsed` exists for. So this is
     * «الحالية» and NOT «سارية»: «الحالية» speaks about the RECORD, «سارية» would
     * speak about the COVER, and «سارية (التغطية منتهية)» is a contradiction on one
     * line.
     *
     * DO NOT 'IMPROVE' THIS TO «سارية» LATER.
     */
    statusRecordCurrent: 'الحالية',
    /* The other half of the same pair — a superseded PI record. */
    statusRecordPast: 'سابقة',
    /* `/regulatory-compliance` — the obligation has been filed. */
    statusSubmitted: 'مُقدَّم',
    /* NOT «قيد الانتظار». The English said `pending`, which reads as *being processed*;
     * measured, `isSubmitted` is false — nothing has been filed at all, which is a
     * different fact and the one a regulator would ask about. */
    statusNotSubmitted: 'لم يُقدَّم',
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

    /* ITEM 8 — the sentence a screen shows when SOME of its lists did not arrive, and the
     * names of the lists that recur across screens. One home: nine screens say this. */
    commonListsMissing:
      'تعذّر تحميل بعض القوائم، وما ظهر منها صالحٌ للاستخدام. القوائم التي لم تُحمَّل:',
    commonListDepartments: 'قائمة الأقسام',
    commonListBranches: 'قائمة الفروع',
    commonListRoles: 'قائمة الأدوار',
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
    // The document chooser (owner decision 41). «مستند», NEVER «وثيقة»: in this product «وثيقة» is the
    // POLICY — `entitySearchPolicyLabel` above is «ابحث عن وثيقة» and `/policies` is «الوثائق» — so
    // reusing it here would make "find a document" read as "find a policy". The word is taken from the
    // documents screen's own heading («المستندات») rather than written, which is also why «الملف» is
    // the file name: the same screen's own column header. Same class of noun collision the discard
    // control's «سحب» note below guards against.
    entitySearchDocumentLabel: 'ابحث عن مستند',
    entitySearchDocumentPlaceholder: 'اسم الملف — ثلاثة أحرف على الأقل',
    entitySearchDocumentNoMatches: 'لا يوجد مستند مطابق لما أدخلته.',
    entitySearchDocumentError: 'تعذّر تنفيذ البحث عن المستندات. حاول مرة أخرى.',
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
    dutyModeSaved: 'تم إعلان الوضع وتسجيله في سجل التدقيق.',
    // The act ON the record (step 5). «الشخص نفسه» — names what happened, not a euphemism for it.
    combinedDutyOnRecord: 'نفّذ الشخص نفسه طرفي هذه العملية بصفته ({roles})، والسبب المسجّل:',
    // When MORE THAN ONE of the actor's roles granted the checker permission, the record says it
    // cannot tell which — naming one would assert something the system does not know.
    combinedDutyOnRecordAmbiguous:
      'نفّذ الشخص نفسه طرفي هذه العملية، وكانت أكثر من صفة من صفاته تمنح هذه الصلاحية ' +
      '({roles})، فلا يمكن تحديد أيها استُند إليه. والسبب المسجّل:',
    // MODULE 0-ب — the DPO designation and its declaration (/settings/duty-segregation), and the
    // conflict-of-interest disclosure register (/settings/security). Prefixed `dpoAssign*` and
    // `coiReg*`: `dutyMode*` and `dutySeg*` are both taken by adjacent features and the i18n guard
    // refuses a collision.
    //
    // `dpoAssignNotice` AND `dpoAssignAcknowledge` ARE THE OWNER'S OWN TEXT, authorised the same way
    // the `sanctions-pep.screen` description and decision 28's notice were. Their concatenation is
    // pinned BY HASH against the file she supplied — decision 94 still governs every other Arabic
    // string here, and a byte-level pin is what makes this one provably hers rather than retyped.
    coiRegDeclareButton:
      'تسجيل الإفصاح',
    coiRegDisclosureHint:
      '{min} أحرف على الأقل. اذكر ما هي المصلحة وبمن تتصل — فهذا ما يُجيب عن السؤال لاحقاً.',
    coiRegDisclosureLabel:
      'ما تريد الإفصاح عنه',
    coiRegEmpty:
      'لا يوجد إفصاح مسجّل في هذا المكتب بعد.',
    coiRegHeading:
      'الإفصاح عن تضارب المصالح',
    coiRegIntro:
      'إذا كان لديك مصلحة قد تتعارض مع عملك في المكتب — صلة بعميل أو بشركة تأمين أو بوسيط، أو عمل آخر، أو منفعة — فأفصح عنها هنا. الإفصاح عن نفسك لا يحتاج صلاحية: أنت صاحب الشأن، ومن عليه تضارب يجب أن يستطيع قوله. ولا يُعدَّل الإفصاح ولا يُحذَف بعد تسجيله؛ والتصحيح إفصاح جديد.',
    coiRegLoadError:
      'تعذّر تحميل سجل الإفصاح. حاول مرة أخرى.',
    coiRegSaveError:
      'تعذّر تسجيل الإفصاح. حاول مرة أخرى.',
    coiRegSaved:
      'تم تسجيل إفصاحك.',
    coiRegTableHeading:
      'سجل الإفصاح في المكتب',
    coiRegWhatHeading:
      'الإفصاح',
    coiRegWhenHeading:
      'متى',
    coiRegWhoHeading:
      'من أفصح',
    coiRegWorkingButton:
      'جارٍ التسجيل…',
    dpoAssignAcknowledge:
      'أقِرَّ بأنّك قرأتَ ما سبق.',
    dpoAssignAcknowledgedOn:
      'أقرّ به {who} في {when}',
    dpoAssignHeading:
      'إسناد مسؤول حماية البيانات',
    dpoAssignIntro:
      'قانون حماية البيانات الشخصية يوجب على المكتب أن يُسنِد وظيفة مسؤول حماية البيانات. سجّل هنا من أُسنِدت إليه — بالاسم. ويقدر المكتب أن يُسنِدها إلى شخص ثانٍ فيه، أو إلى مسؤول من خارجه، أو إلى مدير المكتب نفسه؛ ولا يمنع النظام أيّاً من ذلك.',
    dpoAssignLoadError:
      'تعذّر تحميل بيانات الإسناد. حاول مرة أخرى.',
    dpoAssignManagerLabel:
      'مدير المكتب المسجّل',
    dpoAssignManagerUnset:
      'لا يوجد اسم مسجّل لمدير المكتب. يُسجَّل عند التسجيل لدى مزوّد المنصّة، ولا يُعدَّل من هنا.',
    dpoAssignNameHint:
      'الاسم كما تريد أن يظهر. اتركه فارغاً إذا لم تُسنَد الوظيفة إلى أحد بعد.',
    dpoAssignNameLabel:
      'من أُسنِدت إليه وظيفة مسؤول حماية البيانات',
    dpoAssignNotice:
      'الإسنادان على شخصٍ واحد. وظيفةُ مديرِ المكتب ووظيفةُ مسؤولِ حماية البيانات مُسنَدتان إلى الشخصِ نفسِه.\n\nوقانونُ حماية البيانات الشخصية رقم (٢٤) لسنة ٢٠٢٣، المادة ١١/أ، يشترط في مسؤولِ حماية البيانات استقلالاً عن قراراتِ الإدارةِ التنفيذية — فمن مهامِه مراقبةُ الإدارةِ والتحقيقُ في الخروقاتِ ورفعُ التقارير. وعدمُ استيفاءِ ذلك يُعرِّض المكتبَ، بموجب المادتَين ٢١ و٢٢، لإنذارٍ ثمّ غراماتٍ تصاعدية، ولإيقافِ الترخيصِ أو تعليقِ معالجةِ البيانات، ولحقِّ المتضرِّرِ في التعويض.\n\nويقدر المكتبُ أن يُسنِدها إلى أيِّ شخصٍ ثانٍ فيه — ولا يُشترَط اعتمادٌ تأمينيّ، بل معرفةٌ وسرّيةٌ واستقلالٌ عن قراراتِ الإدارة — أو إلى مسؤولٍ من خارج المكتب. وإن لم يكن في المكتبِ ثانٍ، فالإسنادُ على شخصٍ واحدٍ قرارُ المكتب، والنظامُ يسجّله ولا يمنعه.',
    dpoAssignSaveButton:
      'حفظ الإسناد',
    dpoAssignSaveError:
      'تعذّر حفظ الإسناد. حاول مرة أخرى.',
    dpoAssignSaved:
      'تم تسجيل الإسناد.',
    dpoAssignWorkingButton:
      'جارٍ الحفظ…',
    combinedDutyReasonLabel: 'سبب تنفيذك لطرفي العملية',
    combinedDutyReasonHint:
      'أنت من سجّل هذا الطلب، ومكتبك أعلن السماح لك باعتماده أيضاً. اذكر السبب — يُحفَظ بشكل دائم ويظهر في تقرير الاعتمادات الذاتية.',
  },
  EN: {
    commonLoading: 'Loading…',
    commonWorking: 'Working…',
    commonSaving: 'Saving…',
    statusOverdue: '(past its deadline)',
    statusContainmentOverdue: '(containment deadline passed)',
    statusRatioCapped: '(at the ceiling — the true ratio is higher)',
    statusCoverLapsed: '(cover has ended)',
    statusNoRegulatorySource: '(no regulatory source)',
    statusRequestedVersion: '(the requested version)',
    statusRecordCurrent: 'current',
    statusRecordPast: 'past',
    statusSubmitted: 'submitted',
    statusNotSubmitted: 'not submitted',
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

    /* ITEM 8 — see the Arabic above. */
    commonListsMissing:
      'Some lists did not load. What you can see is usable. Did not load:',
    commonListDepartments: 'the departments list',
    commonListBranches: 'the branches list',
    commonListRoles: 'the roles list',
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
    // See the Arabic block above on why this is «مستند» and not «وثيقة».
    entitySearchDocumentLabel: 'Find a document',
    entitySearchDocumentPlaceholder:
      'The file name — at least three characters',
    entitySearchDocumentNoMatches: 'No document matches what you entered.',
    entitySearchDocumentError: 'The document search could not run. Try again.',
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
    dutyModeSaved: 'Declared, and recorded in the audit trail.',
    combinedDutyOnRecord:
      'One person performed both halves of this, acting as {roles}. Recorded reason:',
    // When MORE THAN ONE of the actor's roles granted the checker permission, the record says it
    // cannot tell which — naming one would assert something the system does not know.
    combinedDutyOnRecordAmbiguous:
      'One person performed both halves of this. More than one of their roles grants that ' +
      'permission ({roles}), so which one authorised it cannot be determined. Recorded reason:',
    coiRegDeclareButton:
      'Record the disclosure',
    coiRegDisclosureHint:
      'At least {min} characters. Say what the interest is and who it connects to — that is what answers the question later.',
    coiRegDisclosureLabel:
      'What you are declaring',
    coiRegEmpty:
      'Nobody in this office has recorded a disclosure yet.',
    coiRegHeading:
      'Conflict of interest disclosure',
    coiRegIntro:
      'If you hold an interest that could conflict with your work for this office — a connection to a customer, an insurer or a broker, other employment, or a benefit — declare it here. Declaring about yourself needs no permission: you are the subject, and somebody who has a conflict must be able to say so. A disclosure cannot be edited or deleted once recorded; a correction is a new disclosure.',
    coiRegLoadError:
      'Could not load the disclosure register — try again.',
    coiRegSaveError:
      'Could not record the disclosure — try again.',
    coiRegSaved:
      'Your disclosure has been recorded.',
    coiRegTableHeading:
      'This office disclosure register',
    coiRegWhatHeading:
      'The disclosure',
    coiRegWhenHeading:
      'When',
    coiRegWhoHeading:
      'Who declared it',
    coiRegWorkingButton:
      'Recording…',
    dpoAssignAcknowledge:
      'Acknowledge that you have read the above.',
    dpoAssignAcknowledgedOn:
      'Acknowledged by {who} on {when}',
    dpoAssignHeading:
      'Data protection officer assignment',
    dpoAssignIntro:
      'The Personal Data Protection Law requires this office to assign a data protection officer. Record here who holds it, by name. The office may assign it to a second person inside it, to an officer outside it, or to the office manager themselves, and the system prevents none of those.',
    dpoAssignLoadError:
      'Could not load the assignment — try again.',
    dpoAssignManagerLabel:
      'The office manager on record',
    dpoAssignManagerUnset:
      'No name is on record for the office manager. It is recorded when the platform provider registers the office and is not editable here.',
    dpoAssignNameHint:
      'The name as you want it to appear. Leave it empty if nobody holds it yet.',
    dpoAssignNameLabel:
      'Who holds the data protection officer assignment',
    dpoAssignNotice:
      'The two assignments are on one person. The office manager function and the data protection officer function are assigned to the same person.\n\nAnd the Personal Data Protection Law No. 24 of 2023, article 11/a, requires a data protection officer to be independent of executive management decisions — their duties include monitoring management, investigating breaches and reporting. Not meeting that exposes the office, under articles 21 and 22, to a warning and then escalating fines, to suspension of the licence or of data processing, and to the injured party right to compensation.\n\nThe office may assign it to any second person in it — no insurance accreditation is required, but knowledge, confidentiality and independence from management decisions — or to an officer outside the office. And if there is no second person in the office, assigning it to one person is the office decision, and the system records it and does not prevent it.',
    dpoAssignSaveButton:
      'Save the assignment',
    dpoAssignSaveError:
      'Could not save the assignment — try again.',
    dpoAssignSaved:
      'The assignment has been recorded.',
    dpoAssignWorkingButton:
      'Saving…',
    combinedDutyReasonLabel: 'Why you are doing both halves',
    combinedDutyReasonHint:
      'You raised this, and your office has declared that you may also approve it. Say why — it is kept permanently and appears in the self-approval report.',
  },
} as const;
