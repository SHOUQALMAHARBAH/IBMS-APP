// /customers, /customers/[id], /customers/new, /customers/kyc-queue —
// Process 3-4, Customer Acquisition/Onboarding + KYC.
export const CUSTOMERS = {
  AR: {
    customersHeading: "العملاء",
    customersProcessIntro:
      "العملية 3-4 — اكتساب العملاء والتهيئة (أفراد وشركات)، اعرف عميلك، والملكية النفعية.",
    customersOnboardButton: "+ تهيئة عميل جديد",
    customersSearchLabel: "بحث",
    customersViewProfileAria: "عرض الملف الشخصي — {name}",
    customersNoPermission:
      "لا تملك صلاحية customer.360-view.read، لذا لا يوجد ما يمكن عرضه هنا.",
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
    customerProfileBackButton: "← كل العملاء",
    customerProfileNotFound:
      "تعذر العثور على هذا العميل — قد لا يكون موجوداً، أو لا تملك صلاحية الوصول إليه.",
    customerProfileTypeStatusLine: "{type} — الحالة: {status}",
    customerProfileFieldReveal: "كشف",
    customerConsentLabel: "موافقة التهيئة / اعرف عميلك",
    customerFieldNationalId: "الرقم الوطني",
    customerFieldContactPhone: "رقم الهاتف",
    customerFieldContactEmail: "البريد الإلكتروني",
    customerFieldRegistrationNumber: "رقم السجل",
    customerFieldRegisteredAddress: "العنوان المسجل",
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
    customerNeedsAssessmentNoPermission:
      "لا تملك صلاحية needs-assessment.create.",

    customerRiskSurveyHeading: "مسح المخاطر",
    customerRiskSurveyIntro:
      "العملية 6 — مسح تفصيلي للأصول لكل موقع (المبنى / المعدات / المخزون / الربح " +
      "السنوي / الأسطول)، لاشتقاق مبلغ التأمين وفترة التعويض، مجمّعة عبر المواقع.",
    customerRiskSurveyOpenButton: "فتح مسح المخاطر",
    customerRiskSurveyNoPermission: "لا تملك صلاحية risk-profile.read.",

    customerInsuranceProgramHeading: "برنامج التأمين",
    customerInsuranceProgramIntro:
      "العملية 7 — برنامج تأمين متعدد الخطوط يُبنى من قائمة تغطية معتمدة من تقييم " +
      "الاحتياجات ومبلغ التأمين المشتق من مسح المخاطر، ثم يُعتمد نهائياً ليغذي طلب عروض الأسعار.",
    customerInsuranceProgramOpenButton: "فتح برنامج التأمين",
    customerInsuranceProgramNoPermission: "لا تملك صلاحية program.read.",

    customerCrossSellHeading: "البيع المتبادل",
    customerCrossSellIntro:
      "العملية 8 — فحص ليلي يقارن خطوط الوثائق السارية لهذا العميل بقائمة خطوط مرجعية " +
      "ويحدد الفجوات كفرص بيع متبادل للتحويل أو الرفض.",
    customerCrossSellOpenButton: "فتح فرص البيع المتبادل",
    customerCrossSellNoPermission: "لا تملك صلاحية cross-sell.read.",

    customerUpSellHeading: "البيع الإضافي",
    customerUpSellIntro:
      "العملية 9 — مهمة ليلية تقارن مبلغ التأمين المصمم للممتلكات لهذا العميل بالقيمة " +
      "الحالية لأصوله الممسوحة وتقترح زيادة عند وجود فجوة جوهرية.",
    customerUpSellOpenButton: "فتح توصيات البيع الإضافي",
    customerUpSellNoPermission: "لا تملك صلاحية up-sell.read.",

    customerCrmHeading: "إدارة علاقات العملاء",
    customerCrmIntro:
      "العملية 10 — تسجيل كل نقطة تواصل مع العميل ورؤية الجدول الزمني الشامل " +
      "(التفاعلات حالياً، إضافة إلى الوثائق والمطالبات والشكاوى عند توفر تلك الوحدات).",
    customerCrmOpenButton: "فتح الجدول الزمني للعلاقة",
    customerCrmNoPermission: "لا تملك صلاحية customer.360-view.read.",

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
      "الإرسال يحيل ملف اعرف عميلك إلى الالتزام لفحص العقوبات/الأشخاص السياسيين/غسل الأموال " +
      'والاعتماد — يبقى العميل بحالة "بانتظار اعرف عميلك" حتى يُعتمد.',
    customerWizardSubmittingButton: "جارٍ الإرسال…",
    customerWizardSubmitButton: "إرسال للمراجعة من الالتزام",

    // customers/new/page.tsx
    customerNewHeading: "تهيئة عميل",
    customerNewIntro:
      "العملية 3-4 — معالج اعرف عميلك خطوة بخطوة: نوع العميل، الملف الشخصي، المستفيدون " +
      "الحقيقيون (للشركات)، المستندات الداعمة، ثم الإرسال إلى الالتزام للفحص والاعتماد.",
    customerNewNoPermission:
      "لا تملك صلاحية customer.create، لذا لا يوجد ما يمكن فعله هنا.",

    // KycQueue.tsx + customers/kyc-queue/page.tsx
    kycQueuePageHeading: "قائمة فحص اعرف عميلك",
    kycQueuePageIntro:
      "العملية 3-4 — تشغيل فحص العقوبات/الأشخاص السياسيين/غسل الأموال، وتوجيه النتائج " +
      "عالية المخاطر عبر العناية الواجبة المعززة، واعتماد أو رفض كل ملف اعرف عميلك. " +
      "الاعتماد يُفعّل العميل؛ ومبدأ الفصل بين المُعِد والمدقق يمنع موظف الالتزام الذي " +
      "سجّل الملف من اعتماده أيضاً.",
    kycQueueNoApprovePermission:
      "لا تملك صلاحية kyc.approve — هذه القائمة مخصصة للالتزام فقط.",
    kycQueueNoPermission:
      "لا تملك صلاحية kyc.approve أو kyc.capture، لذا لا يوجد ما يمكن عرضه هنا.",
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
    customersHeading: "Customers",
    customersProcessIntro:
      "Process 3-4 — customer acquisition and onboarding (individual and corporate), KYC, and " +
      "beneficial ownership.",
    customersOnboardButton: "+ Onboard a new customer",
    customersSearchLabel: "Search",
    customersViewProfileAria: "View profile — {name}",
    customersNoPermission:
      "You don't hold the customer.360-view.read permission, so there's nothing to show here.",
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
    customerProfileFieldReveal: "Reveal",
    customerConsentLabel: "Onboarding / KYC consent",
    customerFieldNationalId: "National ID",
    customerFieldContactPhone: "Contact phone",
    customerFieldContactEmail: "Contact email",
    customerFieldRegistrationNumber: "Registration number",
    customerFieldRegisteredAddress: "Registered address",
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
    customerNeedsAssessmentNoPermission:
      "You don't hold the needs-assessment.create permission.",

    customerRiskSurveyHeading: "Risk survey",
    customerRiskSurveyIntro:
      "Process 6 — the detailed asset survey per location (building / equipment / " +
      "stock / annual profit / fleet), deriving the Sum Insured and indemnity " +
      "period, consolidated across sites.",
    customerRiskSurveyOpenButton: "Open the risk survey",
    customerRiskSurveyNoPermission:
      "You don't hold the risk-profile.read permission.",

    customerInsuranceProgramHeading: "Insurance program",
    customerInsuranceProgramIntro:
      "Process 7 — a multi-line Insurance Program assembled from an approved " +
      "needs assessment's coverage list and the risk survey's derived " +
      "Sum Insured, then finalized to feed an RFQ.",
    customerInsuranceProgramOpenButton: "Open the insurance program",
    customerInsuranceProgramNoPermission:
      "You don't hold the program.read permission.",

    customerCrossSellHeading: "Cross-sell",
    customerCrossSellIntro:
      "Process 8 — a nightly scan compares this customer's in-force " +
      "policy lines against a benchmark line list and flags the gaps as " +
      "cross-sell opportunities to convert or dismiss.",
    customerCrossSellOpenButton: "Open cross-sell opportunities",
    customerCrossSellNoPermission:
      "You don't hold the cross-sell.read permission.",

    customerUpSellHeading: "Up-sell",
    customerUpSellIntro:
      "Process 9 — a nightly job compares this customer's designed " +
      "property Sum Insured against the current value of their surveyed " +
      "assets and proposes an increase where the gap is material.",
    customerUpSellOpenButton: "Open up-sell recommendations",
    customerUpSellNoPermission: "You don't hold the up-sell.read permission.",

    customerCrmHeading: "Relationship (CRM)",
    customerCrmIntro:
      "Process 10 — log every customer touchpoint and see the 360° " +
      "timeline (interactions today, plus policies, claims and " +
      "complaints once those modules exist).",
    customerCrmOpenButton: "Open the relationship timeline",
    customerCrmNoPermission:
      "You don't hold the customer.360-view.read permission.",

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
      "Submitting hands this KYC file to Compliance for sanctions/PEP/AML screening and " +
      "approval — the Customer stays PENDING_KYC until it's approved.",
    customerWizardSubmittingButton: "Submitting…",
    customerWizardSubmitButton: "Submit for compliance review",

    // customers/new/page.tsx
    customerNewHeading: "Onboard a customer",
    customerNewIntro:
      "Process 3-4 — a step-by-step KYC wizard: customer type, profile, beneficial owners " +
      "(if corporate), supporting documents, then submission to Compliance for screening " +
      "and approval.",
    customerNewNoPermission:
      "You don't hold the customer.create permission, so there's nothing to do here.",

    // KycQueue.tsx + customers/kyc-queue/page.tsx
    kycQueuePageHeading: "KYC compliance queue",
    kycQueuePageIntro:
      "Process 3-4 — run sanctions/PEP/AML screening, route high-risk results through " +
      "enhanced due diligence, and approve or reject each KYC file. Approving activates " +
      "the Customer; maker/checker prevents the capturing officer from also being the approver.",
    kycQueueNoApprovePermission:
      "You don't hold the kyc.approve permission — this queue is Compliance-only.",
    kycQueueNoPermission:
      "You don't hold the kyc.approve/kyc.capture permission, so there's nothing to show here.",
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
