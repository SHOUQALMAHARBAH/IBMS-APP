// Compliance & risk cluster — screening review, screening health and the
// SLA policy table.
//
// These three screens were ALREADY bilingual, via inline
// `isArabic ? "…" : "…"` ternaries rather than the dictionary. The Arabic
// below is that existing text, moved verbatim — not a retranslation — so
// whatever review it already had is preserved. Keys were generated from
// the English, which is why they read mechanically.
export const COMPLIANCE_SCREENING = {
  AR: {
    smLoading: 'جارٍ التحميل…',
    slapLoading: 'جارٍ التحميل…',
    smRefusalAct: 'عرض قائمة مراجعة العقوبات',
    smCouldNotLoadTheMatch: 'تعذّر تحميل قائمة المطابقات — حاول مرة أخرى.',
    smRecordingThatDecisionFailedTry: 'فشل تسجيل القرار — حاول مرة أخرى.',
    smSanctionsMatchReview: 'مطابقات العقوبات للمراجعة',
    smNamesAreCheckedAgainstThe:
      'تُقارن الأسماء مع قوائم OFAC والأمم المتحدة المحدَّثة تلقائياً، مع مطابقة تقريبية تشمل اختلافات كتابة الاسم بالحروف اللاتينية والأسماء الرباعية. المطابقة هنا سؤال وليست حكماً — لا يوقف النظام أي عميل تلقائياً؛ القرار قرار مسؤول الامتثال.',
    smTheLocalSanctionsListIs:
      'قائمة العقوبات المحلية فارغة — لم تُنفَّذ المزامنة بعد. لم يُفحص أي عميل فعلياً، والقائمة الفارغة هنا لا تعني عدم وجود تطابقات. شغّل POST /watchlist-sync/run.',
    smNothingAwaitingReview: 'لا توجد مطابقات بانتظار المراجعة.',
    smNoRecords: 'لا توجد سجلات.',
    smCustomer: 'العميل',
    smMatchedName: 'الاسم المطابِق',
    smListEntry: 'سجل القائمة',
    smType: 'النوع',
    smDetected: 'رُصد في',
    smDecision: 'القرار',
    smReview: 'المراجعة',
    smEdd: 'عناية معززة',
    smViewCustomerRfqs: 'طلبات عروض الأسعار لهذا العميل',
    smNoLongerOnTheSource: 'رُفع من القائمة المصدر — القرار قائم',
    smReasonForTheDecisionMin: 'سبب القرار (١٠ أحرف على الأقل)',
    smClearFalsePositive: 'مطابقة خاطئة',
    smConfirmMatch: 'تأكيد المطابقة',
    smCaseColumn: 'حالة الملف',
    smCaseOpen: 'مفتوح — لم يُسنَد',
    smCaseAssigned: 'مُسنَد',
    smCaseUnderReview: 'قيد المراجعة',
    smCaseEscalated: 'مُصعَّد',
    smCaseClosed: 'مُغلق',
    smCaseAssignee: 'المراجع',
    smCaseUnknownReviewer: 'مُسنَد إلى شخص لم يبقَ مؤهلاً للمراجعة — أعِد الإسناد',
    smCaseReviewerLabel: 'اختر مراجعاً',
    smCaseAssign: 'إسناد',
    smCaseReassign: 'إعادة الإسناد',
    smCaseStartReview: 'بدء المراجعة',
    smCaseEscalate: 'تصعيد',
    smCaseEscalateReason: 'سبب التصعيد (١٠ أحرف على الأقل)',
    smCaseNotes: 'ملاحظات العمل',
    smCaseAddNote: 'إضافة ملاحظة',
    smCaseNotePlaceholder:
      'ما الذي تحقّقت منه، وبأي مُعرِّفات، وما النتيجة. هذا هو السجل الذي تطلبه ' +
      'الجهة الرقابية: «يجب على الجهة الاحتفاظ بآلية التحقق والإجراءات المتخذة ' +
      'بشأن الحالة في سجلاتها الداخلية».',
    smCaseShowNotes: 'عرض الملاحظات',
    smCaseHideNotes: 'إخفاء الملاحظات',
    smCaseNoNotes: 'لا ملاحظات بعد.',
    smCaseDecideAfterReview:
      'أسنِد الملف وابدأ المراجعة قبل تسجيل القرار — قرار على ملف لم يفتحه أحد ليس مراجعة.',
    smCaseActionFailed: 'تعذّر تنفيذ الإجراء على الملف — حاول مرة أخرى.',
    smCaseNoReviewers:
      'لا يوجد مستخدم نشط يملك صلاحية sanctions-pep.screen غيرك، فلا أحد يمكن الإسناد إليه.',
    smComplianceOfficerOnly: 'مسؤول الامتثال فقط',
    smReviewReasonAria: 'سبب المراجعة لـ {name}',
    slapRefusalAct: 'عرض سياسات مستويات الخدمة',
    slapCouldNotLoadSlaPolicies: 'تعذّر تحميل سياسات مستوى الخدمة — حاول مرة أخرى.',
    slapThatActionFailedTryAgain: 'فشل تنفيذ الإجراء — حاول مرة أخرى.',
    slapSlaPolicies: 'سياسات مستوى الخدمة',
    slapEveryDeadlineInTheSystem:
      'كل مهلة زمنية في النظام قابلة للتهيئة من هنا دون تغيير في الشيفرة. الأهم: يوضّح هذا الجدول مصدر كل مهلة — «تنظيمي» يعني أنّ هناك نصاً قانونياً يوجبها ويُذكر مرجعه، وأي تصنيف آخر يعني أنّها هدف داخلي وليست إلزاماً قانونياً.',
    slapNoPolicies: 'لا توجد سياسات.',
    slapHolidaysHeading: 'أيام العطل الرسمية',
    slapHolidaysIntro:
      'كل مهلة محسوبة بأيام العمل تُحتسب مقابل هذا التقويم. الأيام المدرجة هنا ' +
      'لا تُحتسب ضمن المدة.',
    slapHolidaysEmptyWarning:
      'التقويم فارغ. كل مهلة محسوبة بأيام العمل تُحسب حالياً كأن الجمعة هي يوم ' +
      'العمل المعطَّل الوحيد في السنة — فتأتي المواعيد أبكر من حقيقتها، ويُسجَّل ' +
      'التجاوز قبل وقوعه، ويُسجَّل الإنجاز الواقع داخل المدة الحقيقية متأخراً. ' +
      'أرقام الالتزام الحالية تُظهر تأخراً أكبر من الواقع — في غير مصلحة الشركة. ' +
      'أدخل الأيام المعتمدة رسمياً.',
    slapHolidayDate: 'التاريخ',
    slapHolidayDateHint: 'تاريخ يوم العطلة.',
    slapHolidayName: 'المناسبة',
    slapHolidayCalendar: 'التقويم',
    slapHolidayAllCalendars: 'كل التقاويم',
    slapHolidayAdd: 'إضافة يوم عطلة',
    slapHolidayAddError: 'تعذّر إضافة يوم العطلة — حاول مرة أخرى.',
    slapHolidayLoadError: 'تعذّر تحميل تقويم العطل — حاول مرة أخرى.',
    slapHolidayCanAct: 'الاطلاع على أيام العطل التي تُحسب المهل مقابلها',
    slapHolidayCannotAct: 'إدخال يوم عطلة',
    slapHolidayLoading: 'جارٍ تحميل التقويم…',
    slapHolidayYear: 'السنة',
    slapHolidayYearOwes: 'ما زالت هذه السنة تنقصها أيام',
    slapHolidayFixedMissing: 'العطل ثابتة التاريخ غير المُدخلة',
    slapHolidayAddFixed: 'أضِف العطل الثابتة لهذه السنة',
    slapHolidayFixedNote:
      'أربع عطل تتكرر في التاريخ نفسه كل سنة: رأس السنة الميلادية (١ كانون الثاني)، ' +
      'عيد العمال (١ أيار)، عيد الاستقلال (٢٥ أيار)، عيد الميلاد المجيد (٢٥ كانون الأول).',
    slapHolidayMovingHeading: 'المناسبات الإسلامية — تُدخل حسب الإعلان الرسمي',
    slapHolidayMovingNote:
      'تواريخ هذه المناسبات تُحدَّد بإعلان رسمي في الأردن وقد تختلف بيوم عن أي تحويل ' +
      'تقويمي، لذلك لا يحسبها النظام. أدخل تاريخ أول يوم من الإعلان، ويتولى النظام ' +
      'باقي الأيام بعدد أيام المناسبة.',
    slapHolidayOccasion: 'المناسبة',
    slapHolidayStartDate: 'تاريخ أول يوم',
    slapHolidayAddOccasion: 'إدخال المناسبة',
    slapHolidayDays: 'أيام',
    slapHolidayYearComplete: 'هذه السنة مكتملة — كل العطل المعروفة مُدخلة.',
    slapHolidayOccasionError: 'تعذّر إدخال المناسبة — حاول مرة أخرى.',
    slapProcess: 'العملية',
    slapDuration: 'المهلة',
    slapSource: 'المصدر',
    slapCalendar: 'التقويم',
    slapStatus: 'الحالة',
    slapAction: 'إجراء',
    slapNotALegalRequirement: 'ليست إلزاماً قانونياً',
    // Defining a new SLA policy. The REGULATORY wording is the load-bearing part: it must say
    // that the choice claims LEGAL force, because recording an internal target as a legal
    // requirement is the failure `sourceType` exists to prevent.
    slapCreateOpen: 'تعريف سياسة مدة جديدة',
    slapCreateLegend: 'سياسة مدة جديدة',
    slapCreateCode: 'رمز السياسة',
    slapCreateCodeHint:
      'من 3 إلى 64 خانة: أحرف إنجليزية كبيرة وأرقام وشرطات، مثل SLA-DSR-ACCESS. ' +
      'يُقتبس في مستندات الحوكمة، فلا يتغير عند تغيّر المدة.',
    slapCreateName: 'اسم السياسة',
    slapCreateProcess: 'العملية',
    slapCreateWorkflowState: 'حالة سير العمل (اتركها فارغة لتشمل العملية كاملة)',
    slapCreateDescription: 'الوصف',
    slapCreateDuration: 'المدة',
    slapCreateUnit: 'الوحدة',
    slapCreateCalendar: 'التقويم',
    slapCreateSourceType: 'مصدر الإلزام',
    // SLICED from `slaDashRegulatoryTitle` — «هذه المهلة مصدرها نظامي» — which
    // is this same enum member described on the SLA dashboard, so the word is already
    // the product's own for this concept. `statusNoRegulatorySource` uses «نظاميّ» for
    // the absence of one.
    //
    // ONE KEY, NOT AN `ENUM_LABEL` FAMILY, AND THAT IS DELIBERATE. `SlaSourceType` has
    // FIVE members and only this one is hardcoded in a text position; the other four
    // (INTERNAL_POLICY, CONTRACTUAL, OPERATIONAL, OTHER) have no Arabic anywhere and are
    // on the owner's list. A family naming one of five would render the member name for
    // the other four, which is the notification-bell defect this repository has already
    // paid for — so the family is created when her four words arrive, not before.
    /*
     * OWNER DECISION 59 — the two `<select>`s on the new-SLA-policy form rendered their
     * raw stored values, and the sharpest part is that one option in the SOURCE list was
     * ALREADY translated: `slapSourceRegulatory` = «نظامي» sat beside four English ones.
     * One Arabic option and four English in a single list, and the calendar `<select>`
     * immediately beside it was fully translated.
     *
     * EVERY WORD HERE IS A CONTIGUOUS SLICE of a string already shipping — verified by
     * substring check against the dictionary on disk, not by eye. Nine of the ten words
     * decision 59 needed were already in the product; the only one that was not is
     * «تقويمية», and the owner ruled it is not needed.
     *
     * `slapUnitCalendarDays` IS «أيام» WITH NO QUALIFIER, which is her decision: the two
     * options are adjacent in one list — «أيام عمل» then «أيام» — so the contrast carries
     * the distinction, and a word added to mark a difference the list already shows is
     * cost without gain.
     *
     * `slapSourceInternalPolicy` IS «داخلي», NOT a composed «سياسة داخلية». Both halves
     * ship separately, and joining them would have been a composition rather than a
     * slice — but it is not needed: `dataClassInternal` ships «داخلي» as a standalone
     * enum label, and this feature's own `slaDashRegulatoryTitle` already contrasts
     * «نظامي» with «داخلي» in exactly this sense. It also keeps the list a list of
     * ADJECTIVES instead of one noun phrase among four.
     */
    slapUnitMinutes: 'دقائق',
    slapUnitHours: 'ساعات',
    slapUnitBusinessDays: 'أيام عمل',
    slapUnitCalendarDays: 'أيام',
    slapUnitMonths: 'أشهر',
    slapSourceInternalPolicy: 'داخلي',
    slapSourceContractual: 'تعاقدي',
    slapSourceOperational: 'تشغيلي',
    slapSourceOther: 'أخرى',
    slapSourceRegulatory: 'نظامي',
    slapRegulatoryCanAct: 'إنشاء هذه السياسة',
    slapRegulatoryCannotAct: 'تسجيلها كمطلوبة بحكم التنظيم',
    slapCreateRegulatoryWarning:
      'تسجيل السياسة كإلزام قانوني يقتضي تسمية النص الذي يفرضها. المرجع والمستند مطلوبان.',
    slapCreateSourceReference: 'المرجع',
    slapCreateSourceDocument: 'المستند',
    slapCreateSourceSection: 'البند',
    slapCreateBornDraft:
      'تُنشأ السياسة كمسودة. التفعيل قرار منفصل ومسجَّل، فلا تسري المدة قبله.',
    slapCreateSave: 'حفظ السياسة',
    slapCreateCancel: 'إلغاء الإدخال',
    slapCreateFailed: 'تعذر إنشاء السياسة.',
    slap247: 'على مدار الساعة',
    slapCustom: 'مخصّص',
    slapJordanWorkingDays: 'أيام العمل (الأردن)',
    slapSave: 'حفظ',
    slapDeactivate: 'تعطيل',
    slapActivate: 'تفعيل',
    slapReadOnly: 'للاطلاع فقط',
    slapDurationAria: 'المدة لـ {name}',
    shRefusalAct: 'عرض تقرير سلامة الفحص',
    shCouldNotLoadScreeningHealth: 'تعذّر تحميل حالة الفحص — حاول مرة أخرى.',
    shListHealth: 'حالة مزوّد الفحص',
    shListOverview: 'إحصاءات الفحص لآخر ٣٠ يوماً',
    /*
     * OWNER ANSWER 2 — the two capability words, hers verbatim.
     *
     * «الأشخاص السياسيون (PEP)» is the NOMINATIVE, which is what a column label takes. The
     * Arabic already on this screen reads «فحص الأشخاص السياسيين (PEP)» — genitive, inside a
     * sentence — and agreeing that run back to the nominative is morphology rather than a
     * slice. That difference is why this was her decision; do not "harmonise" the two.
     */
    shCapSanctions: 'العقوبات',
    shCapPep: 'الأشخاص السياسيون (PEP)',
    /*
     * AND THE OTHER SEVEN, also hers. `PROVIDER_CAPABILITY_LABEL_KEY` is TOTAL with no `null`
     * left, so the screen's fall-through to the raw token is DELETED rather than left
     * unreachable — the same treatment `AR_AGEING_BUCKET_FALLBACK` got.
     *
     * «التغطية الإعلامية السلبية» WAS DECIDED TWICE. She rejected «الأخبار السلبية» as not clear
     * enough to a clerk and chose this, which is the AML term. The rejected one is the one a
     * later reader would guess, which is why it is written down here and in the register.
     */
    shCapWatchlist: 'قوائم المراقبة',
    shCapAdverseMedia: 'التغطية الإعلامية السلبية',
    shCapIndividual: 'فحص الأفراد',
    shCapEntity: 'فحص الكيانات',
    shCapBatch: 'الفحص بالدفعات',
    shCapOngoingMonitoring: 'المراقبة المستمرة',
    shCapWebhooks: 'إشعارات فورية',
    /*
     * THE TWENTY-SEVEN CAPABILITY NOTES — the sentence under each capability name, which until
     * this batch was English prose the api sent and this screen rendered verbatim. An Arabic
     * compliance officer read an English token with an English sentence under it, on the screen
     * whose job is to say whether customers are actually being screened.
     *
     * `hardcoded-ui-english.py` reported 0 and was right to: it reads the WEB tree and these
     * strings did not exist here. That is the structural class the thirteen risk-questionnaire
     * prompts already recorded by name, met for the SECOND time.
     *
     * The api now names a `CapabilityNoteKey` and the web resolves it, so the FOUR keys that
     * interpolate carry their parameter rather than their sentence. Every value below is the
     * owner's own Arabic except `shNoteBuiltInSanctionsSynced`, which her table did not have
     * because the built-in SANCTIONS row is a TERNARY and she was given its false branch — it is
     * a contiguous run of `wsIntro` on `/watchlist-sync`, asserted as a substring rather than
     * asked for.
     */
    shNoteBuiltInSanctionsSynced: 'تُزامَن قائمتان عامّتان مجانيتان للعقوبات (OFAC SDN وقائمة الأمم المتحدة الموحّدة) محلياً.',
    shNoteBuiltInCacheEmpty: 'مهيّأ، لكن القوائم المحفوظة داخلياً فارغة — لم تكتمل أي مزامنة بعد.',
    shNoteBuiltInNoPepData: 'لا تتوفّر لدى هذا المزوّد أي بيانات عن الأشخاص السياسيين. فحصهم يحتاج مزوّداً تجارياً، أو محرّكاً مركَّباً لدى المكتب تتضمّن بياناته هذه الفئة.',
    shNoteBuiltInSanctionsOnly: 'تُزامَن قوائم العقوبات فقط.',
    shNoteBuiltInAdverseMediaUnavailable: 'غير متوفّرة.',
    shNoteBuiltInIndividualNames: 'تُطابَق أسماء الأشخاص.',
    shNoteBuiltInEntityLegalNames: 'تُطابَق الأسماء القانونية للشركات.',
    shNoteBuiltInBatchLocal: 'يجري الفحص داخلياً على دفعات، ولا يوجد حدّ خارجي لعدد الطلبات.',
    shNoteBuiltInMonitoringSchedule: 'إعادة فحص كل أربع ساعات، وإعادة فحص فور تحديث القوائم.',
    shNoteBuiltInWebhooksNotApplicable: 'لا تنطبق على قوائم محفوظة داخل النظام.',
    shNoteCommercialContractCoverage: 'التغطية الفعلية تعتمد على المنتج المتعاقَد عليه — راجع اتفاقية المزوّد قبل الاعتماد عليها.',
    shNoteCommercialIndividual: 'فحص أفراد.',
    shNoteCommercialEntity: 'فحص كيانات.',
    shNoteCommercialBatchFanOut: 'تُرسَل الأسماء واحداً تلو الآخر؛ يُستبدَل ذلك بواجهة دفعات لدى المزوّد إن توفّرت.',
    shNoteCommercialMonitoringEnrolment: 'تتطلّب اشتراك مراقبة لدى المزوّد، وهو قرار تعاقدي — لا يُفعَّل من النظام وحده.',
    shNoteCommercialWebhooksNotConfigured: 'تتطلّب عنوان استقبال مُوثَّقاً ومفتاحاً مشتركاً؛ غير مُهيّأة.',
    shNoteOnPremiseDataset: 'مجموعة البيانات «{name}».',
    shNoteOnPremisePepVerify: 'حسب ما إذا كانت مجموعة البيانات «{name}» تتضمّن بيانات الأشخاص السياسيين — راجع قائمة بيانات المحرّك قبل الاعتماد عليها.',
    shNoteOnPremisePepSanctionsOnly: 'مجموعة البيانات «{name}» مقتصرة على العقوبات؛ لا تُفحَص بيانات الأشخاص السياسيين.',
    shNoteOnPremiseAdverseMediaUnavailable: 'لا يوفّرها هذا المحرّك.',
    shNoteOnPremisePersonSchema: 'وفق نموذج بيانات الأشخاص.',
    shNoteOnPremiseOrganizationSchema: 'وفق نموذج بيانات المنشآت.',
    shNoteOnPremiseBatchFanOut: 'تُرسَل الأسماء واحداً تلو الآخر مراعاةً لطاقة المحرّك.',
    shNoteOnPremiseMonitoringScheduler: 'عبر مجدوِل إعادة الفحص، لا عبر إشعار من المزوّد.',
    shNoteOnPremiseWebhooksUnsupported: 'المحرّك لا يرسل إشعارات.',
    shNoteNotConfigured: 'غير مُهيّأ.',
    shNoteNotConfiguredMissing: 'غير مُهيّأ — ناقص: {list}.',
    shScreeningHealth: 'حالة فحص العقوبات',
    shWhichProviderActuallyPerformsScreening:
      'يوضّح هذا الجدول أي مزوّد يُجري الفحص فعلياً، وما إذا كانت بياناته حديثة، وما الذي يغطيه. «غير مُهيّأ» أو «غير متاح» تعني أنّ الفحص لم يجرِ — وهي ليست نتيجة سلبية.',
    shLoading: 'جارٍ التحميل…',
    shProvider: 'المزوّد',
    shStatus: 'الحالة',
    shState: 'الحالة التفصيلية',
    shType: 'النوع',
    shAuthentication: 'المصادقة',
    shAccepted: 'مقبولة',
    shRejected: 'مرفوضة',
    shNotApplicable: 'لا تنطبق',
    shName: 'الاسم',
    shCapabilities: 'القدرات والتغطية',
    shSupportedMeansTheAdapterImplements:
      '«مدعوم» يعني أنّ المحوّل ينفّذها، و«مهيّأ» يعني أنّ هذا النشر وفّر ما تحتاجه، و«فعّال» يعني أنّها تعمل الآن. الخلط بين الثلاثة هو ما يجعل نظاماً يدّعي تغطية لا يملكها.',
    shCapability: 'القدرة',
    shSupported: 'مدعوم',
    shConfigured: 'مهيّأ',
    shOperational: 'فعّال',
    shPepScreeningIsNotOperational:
      'فحص الأشخاص السياسيين (PEP) غير فعّال. لا يجوز اعتبار أي عميل «خالياً» من هذه الناحية.',
    shDataset: 'البيانات',
    shVersion: 'الإصدار',
    shLastUpdated: 'آخر تحديث',
    shCheckedAt: 'وقت الفحص',
    shMatchingRules: 'قواعد المطابقة',
    shTheseThresholdsAreConfigurableAnd:
      'هذه العتبات قابلة للتهيئة وتمثّل قرار مخاطر يخصّ الشركة — وليست قاعدة تنظيمية.',
    shHigh: 'مرتفع',
    shReview: 'مراجعة',
    shDiscardBelow: 'تجاهل دون',
    shSendIdentifiersToProvider: 'إرسال أرقام الهوية للمزوّد',
    shYes: 'نعم',
    shNo: 'لا',
    shAHealthCheckAnswersWhether:
      'فحص الاتصال يجيب: هل المزوّد متاح الآن؟ هذه الأرقام تجيب: كم عميلاً تم فحصه فعلاً؟',
    shNoScreeningAttemptsRecordedIn: 'لا توجد عمليات فحص مسجّلة في هذه الفترة.',
    shTotal: 'الإجمالي',
    shDidNotProduceAUsable: 'لم تُنتج نتيجة قابلة للاستخدام',
    shTheseCustomersWereNotScreened:
      'لم يتم فحص هؤلاء العملاء — ولم يُعتبروا خالين من المطابقة. راجع الأسباب أدناه.',
    shMostRecentFailures: 'أحدث الإخفاقات',
    shOutcome: 'النتيجة',
    shProvider2: 'المزوّد',
    shReason: 'السبب',
    shHoldsAndCaseWorkload: 'الملفات الموقوفة وقائمة العمل',
    shDecidableFilesCurrentlyHeld: 'ملفات قابلة للقرار موقوفة حالياً',
    shPendingMatches: 'مطابقات قيد الانتظار',
    shCaseState: 'حالة الحالة',
    shCount: 'العدد',
    shNoOpenCases: 'لا توجد حالات مفتوحة.',
    shSanctionsListGenerations: 'إصدارات قوائم العقوبات',
    shAScreeningReadsOnlyThe:
      'يقرأ الفحص الإصدار المنشور فقط. الإصدار قيد التنزيل غير مرئي إطلاقاً.',
    shNoGenerationExistsNoSync:
      'لا يوجد أي إصدار — لم تكتمل أي مزامنة بعد، ولا يمكن اعتبار أي عميل خالياً من المطابقة.',
    shSource: 'المصدر',
    shStatus2: 'الحالة',
    shRecords: 'السجلات',
    shAdded: 'جديدة',
    shRolledBack: 'تراجع: ',
    shRecurringWork: 'المهام الدورية',
    shRecurringReScreen: 'إعادة الفحص الدورية',
    shUnknown: 'غير معروف',
    shListSync: 'مزامنة القوائم',
    shUnknown2: 'غير معروف',
    shLastSuccessfulSync: 'آخر مزامنة ناجحة',
    shNever: 'لا يوجد',
    shSyncHistory: 'سجل المزامنة',
    shNoSyncHasRunYet: 'لم تُشغَّل أي مزامنة بعد.',
    shSource2: 'المصدر',
    shStatus3: 'الحالة',
    shRecords2: 'السجلات',
  },
  EN: {
    smLoading: 'Loading…',
    slapLoading: 'Loading…',
    smRefusalAct: 'view the sanctions review queue',
    smCouldNotLoadTheMatch: 'Could not load the match queue — try again.',
    smRecordingThatDecisionFailedTry: 'Recording that decision failed — try again.',
    smSanctionsMatchReview: 'Sanctions match review',
    smNamesAreCheckedAgainstThe:
      'Names are checked against the synced OFAC and UN sanctions lists using fuzzy matching, which covers romanisation variants (Mohammed / Muhammad) and Jordan’s four-part naming convention against shorter list entries. A match here is a QUESTION, not a verdict — nothing is blocked automatically; the decision is a Compliance Officer’s.',
    smTheLocalSanctionsListIs:
      'The local sanctions list is EMPTY — the sync has never run. No customer has actually been screened, and an empty queue here does NOT mean there are no matches. Run POST /watchlist-sync/run.',
    smNothingAwaitingReview: 'Nothing awaiting review.',
    smNoRecords: 'No records.',
    smCustomer: 'Customer',
    smMatchedName: 'Matched name',
    smListEntry: 'List entry',
    smType: 'Type',
    smDetected: 'Detected',
    smDecision: 'Decision',
    smReview: 'Review',
    smEdd: 'EDD',
    smViewCustomerRfqs: 'RFQs for this customer',
    smNoLongerOnTheSource: 'No longer on the source list — decision stands',
    smReasonForTheDecisionMin: 'Reason for the decision (min. 10 characters)',
    smClearFalsePositive: 'Clear (false positive)',
    smConfirmMatch: 'Confirm match',
    smCaseColumn: 'Case',
    smCaseOpen: 'Open — nobody assigned',
    smCaseAssigned: 'Assigned',
    smCaseUnderReview: 'Under review',
    smCaseEscalated: 'Escalated',
    smCaseClosed: 'Closed',
    smCaseAssignee: 'Reviewer',
    smCaseUnknownReviewer:
      'Assigned to somebody who is no longer an eligible reviewer — re-assign it',
    smCaseReviewerLabel: 'Choose a reviewer',
    smCaseAssign: 'Assign',
    smCaseReassign: 'Re-assign',
    smCaseStartReview: 'Start review',
    smCaseEscalate: 'Escalate',
    smCaseEscalateReason: 'Reason for escalating (min. 10 characters)',
    smCaseNotes: 'Working notes',
    smCaseAddNote: 'Add note',
    smCaseNotePlaceholder:
      'What you checked, against which identifiers, and what it showed. This is ' +
      'the record the regulator asks for: "the entity must keep the verification ' +
      'mechanism and actions taken regarding the case in internal records."',
    smCaseShowNotes: 'Show notes',
    smCaseHideNotes: 'Hide notes',
    smCaseNoNotes: 'No notes yet.',
    smCaseDecideAfterReview:
      'Assign the case and start the review before recording a decision — a decision on a case nobody picked up is not a review.',
    smCaseActionFailed: 'That case action failed — try again.',
    smCaseNoReviewers:
      'No active user other than you holds sanctions-pep.screen, so there is nobody to assign to.',
    smComplianceOfficerOnly: 'Compliance Officer only',
    smReviewReasonAria: 'Review reason for {name}',
    slapRefusalAct: 'view the service level policies',
    slapCouldNotLoadSlaPolicies: 'Could not load SLA policies — try again.',
    slapThatActionFailedTryAgain: 'That action failed — try again.',
    slapSlaPolicies: 'SLA policies',
    slapEveryDeadlineInTheSystem:
      'Every deadline in the system is configured here, with no code change. More importantly, this table states where each deadline COMES FROM: “Regulatory” means an instrument requires it and names that instrument; any other classification means it is an internal target, not a legal obligation.',
    slapNoPolicies: 'No policies.',
    slapHolidaysHeading: 'Non-working days',
    slapHolidaysIntro:
      'Every deadline measured in business days is counted against this calendar. ' +
      'A day listed here does not consume any of the allowance.',
    slapHolidaysEmptyWarning:
      'The calendar is EMPTY. Every business-day deadline is currently computed as ' +
      'though Fridays were the only non-working days of the year, so deadlines land ' +
      'earlier than they really fall, a breach is reported before it happens, and ' +
      'work finished inside the true window is recorded late. The compliance figures ' +
      'currently overstate lateness — against this brokerage. Enter the officially ' +
      'observed days.',
    slapHolidayDate: 'Date',
    slapHolidayDateHint: 'The date of the holiday.',
    slapHolidayName: 'Occasion',
    slapHolidayCalendar: 'Calendar',
    slapHolidayAllCalendars: 'All calendars',
    slapHolidayAdd: 'Add non-working day',
    slapHolidayAddError: 'Could not add that day — try again.',
    slapHolidayLoadError: 'Could not load the calendar — try again.',
    slapHolidayCanAct: 'see the non-working days a deadline is counted against',
    slapHolidayCannotAct: 'enter one',
    slapHolidayLoading: 'Loading the calendar…',
    slapHolidayYear: 'Year',
    slapHolidayYearOwes: 'This year is still missing days',
    slapHolidayFixedMissing: 'Fixed-date holidays not yet entered',
    slapHolidayAddFixed: 'Add the fixed holidays for this year',
    slapHolidayFixedNote:
      'Four holidays fall on the same date every year: New Year\'s Day (1 Jan), Labour ' +
      'Day (1 May), Independence Day (25 May), Christmas (25 Dec).',
    slapHolidayMovingHeading: 'Islamic occasions — entered from the official announcement',
    slapHolidayMovingNote:
      'These dates are set by official announcement in Jordan and can differ by a day ' +
      'from any calendar conversion, so the system does not compute them. Enter the ' +
      'first day from the announcement and the system fills the rest, using the number ' +
      'of days the occasion runs.',
    slapHolidayOccasion: 'Occasion',
    slapHolidayStartDate: 'First day',
    slapHolidayAddOccasion: 'Enter the occasion',
    slapHolidayDays: 'days',
    slapHolidayYearComplete: 'This year is complete — every known holiday is entered.',
    slapHolidayOccasionError: 'Could not enter that occasion — try again.',
    slapProcess: 'Process',
    slapDuration: 'Duration',
    slapSource: 'Source',
    slapCalendar: 'Calendar',
    slapStatus: 'Status',
    slapAction: 'Action',
    slapNotALegalRequirement: 'Not a legal requirement',
    // Defining a new SLA policy.
    slapCreateOpen: 'Define a new SLA policy',
    slapCreateLegend: 'New SLA policy',
    slapCreateCode: 'Policy code',
    slapCreateCodeHint:
      '3 to 64 characters of upper-case letters, digits and hyphens, e.g. SLA-DSR-ACCESS. ' +
      'It is quoted in governance documents, so it does not change when the duration does.',
    slapCreateName: 'Policy name',
    slapCreateProcess: 'Process',
    slapCreateWorkflowState: 'Workflow state (leave empty for the whole process)',
    slapCreateDescription: 'Description',
    slapCreateDuration: 'Duration',
    slapCreateUnit: 'Unit',
    slapCreateCalendar: 'Calendar',
    slapCreateSourceType: 'Where this SLA comes from',
    // The Arabic half of this key carries the derivation and the reason there is no
    // `ENUM_LABEL.SlaSourceType` family yet. Read it before adding one.
    slapUnitMinutes: 'Minutes',
    slapUnitHours: 'Hours',
    slapUnitBusinessDays: 'Business days',
    slapUnitCalendarDays: 'Calendar days',
    slapUnitMonths: 'Months',
    slapSourceInternalPolicy: 'Internal policy',
    slapSourceContractual: 'Contractual',
    slapSourceOperational: 'Operational',
    slapSourceOther: 'Other',
    slapSourceRegulatory: 'Regulatory',
    slapRegulatoryCanAct: 'create this policy',
    slapRegulatoryCannotAct: 'record it as required by regulation',
    slapCreateRegulatoryWarning:
      'Recording this as a legal requirement means naming the instrument that imposes it. The reference and the document are both required.',
    slapCreateSourceReference: 'Reference',
    slapCreateSourceDocument: 'Document',
    slapCreateSourceSection: 'Section',
    slapCreateBornDraft:
      'A new policy is created as a DRAFT. Activation is its own recorded decision, so the duration does not apply until then.',
    slapCreateSave: 'Save the policy',
    slapCreateCancel: 'Cancel',
    slapCreateFailed: 'Could not create the policy.',
    slap247: '24/7',
    slapCustom: 'Custom',
    slapJordanWorkingDays: 'Jordan working days',
    slapSave: 'Save',
    slapDeactivate: 'Deactivate',
    slapActivate: 'Activate',
    slapReadOnly: 'Read only',
    slapDurationAria: 'Duration for {name}',
    shRefusalAct: 'view the screening health report',
    shCouldNotLoadScreeningHealth: 'Could not load screening health — try again.',
    shListHealth: 'the screening provider status',
    shListOverview: 'the last 30 days of screening figures',
    shCapSanctions: 'Sanctions',
    shCapPep: 'Politically exposed persons (PEP)',
    shCapWatchlist: 'Watchlists',
    shCapAdverseMedia: 'Adverse media',
    shCapIndividual: 'Individual screening',
    shCapEntity: 'Entity screening',
    shCapBatch: 'Batch screening',
    shCapOngoingMonitoring: 'Ongoing monitoring',
    shCapWebhooks: 'Webhooks',
    /*
     * THE TWENTY-SEVEN CAPABILITY NOTES — the sentence under each capability name, which until
     * this batch was English prose the api sent and this screen rendered verbatim. An Arabic
     * compliance officer read an English token with an English sentence under it, on the screen
     * whose job is to say whether customers are actually being screened.
     *
     * `hardcoded-ui-english.py` reported 0 and was right to: it reads the WEB tree and these
     * strings did not exist here. That is the structural class the thirteen risk-questionnaire
     * prompts already recorded by name, met for the SECOND time.
     *
     * The api now names a `CapabilityNoteKey` and the web resolves it, so the FOUR keys that
     * interpolate carry their parameter rather than their sentence.
     *
     * EVERY ENGLISH VALUE BELOW IS THE API'S OWN FORMER STRING, verbatim — asserted against
     * `git show HEAD` by the edit that moved them. What changed is WHERE the sentence lives, not
     * what it says, so no English was written on this path.
     */
    shNoteBuiltInSanctionsSynced: 'OFAC SDN + UN Consolidated, synced locally.',
    shNoteBuiltInCacheEmpty: 'Configured, but the local cache is empty — the sync has never completed.',
    shNoteBuiltInNoPepData: 'This provider has NO PEP data. PEP screening requires a commercial provider or an on-premise dataset that includes PEP data.',
    shNoteBuiltInSanctionsOnly: 'Only sanctions lists are synced.',
    shNoteBuiltInAdverseMediaUnavailable: 'Not available.',
    shNoteBuiltInIndividualNames: 'Names are matched.',
    shNoteBuiltInEntityLegalNames: 'Legal names are matched.',
    shNoteBuiltInBatchLocal: 'Batched locally; no external rate limit applies.',
    shNoteBuiltInMonitoringSchedule: 'The 4-hourly re-screening batch plus re-screening on list update.',
    shNoteBuiltInWebhooksNotApplicable: 'Not applicable to a local cache.',
    shNoteCommercialContractCoverage: 'Actual coverage depends on the contracted product — verify against the provider agreement before relying on it.',
    shNoteCommercialIndividual: 'Individual screening.',
    shNoteCommercialEntity: 'Entity screening.',
    shNoteCommercialBatchFanOut: 'Sequential fan-out; switch to a native batch endpoint if the provider has one.',
    shNoteCommercialMonitoringEnrolment: 'Requires provider-side monitoring enrolment, which is a contract decision — not enabled by this adapter alone.',
    shNoteCommercialWebhooksNotConfigured: 'Requires a verified callback endpoint and a shared secret; not configured.',
    shNoteOnPremiseDataset: 'Dataset "{name}".',
    shNoteOnPremisePepVerify: 'Depends on whether dataset "{name}" actually ingested PEP collections — verify against the engine dataset listing before relying on it.',
    shNoteOnPremisePepSanctionsOnly: 'Dataset "{name}" is scoped to sanctions; no PEP data is searched.',
    shNoteOnPremiseAdverseMediaUnavailable: 'Not provided by this engine.',
    shNoteOnPremisePersonSchema: 'Person schema.',
    shNoteOnPremiseOrganizationSchema: 'Organization schema.',
    shNoteOnPremiseBatchFanOut: 'Fanned out sequentially to respect the engine.',
    shNoteOnPremiseMonitoringScheduler: 'Via the re-screening scheduler, not a provider push.',
    shNoteOnPremiseWebhooksUnsupported: 'The engine does not push events.',
    shNoteNotConfigured: 'Not configured.',
    shNoteNotConfiguredMissing: 'Not configured — missing {list}.',
    shScreeningHealth: 'Screening health',
    shWhichProviderActuallyPerformsScreening:
      'Which provider actually performs screening, whether its data is current, and what it covers. NOT_CONFIGURED or UNAVAILABLE means screening did not happen — it is not a negative result.',
    shLoading: 'Loading…',
    shProvider: 'Provider',
    shStatus: 'Status',
    shState: 'State',
    shType: 'Type',
    shAuthentication: 'Authentication',
    shAccepted: 'Accepted',
    shRejected: 'Rejected',
    shNotApplicable: 'Not applicable',
    shName: 'Name',
    shCapabilities: 'Capabilities',
    shSupportedMeansTheAdapterImplements:
      '“Supported” means the adapter implements it; “Configured” means this deployment supplied what it needs; “Operational” means it works right now. Conflating the three is how a system claims coverage it does not have.',
    shCapability: 'Capability',
    shSupported: 'Supported',
    shConfigured: 'Configured',
    shOperational: 'Operational',
    shPepScreeningIsNotOperational:
      'PEP screening is NOT operational. No customer may be represented as clear of PEP status.',
    shDataset: 'Dataset',
    shVersion: 'Version',
    shLastUpdated: 'Last updated',
    shCheckedAt: 'Checked at',
    shMatchingRules: 'Matching rules',
    shTheseThresholdsAreConfigurableAnd:
      'These thresholds are configurable and represent the broker’s own risk appetite. They are not a regulatory rule.',
    shHigh: 'High',
    shReview: 'Review',
    shDiscardBelow: 'Ignore below',
    shSendIdentifiersToProvider: 'Send identifiers to provider',
    shYes: 'Yes',
    shNo: 'No',
    shAHealthCheckAnswersWhether:
      'A health check answers whether the provider is reachable. These numbers answer how many customers were actually screened.',
    shNoScreeningAttemptsRecordedIn: 'No screening attempts recorded in this window.',
    shTotal: 'Total',
    shDidNotProduceAUsable: 'Did not produce a usable answer',
    shTheseCustomersWereNotScreened:
      'These customers were NOT screened — and were not treated as clear. See the reasons below.',
    shMostRecentFailures: 'Most recent failures',
    shOutcome: 'Outcome',
    shProvider2: 'Provider',
    shReason: 'Reason',
    shHoldsAndCaseWorkload: 'Holds and case workload',
    shDecidableFilesCurrentlyHeld: 'Decidable files currently held',
    shPendingMatches: 'Pending matches',
    shCaseState: 'Case state',
    shCount: 'Count',
    shNoOpenCases: 'No open cases.',
    shSanctionsListGenerations: 'Sanctions list generations',
    shAScreeningReadsOnlyThe:
      'A screening reads only the PUBLISHED generation. One still downloading is invisible to it.',
    shNoGenerationExistsNoSync:
      'No generation exists — no sync has completed, and no customer can be treated as clear.',
    shSource: 'Source',
    shStatus2: 'Status',
    shRecords: 'Records',
    shAdded: 'Added',
    shRolledBack: 'Rolled back: ',
    shRecurringWork: 'Recurring work',
    shRecurringReScreen: 'Recurring re-screen',
    shUnknown: 'unknown',
    shListSync: 'List sync',
    shUnknown2: 'unknown',
    shLastSuccessfulSync: 'Last successful sync',
    shNever: 'never',
    shSyncHistory: 'Sync history',
    shNoSyncHasRunYet: 'No sync has run yet.',
    shSource2: 'Source',
    shStatus3: 'Status',
    shRecords2: 'Records',
  },
} as const;
