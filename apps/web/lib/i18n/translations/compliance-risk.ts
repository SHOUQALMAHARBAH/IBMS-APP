// Compliance & risk cluster — AML/CFT Transaction Monitoring (#48), Watchlist
// Sync (#49), Regulatory Compliance (#51), Operational & PI Risk (#53-54),
// Incident Management (#55), Internal Controls (#56), Internal Audit
// Findings (#57) and the Audit Trail (Part 5.1).
//
// The three screening/SLA screens in this cluster were already bilingual and
// live in compliance-screening.ts instead — their Arabic was moved rather
// than rewritten.
//
// Vocabulary fixed once and reused:
//   الالتزام            compliance
//   المخاطر             risk
//   التصعيد             escalation
//   الحادث              incident
//   الجهة المختصة       the competent authority
//   سجل التدقيق         audit trail / audit log
//   المسؤولية المهنية    professional indemnity
export const COMPLIANCE_RISK = {
  AR: {
    // ---- AML/CFT transaction monitoring (#48) ---------------------------
    tmHeading: 'مراقبة المعاملات لمكافحة غسل الأموال وتمويل الإرهاب',
    tmIntro:
      'تُرصد تلقائياً مدفوعات الأقساط الكبيرة غير المعتادة، وعمليات الإلغاء والاسترجاع المتكرّرة، ومصادر الدفع من أطراف ثالثة (مسح ليلي، أو شغّله الآن). ويمكن تصعيد النمط المرصود إلى نشاط مشبوه ثم إبلاغ الجهة المختصة به — ويبقى السجل هنا دليلاً في الحالتين.',
    tmCustomerIdOptionalLabel: 'العميل (اختياري)',
    tmCustomerIdLabel: 'العميل',
    /* Decision 49's declared fallback, for a `patternType` outside the five the
     * schema declares. A contiguous slice of `atEntityTypeUnlabelled` = «نوع السجل
     * كما هو مخزَّن», which reads correctly standing alone as a tooltip. */
    tmPatternUnlabelled: 'كما هو مخزَّن',
    tmPatternLabel: 'النمط',
    tmDetailLabel: 'التفاصيل',
    tmRunSweepButton: 'تشغيل مسح الكشف الآن',
    tmColCustomer: 'العميل',
    tmColStatus: 'الحالة',
    tmColEscalated: 'مُصعَّد',
    tmColReported: 'مُبلَّغ عنه',
    tmColDetected: 'تاريخ الرصد',
    tmColAction: 'الإجراء',
    tmEscalateButton: 'تصعيد',
    tmReportButton: 'إبلاغ الجهة المختصة',
    tmCloseButton: 'إغلاق',
    tmLogButton: 'تسجيل تنبيه',
    tmSavingButton: 'جارٍ الحفظ…',
    tmLoading: 'جارٍ التحميل…',
    tmNone: 'لا توجد تنبيهات مراقبة معاملات.',
    tmLoadError: 'تعذّر تحميل تنبيهات مراقبة المعاملات — حاول مرة أخرى.',
    tmSweepSummary:
      'تم فحص {scanned} حالة — أُنشئ {created} تنبيهًا، و{skipped} مرصودة أصلًا، وفشلت {failed}.',
    tmActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    tmRefusalAct: 'عرض تنبيهات مراقبة المعاملات',

    // ---- Watchlist sync (#49) --------------------------------------------
    wsHeading: 'مزامنة قوائم العقوبات',
    shMissingConfig:
      'إعدادات ناقصة: {missing}. الفحص الآلي غير مهيأ، ومراجعة الامتثال مطلوبة قبل متابعة سير العمل.',
    shScreeningAttempts: 'عمليات الفحص (آخر {days} يومًا)',
    shHoldsReleased: 'حالات رفع الإيقاف (آخر {days} يومًا)',
    wsRescreenSummary:
      'أُعيد فحص {screened} عميلًا نشطًا — {hits} منها بنتيجة مطابقة، وفشلت {failed}.',
    wsIntro:
      'تُزامَن قائمتان عامّتان مجانيتان للعقوبات (OFAC SDN وقائمة الأمم المتحدة الموحّدة) محلياً كل اثنتَي عشرة ساعة — وهي وتيرة التحديث الفعلية للقائمتين — ويُعاد فحص كل عميل نشط عليهما كل أربع ساعات. ويمكن تشغيل كليهما يدوياً من هنا.',
    wsSyncButton: 'مزامنة القوائم الآن',
    wsRunBatchButton: 'تشغيل دفعة الفحص الدوري الآن',
    wsColSource: 'المصدر',
    wsColStatus: 'الحالة',
    wsColRecords: 'السجلات',
    wsGenerationsHeading: 'إصدارات القوائم',
    wsGenerationsIntro:
      'كل تنزيل للقائمة يُحفظ كإصدار. الإصدار المنشور هو الذي يجري الفحص ' +
      'مقابله الآن.',
    wsGenerationsNone: 'لا توجد إصدارات بعد — لم تُنفَّذ أي مزامنة.',
    wsColVersion: 'الإصدار',
    wsColDownloaded: 'نُزّل في',
    wsColGenerationStatus: 'الحالة',
    wsRestore: 'استعادة هذا الإصدار',
    wsRestoreReason: 'سبب استعادة قائمة أقدم (١٠ أحرف على الأقل)',
    wsRestoreReasonHint:
      'استعادة إصدار أقدم تُضيّق ما يمكن أن يكتشفه الفحص. اذكر ما حدث للإصدار ' +
      'الأحدث — السبب يُسجَّل في سجل التدقيق ويُنسب إليك.',
    wsRestoreConfirm: 'تأكيد الاستعادة',
    wsCancel: 'إلغاء',
    wsRestoreError: 'تعذّرت استعادة هذا الإصدار.',
    wsGenerationsLoadError: 'تعذّر تحميل إصدارات القوائم — حاول مرة أخرى.',
    wsRestoreUnavailable:
      'لا يمكن الاستعادة إلا إلى إصدار سابق ما زالت سجلاته محفوظة.',
    wsRolledBackFrom: 'استُعيد — السبب المسجَّل:',
    wsGenerationsLoading: 'جارٍ تحميل الإصدارات…',
    wsColStarted: 'وقت البدء',
    wsColCompleted: 'وقت الانتهاء',
    wsLoading: 'جارٍ التحميل…',
    wsNone: 'لم تُنفَّذ أي مزامنة بعد.',
    wsLoadError: 'تعذّر تحميل حالة المزامنة — حاول مرة أخرى.',
    wsActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    wsRefusalAct: 'عرض حالة المزامنة',

    // ---- Regulatory compliance (#51) --------------------------------------
    rcHeading: 'الالتزام التنظيمي',
    rcIntro:
      'حالة ترخيص الوسيط لدى البنك المركزي الأردني — ويُحظر الاكتتاب الجديد تلقائياً فور انتهائه — إضافة إلى تقويم الالتزامات التنظيمية مع الجهة المسؤولة وتاريخ الاستحقاق وتتبّع إثبات التقديم.',
    rcLicenseHeading: 'ترخيص الوسيط',
    rcLicenseNumberLabel: 'رقم الترخيص',
    rcColStatus: 'الحالة',
    rcExpires: 'ينتهي في',
    rcScopeLabel: 'نطاق التفويض',
    rcIssuedAtLabel: 'تاريخ الإصدار',
    rcExpiresAtLabel: 'تاريخ الانتهاء',
    rcCalendarHeading: 'تقويم الالتزامات',
    rcObligationLabel: 'الالتزام',
    rcOwnerUserIdLabel: 'معرّف المستخدم المسؤول',
    rcDueDateLabel: 'تاريخ الاستحقاق',
    rcColDue: 'الاستحقاق',
    rcColEvidence: 'الإثبات',
    rcColAction: 'الإجراء',
    rcRecordSubmissionButton: 'تسجيل التقديم',
    rcEvidenceRefLabel: 'مرجع الإثبات',
    rcNoCalendarItems: 'لا توجد بنود في تقويم الالتزامات.',
    rcNoLicense: 'لا يوجد سجل ترخيص بعد.',
    rcNoLicenseBlocksBusiness:
      'لا يوجد لدى هذا المكتب أي مدة ترخيص مسجّلة — وإصدار أعمال جديدة محجوب. ممارسة النشاط دون ترخيص ساري سبب لعقوبة إدارية (تعليمات البنك المركزي الأردني رقم 9 لسنة 2026، المادة 21/أ/9). سجّل الترخيص وشهادته أدناه.',
    rcTermsHeading: 'مدد الترخيص',
    rcScopeHeading: 'نطاق الترخيص',
    providerOfficesHeading: 'مكاتب الوساطة على المنصّة',
    providerOfficesRefusalAct: 'يقرأ حالة مكاتب الوساطة على المنصّة',
    providerOfficesCrossOfficeNote:
      'تنبيه: هذه الشاشة تعبُر حدود المكاتب — وهي تُظهر مكاتب وساطة أخرى غير مكتبك. ولا تحتوي أي بيانات عملاء أو وثائق أو أقساط أو عمولات، ولا أي بيانات تخصّ شخصاً بعينه؛ وتاريخ آخر استخدام هو للمكتب لا لأي مستخدم.',
    providerOfficesLoading: 'جارٍ التحميل…',
    providerOfficesLoadError: 'تعذّر تحميل مكاتب المنصّة — حاول مرة أخرى.',
    providerOfficesEmpty:
      'لا تُرجِع المنصّة أي مكتب، وهذه ليست نتيجة طبيعية — راجع الاتصال بقاعدة البيانات قبل الاعتماد على هذه الشاشة.',
    providerOfficesColOffice: 'المكتب',
    providerOfficesColStatus: 'حالة المكتب',
    providerOfficesColLicence: 'رقم الترخيص',
    providerOfficesColExpiry: 'تاريخ الانتهاء',
    providerOfficesColStanding: 'الموقف',
    providerOfficesColBranches: 'الفروع المرخَّصة',
    providerOfficesColUsers: 'المستخدمون',
    providerOfficesColLastUsed: 'آخر استخدام للمكتب',
    providerOfficesNoLicence: 'لا ترخيص مسجَّل',
    providerOfficesMayNotIssue:
      'ممنوعٌ من الإصدار',
    providerOfficesMayNotIssueNote:
      'يوجدُ قرارٌ رقابيٌّ قائمٌ يَمنعُ هذا المكتبَ من إصدارِ أعمالٍ جديدة. تفاصيلُ القرارِ تبقى لدى المكتبِ نفسِه ولا تَظهرُ هنا.',
    providerOfficesNoTermOnRecord:
      'لا مدة ترخيص مسجَّلة — يُمنع العمل الجديد (م. 21/أ/9)',
    providerOfficesLapsed: 'منتهٍ — يُمنع العمل الجديد',
    providerOfficesInGoodStanding: 'ساري',
    providerOfficesBranchesValue: '{total} ({dormant} بلا أي عمل)',
    providerOfficesUsersValue: '{active} نشط من {total}',
    providerOfficesNeverUsed: 'لم يُستخدم بعد',
    providerOfficesColAdministrator: 'المسؤول الأول',
    providerOfficesHasAdministrator: 'له حساب',
    providerOfficesNoAccountYet: 'لا يوجد حساب — لا يستطيع أحد الدخول',
    providerOfficesInviteOpen: 'دعوة المسؤول الأول',
    providerOfficesInviteCancel: 'إلغاء الدعوة',
    providerOfficesInviteHeading: 'دعوة المسؤول الأول لهذه المنظمة',
    providerOfficesInviteEmailLabel: 'البريد الإلكتروني للعمل (يصبح هوية الدخول)',
    providerOfficesInviteNameLabel: 'الاسم الكامل كما يظهر على الحساب',
    providerOfficesInviteReasonLabel:
      'سبب منح هذه المنظمة مسؤولاً أول (١٠ أحرف على الأقل)',
    providerOfficesInviteSubmit: 'إرسال الدعوة',
    providerOfficesInviteSending: 'جارٍ الإرسال…',
    providerOfficesInviteReasonTooShort:
      'السبب يحتاج ١٠ أحرف على الأقل — يُسجَّل في سجل التدقيق ويجعل هذا الإنشاء قابلاً للمساءلة.',
    providerOfficesInviteNoPasswordNote:
      'لا يُنشئ النظام كلمة مرور ولا يولّدها ولا يحفظها ولا يعرضها على أحد في أي مرحلة. يدخل المسؤول المدعو بطلب إعادة تعيين كلمة المرور على بريده.',
    providerOfficesInviteChannelNote:
      'تُرسل الدعوة من صندوق بريد المزوّد نفسه، لأن المنظمة الجديدة لا تملك صندوقاً ولا تستطيع ربطه قبل أن يدخلها أحد. وإن لم يكن بريد المزوّد مربوطاً فسيُنشأ الحساب ولن تُرسل الدعوة، وسيقول لك النظام ذلك صراحةً. ولا يُستخدم أي عنوان مشترك بديلاً.',
    providerOfficesInviteNotLicensingNote:
      'هذه دعوة أول حساب يفتح المنظمة على المنصّة، وليست استيفاءً لأي شرط ترخيص. الحد الأدنى للكوادر المعتمدة — مدير الأعمال التأمينية والقائم بأعمال الوساطة — شرطٌ من البنك المركزي يُسجَّل على الموظفين، وهو شيء آخر.',
    providerOfficesInviteCompanyLimitNote:
      'تنبيه قبل دعوة شركة تأمين: سيستطيع هذا المسؤول الدخول وقراءة سجل شركته وحده، ولا شيء غير ذلك. لا صندوق طلبات تسعير ولا تسعير ولا إصدار — تلك هي البوابة، وهي مديول منفصل لم يُبنَ بعد. وجود حساب للشركة لا يعني أنها جاهزة للعمل.',
    providerOfficesInviteDone:
      'أُرسلت الدعوة. أُنشئ الحساب {email} بدور {roleName}، ويدخل بطلب إعادة تعيين كلمة المرور.',
    providerOfficesInviteFailed: 'لم تُرسل الدعوة',
    providerOfficesInviteNotSentHeading: 'أُنشئ الحساب ولم تُرسل الدعوة',
    providerOfficesInviteNotSentNoMailbox:
      'أُنشئ الحساب {email} بدور {roleName}، ولم تصل الدعوة إلى صاحبها: المزوّد لم يربط صندوق بريد، فلا يوجد عنوان تُرسل منه الرسالة. لا يستطيع أحد الدخول إلى هذه المنظمة حتى تُرسل الدعوة. اربط بريد المزوّد من الإعدادات ← تكامل البريد، ثم أعد الدعوة — تُصدر رابطاً جديداً ولا تُنشئ حساباً ثانياً.',
    providerOfficesInviteNotSentRejected:
      'أُنشئ الحساب {email} بدور {roleName}، ولم تصل الدعوة: صندوق بريد المزوّد مربوط ولكن المزوّد رفض بيانات الاعتماد. أعد الربط من الإعدادات ← تكامل البريد، ثم أعد الدعوة.',
    providerOfficesInviteNotSentFailed:
      'أُنشئ الحساب {email} بدور {roleName}، ولم تصل الدعوة: فشل الإرسال لدى المزوّد. أعد الدعوة — تُصدر رابطاً جديداً ولا تُنشئ حساباً ثانياً.',
    providerOfficesInviteDevLinkNote:
      'بريد الدعوة غير موصول على هذا الجهاز. هذا الرابط معروضٌ لأن الواجهة البرمجية مُشغَّلة بـ ENABLE_DEV_RESET_TOKEN للتطوير والاختبار فقط، ولا يظهر أبداً في بيئة الإنتاج. وهو رمزٌ لمرّة واحدة ينتهي بعد ساعتين، وليس كلمة مرور — من يفتحه يختار كلمة مروره بنفسه.',
    providerOfficesInviteDevLinkLabel: 'افتح رابط تعيين كلمة المرور',
    providerOfficesLicenceNotApplicable: 'لا ينطبق — ليست مكتب وساطة',
    rcStaffingHeading: 'الحد الأدنى للكوادر المعتمدة',
    rcStaffingRequired: 'العدد المطلوب:',
    rcStaffingCurrent: 'المسجَّل حالياً:',
    rcStaffingMetNote:
      'يستوفي هذا المكتب الحد الأدنى للكوادر المعتمدة لنطاق ترخيصه.',
    rcStaffingShortNote:
      'عدد الأشخاص الحاملين لموافقة سارية من البنك المركزي أقل من العدد الذي يتطلّبه نطاق الترخيص: شخص واحد لنوع تأمين واحد، وشخصان للنوعين. تُسجَّل الموافقة على سجل كل شخص. وإضافة النوع الثاني ستُرفَض حتى يُسجَّل شخصان.',
    rcScopeTypes: 'أنواع التأمين',
    rcScopeBranches: 'الفروع المرخّصة',
    rcScopeNoBranches:
      'لم تُسجّل أي فروع بعد. لا يُحدّد نوع التأمين إلا من فروعه.',
    rcScopeAddBranch: 'إضافة فرع',
    rcScopeBranchLabel: 'الفرع',
    rcScopeRemove: 'إزالة',
    rcScopeColBranch: 'الفرع',
    rcScopeColType: 'النوع',
    rcScopeSoleEstablishmentNote:
      'هذا المكتب مسجّل كمؤسسة فردية (شخص طبيعي)، ويجوز ترخيصه لنوع تأمين واحد فقط (المادة 3/أ). إضافة فرع من النوع الآخر سيُرفض.',
    rcScopeOneTypeBasisNote:
      'وتُطبَّق قاعدةُ النوع الواحد على كلِّ مكتب وساطة، مباشرةً كان أو إعادةَ تأمين، لأنّ هذا النظام لا يحمل نصّاً تنظيميّاً منفصلاً لوساطة إعادة التأمين — فإن كان هذا المكتب وسيطَ إعادة تأمين فهذا هو سندُ تطبيق المادة ٣/أ عليه، ومسألةُ شمولها لوسيط إعادة التأمين غيرُ محسومةٍ هنا.',
    rcCapitalHeading: 'رأس المال (المادة 4/أ)',
    rcCapitalCountingUnitUnverified:
      'وحدةُ عدِّ الفروع التي تُحدَّد بها شريحةُ المادة ٤/أ قيدُ التحقّق مع البنك المركزي. يُحسَب الرقم أدناه بعدِّ فروع كتالوجنا البالغة ٣٢ فرعاً، وقد يكون التصنيفُ الرقابيُّ المعتمَد أقصرَ من ذلك — فيتغيّر العدد وتتغيّر معه الشريحة. الرقمُ للاطّلاع ولا يُعتمَد عليه التزاماً مالياً حتى يصل التصنيفُ الرسمي.',
    rcCapitalRequired: 'رأس المال المطلوب',
    rcCapitalPaidUp: 'رأس المال المدفوع',
    rcCapitalUnrecordedWarning:
      'لم يُسجّل رأس مال لهذا المكتب، لذلك لا يمكن التحقّق من متطلّب المادة 4/أ. هذه ملاحظة للتحقّق ولا تمنع أي إجراء.',
    rcCapitalShortfallWarning:
      'رأس المال المدفوع أقل من متطلّب المادة 4/أ لعدد الفروع المرخّصة. هذه ملاحظة للتحقّق ولا تمنع أي إجراء — المرجع هو وثائق تسجيل المكتب.',
    rcCapitalMeets: 'رأس المال المدفوع يستوفي متطلّب المادة 4/أ لهذا النطاق.',
    rcRenewalDueBy: 'آخر موعد لتقديم طلب التجديد',
    rcExpiryNotEndOfYearWarning:
      'تاريخ الانتهاء المُدخل ليس 31 كانون الأول/ديسمبر. مدة الترخيص تنتهي في 31 كانون الأول (المادة 10/ب) — تحقّق من التاريخ كما هو مطبوع على الشهادة. لم يُرفض الإدخال.',
    rcExpiryNotThreeYearTermWarning:
      'تاريخ الانتهاء المُدخل لا يطابق مدة الثلاث سنوات التي تقتضيها المادة 10/ب: المدة ثلاث سنوات ميلادية تنتهي في 31 كانون الأول، ويُعتبر جزء السنة الميلادية لهذه الغاية سنة — فسنة الإصدار تُحتسب سنة كاملة. تحقّق من التاريخ كما هو مطبوع على الشهادة. لم يُرفض الإدخال.',
    rcValidPendingRenewalDecision:
      'انتهى تاريخ هذه المدة المطبوع، ويُعامَل الترخيص على أنه ما زال ساريًا لأن طلب التجديد قُدّم في موعده، إلى حين صدور قرار البنك المركزي. هذا قرار داخلي للمكتب ولا يستند إلى نص في تعليمات رقم (9) لسنة 2026.',
    rcRenewalFiledLate:
      'قُدّم طلب التجديد بعد الموعد المحدّد (المادة 11) — لن يستمر سريان الترخيص بعد تاريخ الانتهاء.',
    rcExpectedThreeYearExpiry: 'نهاية مدة الثلاث سنوات المتوقّعة',
    rcColRenewalFiled: 'تاريخ تقديم طلب التجديد',
    rcNotFiled: 'لم يُقدَّم',
    rcCurrentTerm: 'المدة الحالية',
    rcCertificateFileName: 'اسم ملف الشهادة',
    rcCertificateFileNameLabel: 'اسم ملف الشهادة',
    rcCertificateStorageRef: 'مرجع تخزين الشهادة',
    rcCertificateStorageRefLabel: 'مرجع تخزين الشهادة',
    rcRecordRenewalButton: 'تسجيل تقديم طلب التجديد',
    rcRenewalAlreadyFiled:
      'سُجِّل طلب التجديد لهذه المدة، ولا يمكن تغيير تاريخه.',
    rcRenewButton: 'تجديد الترخيص',
    rcCreateButton: 'إنشاء ترخيص',
    rcAddObligationButton: 'إضافة التزام',
    rcSavingButton: 'جارٍ الحفظ…',
    rcLoading: 'جارٍ التحميل…',
    rcLicenseLoadError: 'تعذّر تحميل ترخيص الوسيط — حاول مرة أخرى.',
    rcCalendarLoadError: 'تعذّر تحميل تقويم الالتزامات — حاول مرة أخرى.',
    rcStandingHeading:
      'حالةُ الترخيص',
    rcStandingNoTerm:
      'لا توجدُ مدّةُ ترخيصٍ مسجّلة',
    rcStandingActive:
      'ساري',
    rcStandingRenewalPending:
      'قيدَ التجديد',
    rcStandingExpired:
      'منتهي',
    rcStandingSuspended:
      'موقوف',
    rcStandingCancelled:
      'ملغى',
    rcStandingDerived:
      'هذه الحالةُ مُستنبَطةٌ من مدَدِ الترخيصِ المسجّلةِ ومن قراراتِ الجهةِ الرقابيةِ المدوَّنة، وليست محفوظةً كحقل. وهي نفسُ الحالةِ التي يَمنعُ النظامُ على أساسِها الأعمالَ الجديدة.',
    rcStandingMayNotPractise:
      'لا يجوزُ للمكتبِ مباشرةُ أعمالٍ جديدةٍ في هذه الحالة: إصدارُ وثيقةٍ جديدةٍ، أو تجديدُها، أو طلبُ عروضٍ من الشركات، أو إصدارُ توصيةٍ للعميل، أو ملحقٌ يزيدُ التغطية، أو إصدارُ شهادةِ تأمين. أمّا التحصيلُ والتوريدُ والمطالباتُ والإلغاءُ والتقاريرُ وأعمالُ الامتثالِ فتستمرُّ.',
    rcStandingDecisionRef:
      'رقمُ قرارِ الجهةِ الرقابية',
    rcStandingDeemedCancelled:
      'عُدَّ الترخيصُ ملغىً بحكمِ المادة ١٤/ج: مضى على الإيقافِ بناءً على طلبِ الوسيطِ أكثرُ من سنتين. لم يَصدُر بذلك قرارٌ من الجهةِ الرقابية، وهذا ما استنبطَه النظامُ من التواريخِ المسجّلة.',
    rcActionsHeading:
      'قراراتُ الجهةِ الرقابيةِ المدوَّنة',
    rcActionKind:
      'نوعُ القرار',
    rcActionKindSuspension:
      'إيقاف',
    rcActionKindCancellation:
      'إلغاء',
    rcActionKindReinstatement:
      'إعادةُ تفعيل',
    rcActionBasis:
      'سندُ القرار',
    rcActionBasisBrokerRequest:
      'بناءً على طلبِ المكتب',
    rcActionBasisSanction:
      'عقوبةٌ مفروضة',
    rcActionEffectiveFrom:
      'تاريخُ نفاذِ القرار',
    rcActionDecisionRef:
      'رقمُ القرار',
    rcActionSuspendedUntil:
      'ينتهي الإيقافُ في (إن كان محدَّدًا)',
    rcRecordActionButton:
      'تدوينُ القرار',
    rcActionReplacesMarker:
      'هنا يُدوَّنُ القرارُ كما وردَ في الكتاب: نوعُه وسندُه وتاريخُ نفاذِه ورقمُه. وقد حلَّ هذا محلَّ زرٍّ واحدٍ كان يُعلِّمُ الترخيصَ منتهيًا دونَ أن يَحفظَ شيئًا من ذلك، فكان الإيقافُ مدوَّنًا بلا ما يُستندُ إليه.',
    rcNoticeHeading:
      'تنبيهُ تجديدِ الترخيص',
    rcNoticeFirst:
      'بقي على انتهاءِ مدّةِ الترخيصِ خمسةٌ وأربعون يومًا، وهو الموعدُ الذي يَجبُ أن يُقدَّمَ فيه طلبُ التجديد (المادة ١١).',
    rcNoticeSecond:
      'بقي على انتهاءِ مدّةِ الترخيصِ ثلاثون يومًا.',
    rcNoticeContinuing:
      'مدّةُ الترخيصِ على وشكِ الانتهاء، وسيَظهرُ هذا التنبيهُ في كلِّ مرّةٍ حتى يَمضيَ التاريخ.',
    rcNoticeExpired:
      'مضى تاريخُ انتهاءِ مدّةِ الترخيص.',
    rcNoticeDays:
      'الأيّامُ المتبقّية',
    rcNoticeDaysSince:
      'الأيّامُ المنقضيةُ على الانتهاء',
    rcNoticeApplicationDueBy:
      'آخرُ موعدٍ لتقديمِ طلبِ التجديد (المادة ١١)',
    rcNoticeFiled:
      'طلبُ التجديدِ مدوَّنٌ لدينا. وهذا لا يَرفعُ المنعَ ولا يُوقِفُ التنبيه: تقديمُ الطلبِ ليس قرارًا، والذي يَرفعُ المنعَ هو تدوينُ مدّةِ الترخيصِ الجديدةِ مع شهادتِها.',
    rcNoticeNotFiled:
      'لا يوجدُ طلبُ تجديدٍ مدوَّنٌ لدينا.',
    rcNoticeNoSource:
      'موعدُ الخمسةِ والأربعين يومًا مأخوذٌ من المادة ١١. أمّا موعدُ الثلاثين يومًا فهو تنبيهٌ داخليٌّ إضافيٌّ لا يَستندُ إلى نصٍّ.',
    rcActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    rcRefusalAct: 'عرض شاشة الالتزام التنظيمي',
    rcCalendarRefusalAct: 'عرض تقويم الالتزام',
    rcDueDate: 'تاريخ الاستحقاق',
    rcOwnerUserId: 'معرّف المستخدم المالك',
    rcExpiresAt: 'تاريخ الانتهاء',
    rcIssuedAt: 'تاريخ الإصدار',
    rcScopeOfAuth: 'نطاق التفويض',
    rcLicenseNumber: 'رقم الترخيص',
    rcEvidenceRefAria: 'مرجع الإثبات لـ {name}',

    // ---- Operational & PI risk (#53-54) ------------------------------------
    opHeading: 'المخاطر التشغيلية ومخاطر المسؤولية المهنية',
    opIntro:
      'سجل مخاطر عام يغطي التعرّضات التشغيلية والسيبرانية والمالية والالتزامية والسمعية، إضافة إلى وثيقة المسؤولية المهنية الخاصة بالوسيط وأحداث المخاطر المتتبَّعة عليها — فالوسيط الذي لا يملك تغطية مسؤولية مهنية سارية يكون في حد ذاته مخالفاً لشروط الترخيص.',
    opRegisterHeading: 'سجل المخاطر',
    opRiskTypeLabel: 'نوع الخطر',
    opRiskDescriptionLabel: 'وصف الخطر',
    opEventDescriptionFieldLabel: 'الوصف',
    opPiExpiresFieldLabel: 'تنتهي في',
    opPiInsurerFieldLabel: 'شركة التأمين',
    opRiskDescriptionFieldLabel: 'الوصف',
    opColType: 'النوع',
    opColMitigation: 'إجراء التخفيف',
    opColStatus: 'الحالة',
    opColAction: 'الإجراء',
    opMitigationActionLabel: 'إجراء التخفيف',
    opSaveMitigationButton: 'حفظ إجراء التخفيف',
    opCloseButton: 'إغلاق',
    opPiHeading: 'وثيقة المسؤولية المهنية',
    opPiInsurerLabel: 'اسم شركة تأمين المسؤولية المهنية',
    opColInsurer: 'شركة التأمين',
    opPiCoverageLimitLabel: 'حد التغطية (دينار أردني)',
    opColCoverageLimit: 'حد التغطية',
    opPiExpiresAtLabel: 'تاريخ انتهاء المسؤولية المهنية',
    opExpires: 'ينتهي في',
    opClaimsHistoryLabel: 'ملخّص سجل المطالبات',
    opColClaimsHistory: 'سجل المطالبات',
    opSaveButton: 'حفظ',
    opEventsHeading: 'أحداث مخاطر المسؤولية المهنية',
    opEventPolicyIdLabel:
      'معرّف وثيقة المسؤولية المهنية (اختياري — الافتراضي هو الحالية)',
    opEventDescriptionLabel: 'وصف حدث مخاطر المسؤولية المهنية',
    opColSource: 'المصدر',
    // «يدوي» from `integrationMethodManual`, sliced not typed.
    opSourceManual: 'يدوي',
    opSourcePolicyCheckingDiscrepancy: 'اختلاف في تدقيق الوثيقة',
    opLogRiskButton: 'تسجيل خطر',
    opLogPiButton: 'تسجيل وثيقة مسؤولية مهنية',
    opLogEventButton: 'تسجيل حدث مخاطر',
    opSavingButton: 'جارٍ الحفظ…',
    opLoading: 'جارٍ التحميل…',
    opNoRisks: 'لا توجد مخاطر مسجّلة في السجل بعد.',
    opNoPiPolicy: 'لم تُسجَّل وثيقة مسؤولية مهنية بعد.',
    opNoEvents: 'لا توجد أحداث مخاطر مسجّلة بعد.',
    opRegisterLoadError: 'تعذّر تحميل سجل المخاطر — حاول مرة أخرى.',
    opPiLoadError: 'تعذّر تحميل سجل وثيقة المسؤولية المهنية — حاول مرة أخرى.',
    opEventsLoadError:
      'تعذّر تحميل أحداث مخاطر المسؤولية المهنية — حاول مرة أخرى.',
    opActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    opRefusalAct: 'عرض سجل المخاطر',
    opPiRefusalAct: 'عرض وثيقة المسؤولية المهنية',
    opMitigationRowAria: 'إجراء التخفيف',
    opClaimsHistoryRowAria: 'سجل المطالبات',
    opEventMitigationAria: 'إجراء التخفيف للحادث',

    // ---- Incident management (#55) -----------------------------------------
    incHeading: 'إدارة الحوادث',
    incIntro:
      'مُبلَّغ عنه ← جرى احتواؤه (بهدف أربع ساعات للحوادث الحرجة) ← جرى تقييم أثره ← مُصنَّف (ويستوجب التصنيف المادي اعتماد مسؤول حماية البيانات مع توقيع منفصل من الإدارة التنفيذية) ← جرى الإبلاغ ← جرى التعافي ← مغلق (وتحليل السبب الجذري إلزامي). وقد يستوجب الحادث الواحد الإبلاغ إلى أكثر من جهة رقابية.',
    incTitleLabel: 'عنوان الحادث',
    incTitleFieldLabel: 'العنوان',
    incDescriptionLabel: 'وصف الحادث',
    incColTitle: 'العنوان',
    incColSeverity: 'درجة الخطورة',
    incColStatus: 'الحالة',
    incColClassification: 'التصنيف',
    incColAction: 'الإجراء',
    /*
     * OWNER DECISION 56 — the two incident acts collect what they claim.
     *
     * EVERY ARABIC STRING BELOW IS A CONTIGUOUS SLICE of the owner's own approved
     * documents, verified by substring check rather than by eye:
     *
     *   PRIV-FRM-06 § III  «وصف أي إجراء احتواء فوري (كعزل نظام أو تعطيل حساب)»
     *   PRIV-FRM-06 § II   «الأنظمة / البيانات المتأثرة (وتصنيفها إن عُرف)»
     *                      «عدد أصحاب البيانات المتأثرين تقريباً (إن أمكن تقديره)»
     *   PRIV-FRM-06        «ثالثاً: …» · «رابعاً: التقييم الأولي» (the headings)
     *   PRIV-SOP-09 step 4 «… الحادث يمس بيانات شخصية، وتحديد فئات البيانات …»
     *
     * So nothing here is composed and decision 94 is not engaged. THE HINTS ARE HER
     * OWN EXAMPLES: `incContainDescHint` is the parenthetical from her form, which is
     * why this screen needs no invented placeholder.
     */
    incContainmentLogHeading: 'الإجراءات الفورية المتخذة',
    incContainDescLabel: 'وصف أي إجراء احتواء فوري',
    incContainDescHint: 'كعزل نظام أو تعطيل حساب',
    incImpactAssessmentHeading: 'التقييم الأولي',
    incTouchesPersonalDataLabel: 'الحادث يمس بيانات شخصية',
    incDataCategoriesLabel: 'فئات البيانات',
    incDataCategoriesHint: 'وتصنيفها إن عُرف',
    incSubjectsEstimateLabel: 'عدد أصحاب البيانات المتأثرين تقريباً',
    incSubjectsEstimateHint: 'إن أمكن تقديره',
    incContainButton: 'احتواء',
    incAssessButton: 'تقييم الأثر',
    incClassifyMaterialButton: 'تصنيف كمادي',
    incClassifyNonMaterialButton: 'تصنيف كغير مادي',
    incCoSignButton: 'توقيع مشترك (الإدارة العليا)',
    incNotifySeniorButton: 'إبلاغ الإدارة العليا',
    incNotifyRegulatorsButton: 'إبلاغ الجهات الرقابية',
    incNotifySubjectsButton: 'إبلاغ أصحاب البيانات المتأثرين',
    incRecoverButton: 'تسجيل التعافي',
    incCloseButton: 'إغلاق',
    incRootCauseLabel: 'تحليل السبب الجذري',
    incReportButton: 'الإبلاغ عن حادث',
    incSavingButton: 'جارٍ الحفظ…',
    incLoading: 'جارٍ التحميل…',
    incNone: 'لا توجد حوادث مسجّلة بعد.',
    incLoadError: 'تعذّر تحميل الحوادث — حاول مرة أخرى.',
    incActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    incRefusalAct: 'عرض الحوادث',
    incStatusReported: 'مُبلَّغ عنه',
    incStatusContained: 'جرى احتواؤه',
    incStatusImpactAssessed: 'جرى تقييم أثره',
    incStatusClassified: 'مُصنَّف',
    incStatusNotified: 'جرى الإبلاغ',
    incStatusRecovered: 'جرى التعافي',
    incStatusClosed: 'مغلق',
    incClassMaterial: 'مادي',
    incClassNonMaterial: 'غير مادي',
    incClassNotYetClassified: 'لم يُصنَّف بعد',
    incRoleDpo: 'مسؤول حماية البيانات',
    incRoleExec: 'الإدارة التنفيذية',
    incNotifyRoleAria: 'إشعار {role} بخصوص {id}',
    incRootCauseAria: 'تحليل السبب الجذري',

    // ---- Internal controls (#56) --------------------------------------------
    icHeading: 'الضوابط الداخلية — تدقيق الموافقة الذاتية',
    icIntro:
      'كل ثنائية «منفّذ/مدقّق» في المخطّط (الجزء A.5)، تُفحص مباشرةً بحثاً عن صف يكون فيه المنفّذ والمدقّق الشخص نفسه. وكل ثنائية مسنودة أصلاً بقيد في قاعدة البيانات يُفترض أن يجعل ذلك مستحيلاً — فالنتيجة النظيفة هي المتوقّع لا المفاجئ. ويُنفَّذ هذا الفحص تلقائياً كل ليلة أيضاً.',
    icViolationsHeading: 'مخالفات الموافقة الذاتية المكتشفة',
    /*
     * OWNER DECISION 54 — HERS VERBATIM, and the reasoning is part of the decision.
     *
     * `truncated` IS LOAD-BEARING. Reaching `INTERNAL_CONTROLS_SCAN_LIMIT` means that
     * pair's result is INCOMPLETE — there may be violations past the limit — so a row
     * reading *no violations* under a truncated scan is NOT clean. A reader who does not
     * read English was reading `(truncated)` as clean, which is the worst available
     * outcome for a self-approval report. The Arabic says WHY and HOW MANY, which the
     * English never did.
     *
     * THE 20000 IS TIED TO THE CONSTANT BY AN ASSERTION, NOT INTERPOLATED, and the
     * choice is deliberate: interpolating would render the figure through
     * `formatNumber`, which keeps digits WESTERN, and would therefore silently overrule
     * the owner's own «٢٠٠٠٠». Arabic-Indic numerals written INTO prose are this
     * dictionary's established convention — measured, 210 such characters across 14
     * files, `dsrExtendButton`'s «١٥ يوماً» among them — while `formatNumber`'s
     * Western digits are for figures rendered from DATA. So her bytes stand and
     * `screen-copy.test.ts` fails by name if the constant moves away from the string.
     */
    icTruncatedNote: '(نتيجة غير مكتملة — فُحِص أول ٢٠٠٠٠ سجل)',
    /* `dormant` carries BOTH halves on purpose — watched, AND not yet written to.
     * «غير مستعمل» alone would leave the reader asking why the pair is listed at
     * all, which is the question the flag exists to answer. */
    icDormantNote: '(مُراقَب ولم يُستعمَل بعد)',
    icColEntity: 'الكيان',
    icColPair: 'الثنائية',
    icColRecord: 'السجل',
    icColUser: 'المستخدم',
    icByPair: 'حسب الثنائية',
    icColRowsChecked: 'الصفوف المفحوصة',
    icColViolations: 'المخالفات',
    icColDbCheck: 'قيد قاعدة البيانات',
    icNoWriter: 'لا توجد شيفرة تطبيق تكتب في هذا النموذج بعد.',
    icNone: 'لم يُجرَ أي تدقيق بعد — شغّله لفحص كل ثنائية.',
    // Zero violations is the EXPECTED result, not an absence of data: every
    // pair is backed by a DB constraint. The copy has to read as a pass.
    icClean:
      'لم يُعثر على أي مخالفة موافقة ذاتية. جميع الثنائيات المفحوصة سليمة.',
    icRunButton: 'تشغيل التدقيق الآن',
    icRunningButton: 'جارٍ التشغيل…',
    icPairsScanned: 'الثنائيات المفحوصة',
    icLoading: 'جارٍ التحميل…',
    icRunError: 'تعذّر تشغيل التدقيق — حاول مرة أخرى.',
    // Part 4 step 6 — the self-approval report. «الاعتماد الذاتي» names what it is; the access row is
    // flagged «مراجعة صلاحيات نفسه» because "reviewed their own access" is the phrase that has to stand out,
    // not a generic warning glyph.
    icDeclaredHeading: 'اعتمادات ذاتية معلنة',
    icDeclaredIntro:
      'الحالات التي نفّذ فيها شخص واحد طرفي عملية تتطلب شخصين، في مكتب أعلن السماح بذلك. كل حالة مسجّلة بسببها وبالأدوار التي كان يحملها. أي مراجعة لصلاحيات الشخص نفسه تظهر في الأعلى ومُعلَّمة.',
    icDeclaredOfficeSegregated: 'هذا المكتب يفصل بين المهام.',
    icDeclaredOfficeCombined:
      'هذا المكتب أعلن السماح بتنفيذ الشخص نفسه لطرفي العملية.',
    icDeclaredOfficeDeclaredBy: 'أعلنه {who}.',
    icDeclaredOfficeNeverDeclared: 'لم يُعلَن هذا صراحةً — هو الوضع الافتراضي.',
    icDeclaredEmpty: 'لا توجد اعتمادات ذاتية معلنة.',
    icDeclaredColWhen: 'التاريخ',
    icDeclaredColWho: 'الشخص',
    icDeclaredColPair: 'العملية',
    icDeclaredColRoles: 'الأدوار التي تمنح الاعتماد',
    icDeclaredColReason: 'السبب المسجّل',
    icDeclaredAccessFlag: 'مراجعة صلاحيات نفسه —',
    icDeclaredHatAmbiguous: 'أكثر من دور يمنح الاعتماد',
    icDeclaredTruncated: 'تُعرض أحدث الحالات فقط.',
    icDeclaredLoadError:
      'تعذّر تحميل الاعتمادات الذاتية المعلنة. حاول مرة أخرى.',
    icRefusalAct: 'عرض تقرير الضوابط الداخلية',

    // ---- Internal audit findings (#57) ---------------------------------------
    iafHeading: 'ملاحظات التدقيق الداخلي',
    iafIntro:
      'تسجيل ملاحظات التدقيق، ومتابعة مسار المعالجة، والإغلاق عند الانتهاء. ولا يجوز إلا للالتزام تسجيل ملاحظة أو تعديل خطة معالجتها؛ ويجوز للالتزام أو لمدير الفرع/الدائرة إغلاقها.',
    iafAuditPeriodLabel: 'الفترة التدقيقية',
    iafAuditPeriodFieldLabel: 'فترة التدقيق',
    iafFindingLabel: 'الملاحظة',
    iafColFinding: 'الملاحظة',
    iafColRemediation: 'المعالجة',
    iafRemediationActionLabel: 'إجراء المعالجة',
    iafColStatus: 'الحالة',
    iafColAction: 'الإجراء',
    iafSaveRemediationButton: 'حفظ المعالجة',
    iafCloseButton: 'إغلاق',
    iafRecordButton: 'تسجيل ملاحظة',
    iafSavingButton: 'جارٍ الحفظ…',
    iafLoading: 'جارٍ التحميل…',
    iafNone: 'لا توجد ملاحظات تدقيق داخلي مسجّلة بعد.',
    iafLoadError: 'تعذّر تحميل ملاحظات التدقيق الداخلي — حاول مرة أخرى.',
    iafActionError: 'تعذّر تنفيذ الإجراء — حاول مرة أخرى.',
    iafRefusalAct: 'عرض ملاحظات التدقيق الداخلي',
    iafRemediationActionAria: 'إجراء المعالجة',

    // ---- Audit trail (Part 5.1) ----------------------------------------------
    atHeading: 'سجل التدقيق',
    atIntro:
      'العدسة القرائية فقط للمدقّق الخارجي (الجزء 5.1): السجلات، وتاريخ المستندات، وتاريخ انتقالات حالات سير العمل لفترة ارتباط محدّدة. والوصول نفسه محدّد زمنياً عبر إعدادات حساب كل مستخدم، لا من هنا.',
    atColOccurred: 'وقت الحدوث',
    atColAction: 'الإجراء',
    atColEntity: 'الكيان',
    atColUser: 'المستخدم',
    atActorLabel: 'الشخص الذي نفّذ الإجراء',
    atColSensitive: 'حسّاس',
    atNone: 'لا توجد قيود.',
    atAuditLogHeading: 'سجل التدقيق',
    atWorkflowHistoryHeading: 'تاريخ سير العمل',
    atDocumentHistoryHeading: 'تاريخ المستند',
    atColVersions: 'الإصدارات',
    atColVersion: 'الإصدار',
    atColFile: 'الملف',
    atColCategory: 'الفئة',
    atColClassification: 'التصنيف',
    atColUploadedBy: 'رفعه',
    atColCreated: 'تاريخ الإنشاء',
    atEntityTypeLabel: 'نوع الكيان',
    atEntityIdLabel: 'معرّف الكيان',
    atActionLabel: 'نوع العملية',
    atActionAny: 'كل العمليات',
    atFromLabel: 'من تاريخ',
    atToLabel: 'إلى تاريخ',
    atWorkflowEntityTypeLabel: 'نوع كيان سير العمل',
    // Owner decision 41 — the empty option on a select that used to be a free-text box. The eighteen
    // option words are NOT here: each one is the translation key of the heading of that entity's own
    // screen, resolved in `lib/audit-trail/workflow-entity-types.ts`, so the word a reader sees in this
    // list is the word at the top of the screen they came from.
    atWorkflowEntityTypeChoose: 'اختر نوع الكيان…',
    atEntityRef: '{type} رقم {ref}',
    atEntityTypeUnlabelled: 'نوع السجل كما هو مخزَّن',
    // The three workflow-entity words that had no label, owner decision of 2026-10-23.
    // DERIVED, never typed: each is sliced out of a string already rendering in the product —
    // «الفرص» from the corrected `/opportunities` NAV label (its `/ السوق` half belongs to the
    // combined screen), «الملحقات» from `policyRequestedExtensionsLabel`, «الفواتير» from
    // `caColInvoices`. Their own keys rather than pointers at those three, so an entity label is
    // not hostage to a table column's wording or a nav entry's second noun.
    //
    // THE DIVERGENCE THIS COMMENT ONCE REPORTED IS CLOSED — OWNER DECISION 42, same day. The policy
    // screen's `endorsementSectionHeading` said «التعديلات», a GENERAL word that would fit any
    // change anywhere; it now says «الملحقات», so the word in this dropdown and the word at the top
    // of the policy screen are one word. «ملحق» is the owner's own word in the ز.١ list.
    /* Owner decision 53 — SLICED out of `opSourcePolicyCheckingDiscrepancy`, never typed:
     * that string calls it a DISCREPANCY, which a policy-checking record may not have. */
    recordEntityPolicyChecking: 'تدقيق الوثيقة',
    workflowEntityOpportunity: 'الفرص',
    workflowEntityEndorsement: 'الملحقات',
    workflowEntityInvoice: 'الفواتير',
    atWorkflowEntityIdLabel: 'معرّف كيان سير العمل',
    atDocumentIdLabel: 'معرّف المستند',
    atLookUpButton: 'بحث',
    atBrowseButton: 'تصفح',
    atLoading: 'جارٍ التحميل…',
    atLogLoadError: 'تعذّر تصفّح سجل التدقيق — حاول مرة أخرى.',
    atWorkflowLoadError: 'تعذّر تحميل تاريخ سير العمل — حاول مرة أخرى.',
    atDocumentLoadError: 'تعذّر تحميل تاريخ المستند — حاول مرة أخرى.',
    atAuditLogRefusalAct: 'عرض سجل التدقيق',
    atWorkflowRefusalAct: 'عرض سجل سير العمل',
    atDocumentRefusalAct: 'عرض سجل المستندات',
  },
  EN: {
    tmHeading: 'AML/CFT transaction monitoring',
    tmIntro:
      'Unusually large premium payments, frequent cancellations/refunds, and third-party payment sources are flagged automatically (nightly sweep, or run it now). Escalate a flagged pattern to suspicious activity, then report it to the competent authority — the record stays here as evidence either way.',
    tmCustomerIdOptionalLabel: 'Customer (optional)',
    tmCustomerIdLabel: 'Customer',
    tmPatternUnlabelled: 'as stored',
    tmPatternLabel: 'Pattern',
    tmDetailLabel: 'Detail',
    tmRunSweepButton: 'Run detection sweep now',
    tmColCustomer: 'Customer',
    tmColStatus: 'Status',
    tmColEscalated: 'Escalated',
    tmColReported: 'Reported',
    tmColDetected: 'Detected',
    tmColAction: 'Action',
    tmEscalateButton: 'Escalate',
    tmReportButton: 'Report to authority',
    tmCloseButton: 'Close',
    tmLogButton: 'Log alert',
    tmSavingButton: 'Saving…',
    tmLoading: 'Loading…',
    tmNone: 'No transaction-monitoring alerts.',
    tmLoadError: 'Could not load transaction-monitoring alerts — try again.',
    tmSweepSummary:
      'Scanned {scanned} candidate(s) — created {created} alert(s), {skipped} already flagged, {failed} failed.',
    tmActionError: 'That action failed — try again.',
    tmRefusalAct: 'view the transaction monitoring alerts',

    wsHeading: 'Sanctions watchlist sync',
    shMissingConfig:
      'Missing configuration: {missing}. Automated screening provider is not configured. Compliance review is required before the applicable workflow can proceed.',
    shScreeningAttempts: 'Screening attempts (last {days} days)',
    shHoldsReleased: 'Holds released (last {days} days)',
    wsRescreenSummary:
      'Re-screened {screened} active customer(s) — {hits} produced a HIT, {failed} failed.',
    wsIntro:
      "Two free public sanctions lists (OFAC SDN, UN Consolidated) are synced locally every 12 hours — the lists' own real-world refresh cadence — and every ACTIVE customer is re-screened against them every 4 hours. Both can also be run on demand here.",
    wsSyncButton: 'Sync watchlists now',
    wsRunBatchButton: 'Run recurring screening batch now',
    wsColSource: 'Source',
    wsColStatus: 'Status',
    wsColRecords: 'Records',
    wsGenerationsHeading: 'List generations',
    wsGenerationsIntro:
      'Every download of a list is kept as a generation. The PUBLISHED one is what ' +
      'screening runs against right now.',
    wsGenerationsNone: 'No generations yet — no sync has run.',
    wsColVersion: 'Generation',
    wsColDownloaded: 'Downloaded',
    wsColGenerationStatus: 'Status',
    wsRestore: 'Restore this generation',
    wsRestoreReason: 'Reason for restoring an older list (min. 10 characters)',
    wsRestoreReasonHint:
      'Restoring an older generation narrows what screening can find. Say what was ' +
      'wrong with the newer one — the reason is written to the audit log and ' +
      'attributed to you.',
    wsRestoreConfirm: 'Confirm restore',
    wsCancel: 'Cancel',
    wsRestoreError: 'Could not restore that generation.',
    wsGenerationsLoadError: 'Could not load the list generations — try again.',
    wsRestoreUnavailable:
      'Only a superseded generation whose records are still held can be restored.',
    wsRolledBackFrom: 'Restored — recorded reason:',
    wsGenerationsLoading: 'Loading generations…',
    wsColStarted: 'Started',
    wsColCompleted: 'Completed',
    wsLoading: 'Loading…',
    wsNone: 'No sync has run yet.',
    wsLoadError: 'Could not load the sync status — try again.',
    wsActionError: 'That action failed — try again.',
    wsRefusalAct: 'view the watchlist sync status',

    rcHeading: 'Regulatory compliance',
    rcIntro:
      "The broker's own CBJ license status — new business is automatically blocked once it lapses — plus a calendar of regulatory obligations with owner, due date, and evidence-of-submission tracking.",
    rcLicenseHeading: 'Broker license',
    rcLicenseNumberLabel: 'License number',
    rcColStatus: 'Status',
    rcExpires: 'Expires',
    rcScopeLabel: 'Scope of authorization',
    rcIssuedAtLabel: 'Issued at',
    rcExpiresAtLabel: 'Expires at',
    rcCalendarHeading: 'Compliance calendar',
    rcObligationLabel: 'Obligation',
    rcOwnerUserIdLabel: 'Owner user ID',
    rcDueDateLabel: 'Due date',
    rcColDue: 'Due',
    rcColEvidence: 'Evidence',
    rcColAction: 'Action',
    rcRecordSubmissionButton: 'Record submission',
    rcEvidenceRefLabel: 'Evidence ref',
    rcNoCalendarItems: 'No compliance calendar items.',
    rcNoLicense: 'No broker license record exists yet.',
    rcNoLicenseBlocksBusiness:
      'This office holds no licence term on record — and new business issuance is blocked. Practising without a current licence is a ground for administrative sanction (CBJ Instructions No. 9 of 2026, art. 21/a/9). Record the licence and its certificate below.',
    rcTermsHeading: 'Licence terms',
    rcScopeHeading: 'Licence scope',
    providerOfficesHeading: 'Brokerage offices on the platform',
    providerOfficesRefusalAct:
      'read the state of brokerage offices on the platform',
    providerOfficesCrossOfficeNote:
      'This screen crosses office boundaries — it shows other brokerage offices, not only yours. It contains no customer, policy, premium or commission data and nothing about any individual person; the last-used date is the office’s, not any user’s.',
    providerOfficesLoading: 'Loading…',
    providerOfficesLoadError:
      'Could not load the platform offices — try again.',
    providerOfficesEmpty:
      'The platform returned no offices at all, which is not a normal result — check the database connection before relying on this screen.',
    providerOfficesColOffice: 'Office',
    providerOfficesColStatus: 'Office status',
    providerOfficesColLicence: 'Licence number',
    providerOfficesColExpiry: 'Expires',
    providerOfficesColStanding: 'Standing',
    providerOfficesColBranches: 'Licensed branches',
    providerOfficesColUsers: 'Users',
    providerOfficesColLastUsed: 'Office last used',
    providerOfficesNoLicence: 'no licence recorded',
    providerOfficesMayNotIssue:
      'May not issue',
    providerOfficesMayNotIssueNote:
      'A standing regulatory decision bars this office from issuing new business. The decision itself stays with the office and is not shown here.',
    providerOfficesNoTermOnRecord:
      'no licence term on record — new business blocked (art. 21/a/9)',
    providerOfficesLapsed: 'lapsed — new business blocked',
    providerOfficesInGoodStanding: 'in force',
    providerOfficesBranchesValue: '{total} ({dormant} with no business)',
    providerOfficesUsersValue: '{active} active of {total}',
    providerOfficesNeverUsed: 'never used',
    providerOfficesColAdministrator: 'First administrator',
    providerOfficesHasAdministrator: 'has an account',
    providerOfficesNoAccountYet: 'no account — nobody can sign in',
    providerOfficesInviteOpen: 'Invite the first administrator',
    providerOfficesInviteCancel: 'Cancel invitation',
    providerOfficesInviteHeading: 'Invite this organization its first administrator',
    providerOfficesInviteEmailLabel: 'Work email (becomes the sign-in identity)',
    providerOfficesInviteNameLabel: 'Full name, as it should appear on the account',
    providerOfficesInviteReasonLabel:
      'Why this organization is being given a first administrator (at least 10 characters)',
    providerOfficesInviteSubmit: 'Send the invitation',
    providerOfficesInviteSending: 'Sending…',
    providerOfficesInviteReasonTooShort:
      'The reason needs at least 10 characters — it is recorded on the audit row and is what makes this creation answerable rather than merely recorded.',
    providerOfficesInviteNoPasswordNote:
      'No password is created, generated, recorded or displayed anywhere, by anyone, at any point. The invited administrator signs in by requesting a password reset on their own email.',
    providerOfficesInviteChannelNote:
      'The invitation is sent from the provider own connected mailbox, because a new organization has none and cannot connect one before somebody is inside it. If no provider mailbox is connected the account is created and the invitation is NOT sent, and the system says so plainly. No shared or platform address is ever used instead.',
    providerOfficesInviteNotLicensingNote:
      'This invites the first account that OPENS the organization on this platform. It satisfies no licensing requirement: the minimum approved staff — the insurance-business manager and the broker-in-charge — is a Central Bank requirement recorded against employees, and is a different thing.',
    providerOfficesInviteCompanyLimitNote:
      'Before inviting an insurance company: this administrator will be able to sign in and read the company own record, and nothing more. No RFQ inbox, no pricing, no issuance — those are the gateway, which is a separate module and is not built. A company having an account does not make it operational.',
    providerOfficesInviteDone:
      'Invitation sent. The account {email} was created with the role {roleName}, and signs in by requesting a password reset.',
    providerOfficesInviteFailed: 'The invitation was not sent',
    providerOfficesInviteNotSentHeading: 'The account was created and the invitation was NOT sent',
    providerOfficesInviteNotSentNoMailbox:
      'The account {email} was created with the role {roleName}, and the invitation did not reach them: the provider has connected no mailbox, so there is no address to send from. Nobody can enter this organization until an invitation arrives. Connect the provider mailbox at Settings → Email integration, then re-invite — that issues a fresh link and creates no second account.',
    providerOfficesInviteNotSentRejected:
      'The account {email} was created with the role {roleName}, and the invitation did not arrive: a provider mailbox is connected but the provider rejected the credential. Reconnect it at Settings → Email integration, then re-invite.',
    providerOfficesInviteNotSentFailed:
      'The account {email} was created with the role {roleName}, and the invitation did not arrive: the mail provider failed the send. Re-invite — that issues a fresh link and creates no second account.',
    providerOfficesInviteDevLinkNote:
      'Invitation mail is not wired on this machine. This link is shown only because the api was started with ENABLE_DEV_RESET_TOKEN for development and testing, and it never appears in production. It is a one-time token that expires in two hours, not a password — whoever opens it chooses their own.',
    providerOfficesInviteDevLinkLabel: 'Open the set-password link',
    providerOfficesLicenceNotApplicable: 'not applicable — not a brokerage office',
    rcStaffingHeading: 'Minimum approved staff',
    rcStaffingRequired: 'Required:',
    rcStaffingCurrent: 'Currently recorded:',
    rcStaffingMetNote:
      'This office meets the minimum approved staff for its licence scope.',
    rcStaffingShortNote:
      'Fewer people hold a current CBJ approval than this licence scope requires: one approved person for one insurance type, two for both. The approval is recorded on each person’s own employee record. Adding the second type will be refused until two are on record.',
    rcScopeTypes: 'Insurance types',
    rcScopeBranches: 'Licensed branches',
    rcScopeNoBranches:
      'No branches recorded yet. An insurance type is only ever determined by its branches.',
    rcScopeAddBranch: 'Add branch',
    rcScopeBranchLabel: 'Branch',
    rcScopeRemove: 'Remove',
    rcScopeColBranch: 'Branch',
    rcScopeColType: 'Type',
    rcScopeSoleEstablishmentNote:
      'This office is registered as a sole establishment (natural person), which may be licensed for ONE insurance type only (art. 3/a). Adding a branch of the other type will be refused.',
    rcScopeOneTypeBasisNote:
      'The one-type rule is applied to every brokerage office, direct or reinsurance alike, because this product holds no separate regulatory text for reinsurance brokerage — so if this office is a reinsurance broker, that is the basis on which art. 3/a is being applied to it, and whether the article governs such a broker is not settled here.',
    rcCapitalHeading: 'Capital (art. 4/a)',
    rcCapitalCountingUnitUnverified:
      'The unit used to count branches for the art. 4/a slab is under verification with the Central Bank. The figure below counts the 32 lines of our own catalogue; the Bank may license against a shorter regulatory classification, which would change the count and with it the slab. Shown for information — do not rely on it as a financial obligation until the official classification arrives.',
    rcCapitalRequired: 'Required capital',
    rcCapitalPaidUp: 'Paid-up capital',
    rcCapitalUnrecordedWarning:
      'No paid-up capital is recorded for this office, so the art. 4/a requirement cannot be checked. This is a note to verify and blocks nothing.',
    rcCapitalShortfallWarning:
      'The recorded paid-up capital is below what art. 4/a requires for this number of licensed branches. This is a note to verify and blocks nothing — the authority is the office’s registration documents.',
    rcCapitalMeets:
      'The recorded paid-up capital meets the art. 4/a requirement for this scope.',
    rcRenewalDueBy: 'Renewal application due by',
    rcExpiryNotEndOfYearWarning:
      'The expiry you entered is not a 31 December. A licence term ends on 31 December (art. 10/b) — check it against the date printed on the certificate. The entry was not refused.',
    rcExpiryNotThreeYearTermWarning:
      'The expiry you entered does not match the three-year term art. 10/b requires: a term runs three calendar years ending 31 December, and part of a calendar year counts as a year — so the year of issue counts as a full first year. Check it against the date printed on the certificate. The entry was not refused.',
    rcValidPendingRenewalDecision:
      "This term's printed expiry has passed, and the licence is treated as still valid because the renewal application was filed on time, until the CBJ's decision issues. This is an internal decision and rests on no provision of Instructions No. 9 of 2026.",
    rcRenewalFiledLate:
      'The renewal application was filed after the deadline (art. 11) — the licence will not remain valid past its expiry.',
    rcExpectedThreeYearExpiry: 'Expected end of a three-year term',
    rcColRenewalFiled: 'Renewal filed',
    rcNotFiled: 'Not filed',
    rcCurrentTerm: 'Current term',
    rcCertificateFileName: 'Certificate file name',
    rcCertificateFileNameLabel: 'Certificate file name',
    rcCertificateStorageRef: 'Certificate storage reference',
    rcCertificateStorageRefLabel: 'Certificate storage reference',
    rcRecordRenewalButton: 'Record renewal application',
    rcRenewalAlreadyFiled:
      'A renewal application is already recorded for this term; its filing date cannot be changed.',
    rcRenewButton: 'Renew license',
    rcCreateButton: 'Create license',
    rcAddObligationButton: 'Add obligation',
    rcSavingButton: 'Saving…',
    rcLoading: 'Loading…',
    rcLicenseLoadError: 'Could not load the broker license — try again.',
    rcCalendarLoadError: 'Could not load the compliance calendar — try again.',
    rcStandingHeading:
      'Licence standing',
    rcStandingNoTerm:
      'No licence term on record',
    rcStandingActive:
      'Current',
    rcStandingRenewalPending:
      'Renewal pending',
    rcStandingExpired:
      'Expired',
    rcStandingSuspended:
      'Suspended',
    rcStandingCancelled:
      'Cancelled',
    rcStandingDerived:
      'This standing is derived from the recorded licence terms and any recorded regulator decision, not stored as a field. It is the same answer the system blocks new business on.',
    rcStandingMayNotPractise:
      'In this state the office may not place new business: issuing a policy, renewing one, requesting quotes from insurers, issuing a recommendation to the customer, an endorsement that increases cover, or issuing an insurance certificate. Collection and remittance, claims, cancellations, reporting and compliance work all continue.',
    rcStandingDecisionRef:
      'Regulator decision reference',
    rcStandingDeemedCancelled:
      'Deemed cancelled under art. 14/c: a suspension made at the office own request has stood for more than two years. No regulator decision says so — the system derived it from the recorded dates.',
    rcActionsHeading:
      'Recorded regulator decisions',
    rcActionKind:
      'Decision',
    rcActionKindSuspension:
      'Suspension',
    rcActionKindCancellation:
      'Cancellation',
    rcActionKindReinstatement:
      'Reinstatement',
    rcActionBasis:
      'Basis',
    rcActionBasisBrokerRequest:
      'At the office own request',
    rcActionBasisSanction:
      'Imposed as a sanction',
    rcActionEffectiveFrom:
      'Takes effect from',
    rcActionDecisionRef:
      'Decision reference',
    rcActionSuspendedUntil:
      'Suspension ends on (if it is dated)',
    rcRecordActionButton:
      'Record the decision',
    rcActionReplacesMarker:
      'Record the decision as the letter states it: its kind, its basis, the date it takes effect and its reference. This replaces a single button that marked the licence lapsed and stored none of that, so a suspension was recorded with nothing to cite.',
    rcNoticeHeading:
      'Licence renewal notice',
    rcNoticeFirst:
      'The licence term expires in 45 days, which is the day the renewal application falls due (art. 11).',
    rcNoticeSecond:
      'The licence term expires in 30 days.',
    rcNoticeContinuing:
      'The licence term is running out. This notice appears on every reading until the date passes.',
    rcNoticeExpired:
      'The licence term expiry date has passed.',
    rcNoticeDays:
      'Days remaining',
    rcNoticeDaysSince:
      'Days since expiry',
    rcNoticeApplicationDueBy:
      'Renewal application due by (art. 11)',
    rcNoticeFiled:
      'A renewal application is on record. It does NOT lift the block and it does not stop this notice: filing is not a decision, and what lifts the block is recording the new licence term together with its certificate.',
    rcNoticeNotFiled:
      'No renewal application is on record.',
    rcNoticeNoSource:
      'The 45-day point is art. 11s own deadline. The 30-day point is an additional internal reminder and rests on no provision.',
    rcActionError: 'That action failed — try again.',
    rcRefusalAct: 'view the regulatory compliance screen',
    rcCalendarRefusalAct: 'view the compliance calendar',
    rcDueDate: 'Due date',
    rcOwnerUserId: 'Owner user ID',
    rcExpiresAt: 'Expires at',
    rcIssuedAt: 'Issued at',
    rcScopeOfAuth: 'Scope of authorization',
    rcLicenseNumber: 'License number',
    rcEvidenceRefAria: 'Evidence reference for {name}',

    opHeading: 'Operational & Professional Indemnity Risk',
    opIntro:
      "A generic risk register across operational / cyber / financial / compliance / reputational exposures, plus the broker's own Professional Indemnity policy and the risk events tracked against it — a broker without valid PI cover is itself a licensing breach.",
    opRegisterHeading: 'Risk register',
    opRiskTypeLabel: 'Risk type',
    opRiskDescriptionLabel: 'Risk description',
    opEventDescriptionFieldLabel: 'Description',
    opPiExpiresFieldLabel: 'Expires',
    opPiInsurerFieldLabel: 'Insurer',
    opRiskDescriptionFieldLabel: 'Description',
    opColType: 'Type',
    opColMitigation: 'Mitigation',
    opColStatus: 'Status',
    opColAction: 'Action',
    opMitigationActionLabel: 'mitigation action',
    opSaveMitigationButton: 'Save mitigation',
    opCloseButton: 'Close',
    opPiHeading: 'Professional Indemnity policy',
    opPiInsurerLabel: 'PI insurer name',
    opColInsurer: 'Insurer',
    opPiCoverageLimitLabel: 'Coverage limit (JOD)',
    opColCoverageLimit: 'Coverage limit',
    opPiExpiresAtLabel: 'PI expires at',
    opExpires: 'Expires',
    opClaimsHistoryLabel: 'claims history summary',
    opColClaimsHistory: 'Claims history',
    opSaveButton: 'Save',
    opEventsHeading: 'PI risk events',
    opEventPolicyIdLabel:
      'PI policy id (optional — defaults to the current one)',
    opEventDescriptionLabel: 'PI risk event description',
    opColSource: 'Source',
    opSourceManual: 'Manual',
    opSourcePolicyCheckingDiscrepancy: 'Policy Checking discrepancy',
    opLogRiskButton: 'Log risk',
    opLogPiButton: 'Log PI policy',
    opLogEventButton: 'Log risk event',
    opSavingButton: 'Saving…',
    opLoading: 'Loading…',
    opNoRisks: 'No risks recorded in the register yet.',
    opNoPiPolicy: 'No Professional Indemnity policy recorded yet.',
    opNoEvents: 'No PI risk events recorded yet.',
    opRegisterLoadError: 'Could not load the risk register — try again.',
    opPiLoadError: 'Could not load the PI policy record — try again.',
    opEventsLoadError: 'Could not load PI risk events — try again.',
    opActionError: 'That action failed — try again.',
    opRefusalAct: 'view the operational risk register',
    opPiRefusalAct: 'view the professional indemnity policy',
    opMitigationRowAria: 'Mitigation',
    opClaimsHistoryRowAria: 'Claims history',
    opEventMitigationAria: 'Mitigation for this event',

    incHeading: 'Incident Management',
    incIntro:
      "Reported → Contained (4-hour target for critical) → Impact Assessed → Classified (Material needs a Data Protection Officer AND a separate Executive Management co-sign) → Notified → Recovered → Closed (root cause mandatory). One incident may trigger more than one regulator's notification obligation.",
    incTitleLabel: 'Incident title',
    incTitleFieldLabel: 'Title',
    incDescriptionLabel: 'Incident description',
    incColTitle: 'Title',
    incColSeverity: 'Severity',
    incColStatus: 'Status',
    incColClassification: 'Classification',
    incColAction: 'Action',
    incContainmentLogHeading: 'Immediate actions taken',
    incContainDescLabel: 'Describe the immediate containment action',
    incContainDescHint: 'such as isolating a system or disabling an account',
    incImpactAssessmentHeading: 'Initial assessment',
    incTouchesPersonalDataLabel: 'The incident touches personal data',
    incDataCategoriesLabel: 'Data categories',
    incDataCategoriesHint: 'and their classification if known',
    incSubjectsEstimateLabel: 'Approximate number of affected data subjects',
    incSubjectsEstimateHint: 'if it can be estimated',
    incContainButton: 'Contain',
    incAssessButton: 'Assess impact',
    incClassifyMaterialButton: 'Classify Material',
    incClassifyNonMaterialButton: 'Classify Non-Material',
    incCoSignButton: 'Co-sign (Senior Management)',
    incNotifySeniorButton: 'Notify Senior Management',
    incNotifyRegulatorsButton: 'Notify regulators',
    incNotifySubjectsButton: 'Notify affected subjects',
    incRecoverButton: 'Recover',
    incCloseButton: 'Close',
    incRootCauseLabel: 'root cause analysis',
    incReportButton: 'Report incident',
    incSavingButton: 'Saving…',
    incLoading: 'Loading…',
    incNone: 'No incidents recorded yet.',
    incLoadError: 'Could not load incidents — try again.',
    incActionError: 'That action failed — try again.',
    incRefusalAct: 'view and report incidents',
    incStatusReported: 'Reported',
    incStatusContained: 'Contained',
    incStatusImpactAssessed: 'Impact assessed',
    incStatusClassified: 'Classified',
    incStatusNotified: 'Notified',
    incStatusRecovered: 'Recovered',
    incStatusClosed: 'Closed',
    incClassMaterial: 'Material',
    incClassNonMaterial: 'Non-material',
    incClassNotYetClassified: 'Not yet classified',
    incRoleDpo: 'Data Protection Officer',
    incRoleExec: 'Executive Management',
    incNotifyRoleAria: 'Notify {role} for {id}',
    incRootCauseAria: 'Root cause analysis',

    icHeading: 'Internal controls — self-approval audit',
    icIntro:
      'Every maker/checker pair in the schema (Part A.5), scanned live for a row where the maker and checker resolve to the same person. Each pair is already backed by a database constraint that should make this impossible — a clean run is the expected outcome, not a surprise. This also runs automatically every night.',
    icViolationsHeading: 'Self-approval violations found',
    icTruncatedNote: '(incomplete result — only the first 20,000 records were scanned)',
    icDormantNote: '(watched, and not yet used)',
    icColEntity: 'Entity',
    icColPair: 'Pair',
    icColRecord: 'Record',
    icColUser: 'User',
    icByPair: 'By pair',
    icColRowsChecked: 'Rows checked',
    icColViolations: 'Violations',
    icColDbCheck: 'DB CHECK',
    icNoWriter: 'No application code writes to this model yet.',
    icNone: 'No audit has been run yet — run one to scan every pair.',
    icClean: 'No self-approval violations found. Every pair scanned is clean.',
    icRunButton: 'Run audit now',
    icRunningButton: 'Running…',
    icPairsScanned: 'Pairs scanned',
    icLoading: 'Loading…',
    // Part 4 step 6 — the self-approval report.
    icDeclaredHeading: 'Declared self-approvals',
    icDeclaredIntro:
      'Occasions where one person performed both halves of an operation that needs two, in an office that has declared this is allowed. Each one carries its reason and the roles the person was acting under. A review of somebody\u2019s own access appears at the top, flagged.',
    icDeclaredOfficeSegregated: 'This office separates duties.',
    icDeclaredOfficeCombined:
      'This office has declared that one person may perform both halves.',
    icDeclaredOfficeDeclaredBy: 'Declared by {who}.',
    icDeclaredOfficeNeverDeclared:
      'Nobody has declared this explicitly — it is the default.',
    icDeclaredEmpty: 'No declared self-approvals.',
    icDeclaredColWhen: 'When',
    icDeclaredColWho: 'Who',
    icDeclaredColPair: 'Operation',
    icDeclaredColRoles: 'Roles granting the approval',
    icDeclaredColReason: 'Recorded reason',
    icDeclaredAccessFlag: 'Reviewed their own access —',
    icDeclaredHatAmbiguous: 'more than one role grants this',
    icDeclaredTruncated: 'Showing the most recent only.',
    icDeclaredLoadError:
      'Could not load the declared self-approvals. Try again.',
    icRunError: 'Could not run the audit — try again.',
    icRefusalAct: 'view the internal controls report',

    iafHeading: 'Internal Audit Findings',
    iafIntro:
      'Record audit findings, track the remediation path, and close once resolved. Only Compliance may record a finding or update its remediation plan; Compliance or a Branch/Department Manager may close it.',
    iafAuditPeriodLabel: 'Audit period label',
    iafAuditPeriodFieldLabel: 'Audit period',
    iafFindingLabel: 'Finding',
    iafColFinding: 'Finding',
    iafColRemediation: 'Remediation',
    iafRemediationActionLabel: 'remediation action',
    iafColStatus: 'Status',
    iafColAction: 'Action',
    iafSaveRemediationButton: 'Save remediation',
    iafCloseButton: 'Close',
    iafRecordButton: 'Record finding',
    iafSavingButton: 'Saving…',
    iafLoading: 'Loading…',
    iafNone: 'No internal audit findings recorded yet.',
    iafLoadError: 'Could not load internal audit findings — try again.',
    iafActionError: 'That action failed — try again.',
    iafRefusalAct: 'view internal audit findings',
    iafRemediationActionAria: 'Remediation action',

    atHeading: 'Audit Trail',
    atIntro:
      "The External Auditor's read-only lens (Part 5.1): logs, document history, and workflow-state transition history for a defined engagement period. Access itself is time-boxed via each user's own account settings, not configured here.",
    atColOccurred: 'Occurred',
    atColAction: 'Action',
    atColEntity: 'Entity',
    atColUser: 'User',
    atActorLabel: 'Who did it',
    atColSensitive: 'Sensitive',
    atNone: 'No entries.',
    atAuditLogHeading: 'Audit log',
    atWorkflowHistoryHeading: 'Workflow history',
    atDocumentHistoryHeading: 'Document history',
    atColVersions: 'Versions',
    atColVersion: 'Version',
    atColFile: 'File',
    atColCategory: 'Category',
    atColClassification: 'Classification',
    atColUploadedBy: 'Uploaded by',
    atColCreated: 'Created',
    atEntityTypeLabel: 'Entity type',
    atEntityIdLabel: 'Entity id',
    atActionLabel: 'Action',
    atActionAny: 'Any action',
    atFromLabel: 'From',
    atToLabel: 'To',
    atWorkflowEntityTypeLabel: 'Workflow entity type',
    atWorkflowEntityTypeChoose: 'Choose a type…',
    atEntityRef: '{type} number {ref}',
    atEntityTypeUnlabelled: 'record type as stored',
    recordEntityPolicyChecking: 'Policy Checking',
    workflowEntityOpportunity: 'Opportunities',
    workflowEntityEndorsement: 'Endorsements',
    workflowEntityInvoice: 'Invoices',
    atWorkflowEntityIdLabel: 'Workflow entity id',
    atDocumentIdLabel: 'Document id',
    atLookUpButton: 'Look up',
    atBrowseButton: 'Browse',
    atLoading: 'Loading…',
    atLogLoadError: 'Could not browse the audit log — try again.',
    atWorkflowLoadError: 'Could not load workflow history — try again.',
    atDocumentLoadError: 'Could not load document history — try again.',
    atAuditLogRefusalAct: 'view the audit trail',
    atWorkflowRefusalAct: 'view the workflow history',
    atDocumentRefusalAct: 'view the document history',
  },
} as const;
