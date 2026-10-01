// /customers, /customers/[id], /customers/new, /customers/kyc-queue —
// Process 3-4, Customer Acquisition/Onboarding + KYC.
export const CUSTOMERS = {
  AR: {
    // /settings/customer-import — loading an office's legacy customer file.
    // The screening line is worded as WORK, never as an error: the row is imported and any match
    // goes to the sanctions review queue like any other.
    impHeading: 'استيراد العملاء',
    impIntro:
      'حمّل ملف عملائك الحالي كما هو. أنت من يحدد أي عمود في ملفك يحمل كل حقل، ' +
      'فلا حاجة لإعادة كتابة الملف. تُفحص كل صفحة مقابل قوائم الجزاءات أثناء الاستيراد.',
    impLoading: 'جارٍ التحميل…',
    impRefusalAct: 'استيراد ملف عملاء',
    impUploadLegend: 'الملف وربط الأعمدة',
    impFileLabel: 'ملف CSV',
    impMappingIntro:
      'اكتب اسم العمود في ملفك مقابل كل حقل. اترك الحقل فارغاً إن لم يكن في ملفك. ' +
      'الحقول المعلَّمة بنجمة مطلوبة.',
    impFieldLegalName: 'الاسم القانوني',
    impFieldCustomerType: 'نوع العميل (فرد / شركة)',
    impFieldRegistrationNumber: 'رقم التسجيل',
    impFieldNationality: 'الجنسية',
    impFieldContactEmail: 'البريد الإلكتروني',
    impFieldContactPhone: 'الهاتف',
    impFieldRegisteredAddress: 'العنوان المسجَّل',
    impMissingRequired: 'لم تُربط الحقول المطلوبة: {fields}.',
    impSubmit: 'استيراد',
    impImporting: 'جارٍ الاستيراد…',
    impFailed: 'تعذر استيراد الملف.',
    impResultHeading: 'نتيجة استيراد {fileName}',
    impResultCounts: 'استُورد {imported} من {total} صف، ورُفض {rejected}.',
    impScreeningClear: 'فُحص {screened} صف مقابل قوائم الجزاءات، ولم تظهر أي مطابقة محتملة.',
    impScreeningFlagged:
      'فُحص {screened} صف مقابل قوائم الجزاءات، وظهرت {flagged} مطابقة محتملة. ' +
      'الصفوف مستوردة، والمطابقات في قائمة مراجعة الجزاءات للفصل فيها.',
    impColLine: 'رقم السطر في ملفك',
    impColReason: 'السبب',
    customersHeading: "العملاء",
    customersProcessIntro:
      "العملية 3-4 — اكتساب العملاء والتهيئة (أفراد وشركات)، اعرف عميلك، والملكية النفعية.",
    customersOnboardButton: "+ تهيئة عميل جديد",
    customersSearchLabel: "بحث",
    customersViewProfileAria: "عرض الملف الشخصي — {name}",
    customersRefusalAct: 'البحث في العملاء وعرض قائمتهم',
    customersNoneMatch: "لا يوجد عملاء مطابقون لبحثك.",
    customersNoneYet: "لا يوجد عملاء بعد.",

    customerTypeIndividual: "فرد",
    customerTypeCorporate: "شركة",
    customerStatusPendingKyc: "بانتظار اعرف عميلك",
    customerStatusActive: "نشط",
    customerStatusSuspended: "موقوف",
    customerStatusClosed: "مغلق",
    customerStatusLabel: "الحالة: {status}",

    // customers/[id]/page.tsx — profile
    customerProfileBackButton: "→ كل العملاء",
    customerProfileNotFound:
      "تعذر العثور على هذا العميل — قد لا يكون موجوداً، أو لا تملك صلاحية الوصول إليه.",
    customerProfileTypeStatusLine: "{type} — الحالة: {status}",
    customerKycStageLine: 'ملف اعرف عميلك: {stage}',
    customerKycStageQueueLink: 'افتح قائمة اعرف عميلك',
    customerKycStageNone: 'لا يوجد ملف اعرف عميلك لهذا العميل بعد.',
    customerProfileFieldReveal: "كشف",
    customerConsentLabel: "موافقة التهيئة / اعرف عميلك",
    customerFieldNationalId: "الرقم الوطني",
    customerFieldContactPhone: "رقم الهاتف",
    customerFieldContactEmail: "البريد الإلكتروني",
    customerFieldRegistrationNumber: "رقم السجل",
    customerFieldRegisteredAddress: "العنوان المسجل",
    customerCorrectHeading: "تصحيح بيانات الاتصال",
    customerCorrectIntro:
      "صحّح رقم الهاتف أو البريد الإلكتروني أو العنوان المسجل. اترك أي حقل فارغاً " +
      "لتركه كما هو — الحقول تبدأ فارغة عن قصد، لأن المعروض على الشاشة مُقنَّع " +
      "وليس القيمة نفسها.",
    customerCorrectOpen: "تصحيح بيانات الاتصال",
    customerCorrectPhone: "رقم الهاتف الجديد",
    customerCorrectEmail: "البريد الإلكتروني الجديد",
    customerCorrectAddress: "العنوان المسجل الجديد",
    customerCorrectReason: "سبب التصحيح",
    customerCorrectReasonHint:
      "يُسجَّل السبب مع كل حقل مُصحَّح ويُنسب إليك. اذكر من أبلغ عن الخطأ وكيف " +
      "تحقّقت منه.",
    customerCorrectAnswersDsr: "رقم طلب صاحب البيانات (إن كان هذا التصحيح رداً على طلب)",
    customerCorrectAnswersDsrHint:
      "إن كان هذا التصحيح رداً على طلب تصحيح نظامي، أدخل رقم الطلب. لا يمكن إغلاق " +
      "طلب التصحيح قبل تسجيل تصحيح فعلي مرتبط به.",
    customerCorrectSubmit: "تسجيل التصحيح",
    customerCorrectCancel: "إلغاء",
    customerCorrectError: "تعذّر تسجيل التصحيح — حاول مرة أخرى.",
    customerCorrectRefusalAct: 'تصحيح بيانات الاتصال بالعميل',
    customerCorrectIdentifiersNote:
      "الاسم وتاريخ الميلاد والجنسية ورقم الهوية لا تُصحَّح من هنا: تغييرها يستوجب " +
      "إعادة الفحص مقابل قوائم العقوبات، وهذه الآلية لم تُبنَ بعد.",
    customerFieldNatureOfBusiness: "طبيعة النشاط",
    customerFieldLanguagePreference: "تفضيل اللغة",
    customerFieldGivenName: "الاسم الأول",
    customerFieldFatherName: "اسم الأب",
    customerFieldGrandfatherName: "اسم الجد",
    customerFieldFamilyName: "اسم العائلة",
    customerRevealJustificationLabel: "مبرر كشف {field} (البند 10.6، يُسجَّل)",
    customerRevealJustificationRequired:
      "يلزم إدخال مبرر مكتوب لكشف هذا الحقل.",
    customerRevealConfirmButton: "تأكيد الكشف",
    customerRevealError: "تعذر كشف هذا الحقل — حاول مرة أخرى.",

    customerUbosHeading: "المستفيدون الحقيقيون النهائيون",
    customerUbosNone: "لا يوجد مسجل.",
    customerUboPep: "شخص سياسي معرض للمخاطر",

    customerDocumentsHeading: "المستندات",
    customerDocumentsNone: "لا يوجد مرفق.",

    customerNeedsAssessmentHeading: "تقييم الاحتياجات",
    customerNeedsAssessmentIntro:
      "العملية 5 — استبيان مخاطر منظّم يقترح قائمة تغطية، تتم مراجعتها واعتمادها " +
      "قبل أن تغذي فرصة تجارية أو طلب عروض أسعار.",
    customerNeedsAssessmentStartButton: "بدء تقييم احتياجات",
    customerNeedsAssessmentRefusalAct: 'بدء تقييم احتياجات',

    customerRiskSurveyHeading: "مسح المخاطر",
    customerRiskSurveyIntro:
      "العملية 6 — مسح تفصيلي للأصول لكل موقع (المبنى / المعدات / المخزون / الربح " +
      "السنوي / الأسطول)، لاشتقاق مبلغ التأمين وفترة التعويض، مجمّعة عبر المواقع.",
    customerRiskSurveyOpenButton: "فتح مسح المخاطر",
    customerRiskSurveyRefusalAct: 'عرض ملفات المخاطر لهذا العميل',

    customerInsuranceProgramHeading: "برنامج التأمين",
    customerInsuranceProgramIntro:
      "العملية 7 — برنامج تأمين متعدد الخطوط يُبنى من قائمة تغطية معتمدة من تقييم " +
      "الاحتياجات ومبلغ التأمين المشتق من مسح المخاطر، ثم يُعتمد نهائياً ليغذي طلب عروض الأسعار.",
    customerInsuranceProgramOpenButton: "فتح برنامج التأمين",
    customerInsuranceProgramRefusalAct: 'عرض برامج التأمين لهذا العميل',

    customerCrossSellHeading: "البيع المتبادل",
    customerCrossSellIntro:
      "العملية 8 — فحص ليلي يقارن خطوط الوثائق السارية لهذا العميل بقائمة خطوط مرجعية " +
      "ويحدد الفجوات كفرص بيع متبادل للتحويل أو الرفض.",
    customerCrossSellOpenButton: "فتح فرص البيع المتبادل",
    customerCrossSellRefusalAct: 'عرض فرص البيع المتبادل لهذا العميل',

    customerUpSellHeading: "البيع الإضافي",
    customerUpSellIntro:
      "العملية 9 — مهمة ليلية تقارن مبلغ التأمين المصمم للممتلكات لهذا العميل بالقيمة " +
      "الحالية لأصوله الممسوحة وتقترح زيادة عند وجود فجوة جوهرية.",
    customerUpSellOpenButton: "فتح توصيات البيع الإضافي",
    customerUpSellRefusalAct: 'عرض توصيات البيع الإضافي لهذا العميل',

    customerCrmHeading: "إدارة علاقات العملاء",
    customerCrmIntro:
      "العملية 10 — تسجيل كل نقطة تواصل مع العميل ورؤية الجدول الزمني الشامل " +
      "(التفاعلات حالياً، إضافة إلى الوثائق والمطالبات والشكاوى عند توفر تلك الوحدات).",
    customerCrmOpenButton: "فتح الجدول الزمني للعلاقة",
    customerCrmRefusalAct: 'عرض السجل الكامل لهذا العميل',

    // CustomerOnboardingWizard.tsx
    customerWizardStepType: "نوع العميل",
    customerWizardStepProfile: "الملف الشخصي",
    customerWizardStepUbos: "المستفيدون الحقيقيون",
    customerWizardStepDocuments: "المستندات",
    customerWizardStepReview: "المراجعة والإرسال",
    customerWizardCreateError: "تعذر إنشاء العميل — حاول مرة أخرى.",
    customerWizardUboError: "تعذرت إضافة هذا المستفيد الحقيقي — حاول مرة أخرى.",
    customerWizardDocError: "تعذر إرفاق هذا المستند — حاول مرة أخرى.",
    customerWizardKycError: "تعذر إرسال ملف اعرف عميلك — حاول مرة أخرى.",
    customerWizardTypeQuestion: "هل هذا العميل فرد أم شركة؟",
    customerWizardProfileHeadingCorporate: "الملف الشخصي للشركة",
    customerWizardProfileHeadingIndividual: "الملف الشخصي للفرد",
    customerWizardFatherNameOptionalLabel: "اسم الأب (اختياري)",
    customerWizardGrandfatherNameOptionalLabel: "اسم الجد (اختياري)",
    customerWizardLegalNameLabel: "الاسم القانوني (المسجل)",
    customerWizardRegistrationNumberLabel: "رقم السجل التجاري",
    customerWizardTaxRegLabel: "الرقم الضريبي (اختياري)",
    customerWizardLanguageArabicOption: "العربية",
    customerWizardLanguageEnglishOption: "الإنجليزية",
    customerWizardCreatingButton: "جارٍ الإنشاء…",
    customerWizardCreateButton: "إنشاء العميل وبدء اعرف عميلك",
    customerWizardUbosIntroPrefix: "سجّل كل فرد له ملكية أو سيطرة جوهرية على",
    customerWizardUbosIntroSuffix: ".",
    customerWizardOwnershipPercentLabel: "نسبة الملكية %",
    customerWizardPepCheckboxLabel: "شخص سياسي معرض للمخاطر (PEP)",
    customerWizardAddOwnerButton: "إضافة مالك",
    customerWizardContinueButton: "متابعة",
    customerWizardDocumentsHeading: "المستندات الداعمة",
    customerWizardDocumentsIntroPrefix:
      "مستندات الطلب/العرض لملف اعرف عميلك الخاص بـ",
    customerWizardDocumentsIntroSuffix:
      "، لا يوجد تخزين لرفع الملفات بعد — سجّل مرجع المستند أو اسم الملف.",
    customerWizardFileNameLabel: "اسم الملف / المرجع",
    customerWizardStorageRefLabel: "مرجع التخزين",
    customerWizardClassificationLabel: "التصنيف",
    customerWizardClassificationConfidentialOption: "سري",
    customerWizardClassificationHighlyConfidentialOption:
      "سري للغاية (مثال: صورة الهوية)",
    customerWizardAttachDocumentButton: "إرفاق مستند",
    customerWizardReviewContactLine: "التواصل: {phone} / {email}",
    customerWizardReviewUbosLine: "عدد المستفيدين الحقيقيين المسجلين: {count}",
    customerWizardReviewDocumentsLine: "عدد المستندات المرفقة: {count}",
    customerWizardReviewSubmitIntro:
      "الإرسال يحيل ملف اعرف عميلك إلى الالتزام لفحص العقوبات/غسل الأموال " +
      'والاعتماد — يبقى العميل بحالة "بانتظار اعرف عميلك" حتى يُعتمد.',
    customerWizardSubmittingButton: "جارٍ الإرسال…",
    customerWizardSubmitButton: "إرسال للمراجعة من الالتزام",

    // customers/new/page.tsx
    customerNewHeading: "تهيئة عميل",
    customerNewIntro:
      "العملية 3-4 — معالج اعرف عميلك خطوة بخطوة: نوع العميل، الملف الشخصي، المستفيدون " +
      "الحقيقيون (للشركات)، المستندات الداعمة، ثم الإرسال إلى الالتزام للفحص والاعتماد.",
    customerNewRefusalAct: 'إضافة عميل',

    // KycQueue.tsx + customers/kyc-queue/page.tsx
    kycQueuePageHeading: "قائمة فحص اعرف عميلك",
    kycQueuePageIntro:
      "العملية 3-4 — تشغيل فحص العقوبات/غسل الأموال، وتوجيه النتائج " +
      "عالية المخاطر عبر العناية الواجبة المعززة، واعتماد أو رفض كل ملف اعرف عميلك. " +
      "الاعتماد يُفعّل العميل؛ ومبدأ الفصل بين المُعِد والمدقق يمنع موظف الالتزام الذي " +
      "سجّل الملف من اعتماده أيضاً.",
    kycQueueApproveCanAct: 'العمل على قائمة اعرف عميلك والاطلاع على ما ينتظره كل ملف',
    kycQueueApproveCannotAct: 'الموافقة على ملف أو رفضه',
    kycQueueRefusalAct: 'العمل على قائمة اعرف عميلك',
    kycQueueActionFailed: "تعذر تنفيذ الإجراء — حاول مرة أخرى.",
    kycQueueEmpty: "لا يوجد شيء في قائمة اعرف عميلك حالياً.",
    kycQueueColumnCustomer: "العميل",
    kycQueueHighRiskResult: "نتيجة فحص عالية المخاطر",
    kycQueueRunScreeningButton: "تشغيل الفحص",
    kycQueueEnterEddButton: "الدخول في العناية الواجبة المعززة",
    kycQueueApproveButton: "اعتماد",
    kycQueueRejectReasonPlaceholder: "سبب الرفض",
    kycQueueRejectButton: "رفض",
    // Part B §17 — the screening hold.
    kycHoldLoading: "جارٍ التحقق من حالة الفحص…",
    kycHoldNoHold: "لا يوجد تعليق على الفحص.",
    kycHoldReviewRequired: "يلزم قبول مكتوب قبل الاعتماد",
    kycHoldNoMatches: 'تمت المطابقة مقابل قائمة مُحمَّلة ولم تظهر أي مطابقة.',
    kycHoldBlocked: "الاعتماد ممنوع بسبب نتيجة الفحص",
    kycHoldReasonPlaceholder: "اذكر ما الذي يتم قبوله ولماذا",
    kycHoldReasonLabel: "قبول تعليق الفحص",
    kycHoldBlockedExplainer:
      "لا يمكن رفع هذا التعليق بأي سبب مكتوب. راجع المطابقة المؤكدة أولاً.",
    kycHoldPriorReleases: "حالات قبول سابقة",
    kycHoldConfigProblems: "إعدادات تعليق غير صالحة",
    kycStatusDraft: "مسودة",
    kycStatusSubmitted: "مُرسل",
    kycStatusScreening: "قيد الفحص",
    kycStatusEdd: "عناية واجبة معززة",
    kycStatusComplianceReview: "مراجعة الالتزام",
    kycStatusApproved: "معتمد",
    kycStatusRejected: "مرفوض",
    kycStatusPeriodicReviewDue: "مراجعة دورية مستحقة",
  },
  EN: {
    // /settings/customer-import — loading an office's legacy customer file.
    impHeading: 'Customer import',
    impIntro:
      'Upload your existing customer file as it is. You say which column in YOUR file carries ' +
      'each field, so the file does not have to be rewritten. Every row is screened against the ' +
      'sanctions lists as it is imported.',
    impLoading: 'Loading…',
    impRefusalAct: 'import a customer file',
    impUploadLegend: 'The file, and which column is which',
    impFileLabel: 'CSV file',
    impMappingIntro:
      'Name the column in your file for each field. Leave a field empty if your file does not ' +
      'carry it. Fields marked with an asterisk are required.',
    impFieldLegalName: 'Legal name',
    impFieldCustomerType: 'Customer type (individual / corporate)',
    impFieldRegistrationNumber: 'Registration number',
    impFieldNationality: 'Nationality',
    impFieldContactEmail: 'Email',
    impFieldContactPhone: 'Phone',
    impFieldRegisteredAddress: 'Registered address',
    impMissingRequired: 'No column named yet for: {fields}.',
    impSubmit: 'Import',
    impImporting: 'Importing…',
    impFailed: 'Could not import the file.',
    impResultHeading: 'Result of importing {fileName}',
    impResultCounts: 'Imported {imported} of {total} rows; {rejected} rejected.',
    impScreeningClear:
      'Screened {screened} rows against the sanctions lists, with no potential match.',
    impScreeningFlagged:
      'Screened {screened} rows against the sanctions lists, with {flagged} potential ' +
      'match(es). Those rows ARE imported; the matches are in the sanctions review queue to be ' +
      'decided.',
    impColLine: 'Line in your file',
    impColReason: 'Reason',
    customersHeading: "Customers",
    customersProcessIntro:
      "Process 3-4 — customer acquisition and onboarding (individual and corporate), KYC, and " +
      "beneficial ownership.",
    customersOnboardButton: "+ Onboard a new customer",
    customersSearchLabel: "Search",
    customersViewProfileAria: "View profile — {name}",
    customersRefusalAct: 'find and list customers',
    customersNoneMatch: "No customers match your search.",
    customersNoneYet: "No customers yet.",

    customerTypeIndividual: "Individual",
    customerTypeCorporate: "Corporate",
    customerStatusPendingKyc: "Pending KYC",
    customerStatusActive: "Active",
    customerStatusSuspended: "Suspended",
    customerStatusClosed: "Closed",
    customerStatusLabel: "Status: {status}",

    // customers/[id]/page.tsx — profile
    customerProfileBackButton: "← All customers",
    customerProfileNotFound:
      "This customer could not be found — it may not exist, or you may not have access to it.",
    customerProfileTypeStatusLine: "{type} — Status: {status}",
    customerKycStageLine: 'KYC file: {stage}',
    customerKycStageQueueLink: 'Open the KYC queue',
    customerKycStageNone: 'No KYC file has been opened for this customer yet.',
    customerProfileFieldReveal: "Reveal",
    customerConsentLabel: "Onboarding / KYC consent",
    customerFieldNationalId: "National ID",
    customerFieldContactPhone: "Contact phone",
    customerFieldContactEmail: "Contact email",
    customerFieldRegistrationNumber: "Registration number",
    customerFieldRegisteredAddress: "Registered address",
    customerCorrectHeading: "Correct contact details",
    customerCorrectIntro:
      "Correct the phone number, email address or registered address. Leave a field " +
      "blank to leave it unchanged — the fields start empty deliberately, because " +
      "what the page shows is masked rather than the value itself.",
    customerCorrectOpen: "Correct contact details",
    customerCorrectPhone: "New phone number",
    customerCorrectEmail: "New email address",
    customerCorrectAddress: "New registered address",
    customerCorrectReason: "Reason for the correction",
    customerCorrectReasonHint:
      "The reason is stored against every corrected field and attributed to you. Say " +
      "who reported the error and how you verified it.",
    customerCorrectAnswersDsr: "Data subject request reference (if this answers one)",
    customerCorrectAnswersDsrHint:
      "If this correction answers a statutory correction request, enter its " +
      "reference. A correction request cannot be closed until a correction has " +
      "actually been recorded against it.",
    customerCorrectSubmit: "Record the correction",
    customerCorrectCancel: "Cancel",
    customerCorrectError: "Could not record the correction — try again.",
    customerCorrectRefusalAct: "correct a customer's contact details",
    customerCorrectIdentifiersNote:
      "Name, date of birth, nationality and national ID are not corrected here: " +
      "changing one is a screening event against the sanctions lists, and that " +
      "mechanism is not built yet.",
    customerFieldNatureOfBusiness: "Nature of business",
    customerFieldLanguagePreference: "Language preference",
    customerFieldGivenName: "Given name",
    customerFieldFatherName: "Father's name",
    customerFieldGrandfatherName: "Grandfather's name",
    customerFieldFamilyName: "Family name",
    customerRevealJustificationLabel:
      "Justification for revealing {field} (Part 10.6, logged)",
    customerRevealJustificationRequired:
      "A written justification is required to reveal this field.",
    customerRevealConfirmButton: "Confirm reveal",
    customerRevealError: "Could not reveal this field — try again.",

    customerUbosHeading: "Ultimate Beneficial Owners",
    customerUbosNone: "None recorded.",
    customerUboPep: "PEP",

    customerDocumentsHeading: "Documents",
    customerDocumentsNone: "None attached.",

    customerNeedsAssessmentHeading: "Needs assessment",
    customerNeedsAssessmentIntro:
      "Process 5 — a structured risk questionnaire that recommends a coverage list, " +
      "reviewed and approved before it feeds an opportunity or RFQ.",
    customerNeedsAssessmentStartButton: "Start a needs assessment",
    customerNeedsAssessmentRefusalAct: 'start a needs assessment',

    customerRiskSurveyHeading: "Risk survey",
    customerRiskSurveyIntro:
      "Process 6 — the detailed asset survey per location (building / equipment / " +
      "stock / annual profit / fleet), deriving the Sum Insured and indemnity " +
      "period, consolidated across sites.",
    customerRiskSurveyOpenButton: "Open the risk survey",
    customerRiskSurveyRefusalAct: "view this customer's risk profiles",

    customerInsuranceProgramHeading: "Insurance program",
    customerInsuranceProgramIntro:
      "Process 7 — a multi-line Insurance Program assembled from an approved " +
      "needs assessment's coverage list and the risk survey's derived " +
      "Sum Insured, then finalized to feed an RFQ.",
    customerInsuranceProgramOpenButton: "Open the insurance program",
    customerInsuranceProgramRefusalAct: "view this customer's insurance programmes",

    customerCrossSellHeading: "Cross-sell",
    customerCrossSellIntro:
      "Process 8 — a nightly scan compares this customer's in-force " +
      "policy lines against a benchmark line list and flags the gaps as " +
      "cross-sell opportunities to convert or dismiss.",
    customerCrossSellOpenButton: "Open cross-sell opportunities",
    customerCrossSellRefusalAct: "view this customer's cross-sell opportunities",

    customerUpSellHeading: "Up-sell",
    customerUpSellIntro:
      "Process 9 — a nightly job compares this customer's designed " +
      "property Sum Insured against the current value of their surveyed " +
      "assets and proposes an increase where the gap is material.",
    customerUpSellOpenButton: "Open up-sell recommendations",
    customerUpSellRefusalAct: "view this customer's up-sell recommendations",

    customerCrmHeading: "Relationship (CRM)",
    customerCrmIntro:
      "Process 10 — log every customer touchpoint and see the 360° " +
      "timeline (interactions today, plus policies, claims and " +
      "complaints once those modules exist).",
    customerCrmOpenButton: "Open the relationship timeline",
    customerCrmRefusalAct: "view this customer's full history",

    // CustomerOnboardingWizard.tsx
    customerWizardStepType: "Customer type",
    customerWizardStepProfile: "Profile",
    customerWizardStepUbos: "Beneficial owners",
    customerWizardStepDocuments: "Documents",
    customerWizardStepReview: "Review & submit",
    customerWizardCreateError: "Could not create the customer — try again.",
    customerWizardUboError: "Could not add this beneficial owner — try again.",
    customerWizardDocError: "Could not attach this document — try again.",
    customerWizardKycError: "Could not submit this KYC file — try again.",
    customerWizardTypeQuestion: "Is this an individual or corporate customer?",
    customerWizardProfileHeadingCorporate: "Corporate profile",
    customerWizardProfileHeadingIndividual: "Individual profile",
    customerWizardFatherNameOptionalLabel: "Father's name (optional)",
    customerWizardGrandfatherNameOptionalLabel: "Grandfather's name (optional)",
    customerWizardLegalNameLabel: "Legal (registered) name",
    customerWizardRegistrationNumberLabel: "Commercial registration number",
    customerWizardTaxRegLabel: "Tax registration number (optional)",
    customerWizardLanguageArabicOption: "Arabic",
    customerWizardLanguageEnglishOption: "English",
    customerWizardCreatingButton: "Creating…",
    customerWizardCreateButton: "Create customer & start KYC",
    customerWizardUbosIntroPrefix:
      "Record every individual with significant ownership or control of",
    customerWizardUbosIntroSuffix: ".",
    customerWizardOwnershipPercentLabel: "Ownership %",
    customerWizardPepCheckboxLabel: "Politically Exposed Person (PEP)",
    customerWizardAddOwnerButton: "Add owner",
    customerWizardContinueButton: "Continue",
    customerWizardDocumentsHeading: "Supporting documents",
    customerWizardDocumentsIntroPrefix: "Application/proposal documents for",
    customerWizardDocumentsIntroSuffix:
      "'s KYC file. No file-upload storage exists yet — record the document reference/filename.",
    customerWizardFileNameLabel: "File name / reference",
    customerWizardStorageRefLabel: "Storage reference",
    customerWizardClassificationLabel: "Classification",
    customerWizardClassificationConfidentialOption: "Confidential",
    customerWizardClassificationHighlyConfidentialOption:
      "Highly confidential (e.g. ID scan)",
    customerWizardAttachDocumentButton: "Attach document",
    customerWizardReviewContactLine: "Contact: {phone} / {email}",
    customerWizardReviewUbosLine: "Beneficial owners recorded: {count}",
    customerWizardReviewDocumentsLine: "Documents attached: {count}",
    customerWizardReviewSubmitIntro:
      "Submitting hands this KYC file to Compliance for sanctions/AML screening and " +
      "approval — the Customer stays PENDING_KYC until it's approved.",
    customerWizardSubmittingButton: "Submitting…",
    customerWizardSubmitButton: "Submit for compliance review",

    // customers/new/page.tsx
    customerNewHeading: "Onboard a customer",
    customerNewIntro:
      "Process 3-4 — a step-by-step KYC wizard: customer type, profile, beneficial owners " +
      "(if corporate), supporting documents, then submission to Compliance for screening " +
      "and approval.",
    customerNewRefusalAct: 'add a customer',

    // KycQueue.tsx + customers/kyc-queue/page.tsx
    kycQueuePageHeading: "KYC compliance queue",
    kycQueuePageIntro:
      "Process 3-4 — run sanctions/AML screening, route high-risk results through " +
      "enhanced due diligence, and approve or reject each KYC file. Approving activates " +
      "the Customer; maker/checker prevents the capturing officer from also being the approver.",
    kycQueueApproveCanAct: 'work the KYC queue and see what each file is waiting for',
    kycQueueApproveCannotAct: 'approve or reject a file',
    kycQueueRefusalAct: 'work the KYC queue',
    kycQueueActionFailed: "Action failed — try again.",
    kycQueueEmpty: "Nothing in the KYC queue right now.",
    kycQueueColumnCustomer: "Customer",
    kycQueueHighRiskResult: "High-risk screening result",
    kycQueueRunScreeningButton: "Run screening",
    kycQueueEnterEddButton: "Enter enhanced due diligence",
    kycQueueApproveButton: "Approve",
    kycQueueRejectReasonPlaceholder: "Rejection reason",
    kycQueueRejectButton: "Reject",
    // Part B §17 — the screening hold.
    kycHoldLoading: "Checking screening status…",
    kycHoldNoHold: "No screening hold.",
    kycHoldReviewRequired: "A written acceptance is required before approval",
    kycHoldNoMatches: 'Checked against a populated list — no matches.',
    kycHoldBlocked: "Approval is blocked by the screening result",
    kycHoldReasonPlaceholder: "State what is being accepted, and why",
    kycHoldReasonLabel: "Accept the screening hold",
    kycHoldBlockedExplainer:
      "No written reason releases this hold. Work the confirmed match first.",
    kycHoldPriorReleases: "Previously accepted",
    kycHoldConfigProblems: "Invalid hold configuration",
    kycStatusDraft: "Draft",
    kycStatusSubmitted: "Submitted",
    kycStatusScreening: "Screening",
    kycStatusEdd: "Enhanced due diligence",
    kycStatusComplianceReview: "Compliance review",
    kycStatusApproved: "Approved",
    kycStatusRejected: "Rejected",
    kycStatusPeriodicReviewDue: "Periodic review due",
  },
} as const;
