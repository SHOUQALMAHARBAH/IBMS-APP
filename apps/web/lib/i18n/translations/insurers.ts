// /insurers, /insurers/new, /insurers/[id] — the office's own insurer records.
//
// Wording note that matters more than usual here: an insurer row is two kinds of fact, and the
// copy has to keep them apart. COMPANY-level facts (name, structure, switchboard, website,
// address, lines written) are public knowledge and are what the cross-office directory shows.
// RELATIONSHIP-level facts (credit terms, rating, named contacts) are this office's own commercial
// terms and never cross an office boundary. The headings say so in both languages, because a
// person deciding what to type into a field is the last line of that boundary.
export const INSURERS = {
  AR: {
    // page.tsx — the list
    insListHeading: 'شركات التأمين',
    insListIntro:
      'شركات التأمين التي يتعامل معها مكتبك. يمكن تسجيل شركة من الدليل العام، أو شركة ' +
      'لا يعرفها أي دليل — كلتا الحالتين تمرّان من هنا.',
    insListNoPermission: 'لا تملك صلاحية insurer.read، لذا لا يوجد ما يمكن عرضه هنا.',
    insListLoadError: 'تعذر تحميل شركات التأمين.',
    insListEmpty: 'لم يسجّل مكتبك أي شركة تأمين بعد.',
    insListEmptyFiltered: 'لا توجد شركة تأمين مطابقة لهذا البحث.',
    insListLoading: 'جارٍ التحميل…',
    insSearchLabel: 'ابحث بالاسم',
    insSearchButton: 'ابحث',
    insFilterAll: 'الكل',
    insFilterActive: 'المتعامل معها',
    insFilterInactive: 'غير المتعامل معها',
    insRegisterButton: 'سجّل شركة تأمين',
    insLinesLabel: 'الخطوط التأمينية',
    insLinesNone: 'لم تُحدَّد خطوط بعد',
    insOfficeLocalBadge: 'مُسجَّلة محلياً',
    insOfficeLocalExplain:
      'سجّل مكتبك هذه الشركة بنفسه؛ فهي ليست في الدليل العام، واسمها يمكن لمكتبك تصحيحه.',
    insOfficeLineBadge: 'خط أضافه مكتبك',
    // The three company structures. Not in enums.ts because they had no UI until this screen —
    // and a `t()` call built by string concatenation would have hidden that from the compiler.
    insStructureConventional: 'تقليدي',
    insStructureTakaful: 'تكافلي',
    insStructureTakafulWindow: 'نافذة تكافلية',

    // new/page.tsx — registration
    insNewHeading: 'تسجيل شركة تأمين',
    insNewIntro:
      'اختر شركة من الدليل العام، أو سجّل شركة لا يعرفها أي دليل. المسار واحد فقط لكل تسجيل.',
    insNewPathLabel: 'مصدر هوية الشركة',
    insNewPathMaster: 'من الدليل العام',
    insNewPathLocal: 'شركة يعرفها مكتبي فقط',
    insNewMasterLabel: 'الشركة في الدليل',
    insNewMasterChoose: 'اختر شركة…',
    insNewMasterUnavailable:
      'الدليل العام غير متاح لك، لذا يبقى التسجيل المحلي هو المسار المتوفر.',
    insNewLegalNameLabel: 'الاسم القانوني (إنجليزي)',
    insNewLegalNameArLabel: 'الاسم القانوني (عربي)',
    insNewStructureLabel: 'هيكل الشركة',
    insNewStructureChoose: 'اختر هيكلاً…',
    insNewCompanyHeading: 'بيانات الشركة',
    insNewCompanyIntro:
      'معلومات عامة عن الشركة. هذه هي المجموعة الوحيدة التي يظهرها الدليل للمكاتب الأخرى.',
    insNewPhoneLabel: 'هاتف الشركة',
    insNewEmailLabel: 'بريد الشركة',
    insNewWebsiteLabel: 'الموقع الإلكتروني',
    insNewAddressLabel: 'عنوان المراسلات',
    insNewRelationshipHeading: 'شروط مكتبك وجهات الاتصال',
    insNewRelationshipIntro:
      'خاصة بمكتبك ولا تعبر حدود المكاتب أبداً: لا يظهر أي منها في الدليل.',
    insNewCreditTermsLabel: 'مدة السداد (أيام)',
    insNewRatingLabel: 'التصنيف المالي',
    insNewRfqContactLabel: 'جهة اتصال طلبات الأسعار',
    insNewRfqEmailLabel: 'بريد جهة اتصال طلبات الأسعار',
    insNewClaimsContactLabel: 'جهة اتصال المطالبات',
    insNewClaimsEmailLabel: 'بريد جهة اتصال المطالبات',
    insNewSubmitButton: 'سجّل',
    insNewSavingButton: 'جارٍ الحفظ…',
    insNewNoPermission: 'لا تملك صلاحية insurer.relationship.manage لتسجيل شركة تأمين.',
    insNewError: 'تعذر إكمال التسجيل.',

    // [id]/page.tsx — detail
    insDetailNotFound: 'تعذر العثور على شركة التأمين هذه.',
    insDetailCompanyHeading: 'بيانات الشركة',
    insDetailRelationshipHeading: 'شروط مكتبك وجهات الاتصال',
    insDetailRelationshipNote: 'لا يعبر أي من هذه الحقول حدود المكاتب.',
    insDetailStructureLabel: 'الهيكل',
    insDetailPhoneLabel: 'الهاتف',
    insDetailEmailLabel: 'البريد الإلكتروني',
    insDetailWebsiteLabel: 'الموقع',
    insDetailAddressLabel: 'عنوان المراسلات',
    insDetailCreditTermsLabel: 'مدة السداد',
    insDetailCreditTermsDays: '{days} يوماً',
    insDetailRatingLabel: 'التصنيف المالي',
    insDetailRfqContactLabel: 'جهة اتصال طلبات الأسعار',
    insDetailClaimsContactLabel: 'جهة اتصال المطالبات',
    insDetailUnderwriterLabel: 'جهة الاكتتاب',
    insDetailRegisteredLabel: 'تاريخ التسجيل',
    insDetailEmptyField: '—',

    // deactivation / reactivation
    insDeactivateButton: 'أوقف التعامل',
    insReactivateButton: 'أعد التعامل',
    insImpactHeading: 'ما سيتأثر',
    insImpactIntro:
      'لا يُلغى أي من هذه الالتزامات ولا يتوقف: إيقاف التعامل يمنع العمل الجديد فقط، ' +
      'ويُسجَّل مع هذه الأرقام كما هي الآن.',
    insImpactInForce: 'وثائق سارية',
    insImpactInIssuance: 'وثائق ما زالت الشركة مطالبة بإجراء فيها',
    insImpactRenewals: 'حالات تجديد مفتوحة',
    insImpactRfqs: 'طلبات أسعار لم تُجَب',
    insImpactInvoices: 'فواتير غير مسددة',
    insImpactLoading: 'جارٍ حساب الأثر…',
    insImpactError: 'تعذر حساب الأثر.',
    insDeactivateReasonLabel: 'السبب',
    insDeactivateReasonRequired: 'السبب مطلوب لإيقاف التعامل.',
    insDeactivateConfirmButton: 'أكّد إيقاف التعامل',
    insReactivateReasonLabel: 'السبب (اختياري)',
    insReactivateConfirmButton: 'أكّد إعادة التعامل',
    insStatusCancelButton: 'إلغاء',
    insStatusBusyButton: 'جارٍ التنفيذ…',
    insStatusError: 'تعذر تغيير حالة التعامل.',
    insDeactivatedNotice: 'أوقف مكتبك التعامل مع هذه الشركة.',

    // directory/page.tsx — the cross-office directory
    insDirHeading: 'دليل شركات التأمين',
    insDirIntro:
      'كل شركة سجّلها أي مكتب على المنصة، مدخل واحد لكل شركة. للعثور على من يكتب تغطية ' +
      'لا يكتبها أحد على قائمة مكتبك — ولا يذكر الدليل أبداً أي مكتب يتعامل مع أي شركة.',
    insDirBoundaryNote:
      'يُظهر الدليل بيانات الشركة العامة فقط: لا شروط سداد، ولا تصنيفاً، ولا جهات اتصال خاصة بمكتب، ' +
      'ولا أي إشارة إلى المكاتب الأخرى.',
    insDirNoPermission: 'لا تملك صلاحية insurer.directory.read، لذا لا يوجد ما يمكن عرضه هنا.',
    insDirLoadError: 'تعذر تحميل الدليل.',
    insDirSearchLabel: 'ابحث باسم الشركة',
    insDirLineLabel: 'الخط التأميني',
    insDirLineAny: 'أي خط',
    insDirSearchButton: 'ابحث',
    insDirEmpty: 'لا توجد شركة مطابقة.',
    insDirEmptyForLine: 'لم يسجّل أي مكتب شركة تكتب هذا الخط.',
    insDirLoading: 'جارٍ التحميل…',
    insDirTotal: '{count} شركة',
    insDirNoContact: 'لم تُسجَّل بيانات اتصال.',
    insDirUnknownLine:
      'رفض الدليل هذا الخط لأنه ليس في الفهرس المُدار. هذا ليس نتيجة فارغة: ' +
      'اختر خطاً من القائمة.',
  },
  EN: {
    // page.tsx — the list
    insListHeading: 'Insurers',
    insListIntro:
      "The insurance companies your office deals with. You can register one from the shared " +
      'catalogue, or one no catalogue has heard of — both paths run through here.',
    insListNoPermission:
      'You do not hold insurer.read, so there is nothing to show here.',
    insListLoadError: 'Could not load insurers.',
    insListEmpty: 'Your office has not registered an insurer yet.',
    insListEmptyFiltered: 'No insurer matches that search.',
    insListLoading: 'Loading…',
    insSearchLabel: 'Search by name',
    insSearchButton: 'Search',
    insFilterAll: 'All',
    insFilterActive: 'In play',
    insFilterInactive: 'Not dealt with',
    insRegisterButton: 'Register an insurer',
    insLinesLabel: 'Lines written',
    insLinesNone: 'No lines recorded yet',
    insOfficeLocalBadge: 'Registered locally',
    insOfficeLocalExplain:
      "Your office registered this company itself — it is in no shared catalogue, and its name is your office's to correct.",
    insOfficeLineBadge: 'Your office added this line',
    insStructureConventional: 'Conventional',
    insStructureTakaful: 'Takaful',
    insStructureTakafulWindow: 'Takaful window',

    // new/page.tsx — registration
    insNewHeading: 'Register an insurer',
    insNewIntro:
      'Pick a company from the shared catalogue, or register one no catalogue has heard of. One path per registration, never both.',
    insNewPathLabel: "Where the company's identity comes from",
    insNewPathMaster: 'The shared catalogue',
    insNewPathLocal: 'A company only my office knows',
    insNewMasterLabel: 'Company in the catalogue',
    insNewMasterChoose: 'Choose a company…',
    insNewMasterUnavailable:
      'The shared catalogue is not available to you, so local registration is the path you have.',
    insNewLegalNameLabel: 'Legal name (English)',
    insNewLegalNameArLabel: 'Legal name (Arabic)',
    insNewStructureLabel: 'Company structure',
    insNewStructureChoose: 'Choose a structure…',
    insNewCompanyHeading: 'Company details',
    insNewCompanyIntro:
      'Public facts about the company. This is the only group the cross-office directory shows.',
    insNewPhoneLabel: 'Company phone',
    insNewEmailLabel: 'Company email',
    insNewWebsiteLabel: 'Website',
    insNewAddressLabel: 'Correspondence address',
    insNewRelationshipHeading: "Your office's terms and contacts",
    insNewRelationshipIntro:
      'Yours alone, and it never crosses an office boundary: none of it appears in the directory.',
    insNewCreditTermsLabel: 'Credit terms (days)',
    insNewRatingLabel: 'Financial strength rating',
    insNewRfqContactLabel: 'RFQ contact',
    insNewRfqEmailLabel: 'RFQ contact email',
    insNewClaimsContactLabel: 'Claims contact',
    insNewClaimsEmailLabel: 'Claims contact email',
    insNewSubmitButton: 'Register',
    insNewSavingButton: 'Saving…',
    insNewNoPermission:
      'You do not hold insurer.relationship.manage, so you cannot register an insurer.',
    insNewError: 'Could not complete the registration.',

    // [id]/page.tsx — detail
    insDetailNotFound: 'Could not find that insurer.',
    insDetailCompanyHeading: 'Company details',
    insDetailRelationshipHeading: "Your office's terms and contacts",
    insDetailRelationshipNote: 'None of these fields crosses an office boundary.',
    insDetailStructureLabel: 'Structure',
    insDetailPhoneLabel: 'Phone',
    insDetailEmailLabel: 'Email',
    insDetailWebsiteLabel: 'Website',
    insDetailAddressLabel: 'Correspondence address',
    insDetailCreditTermsLabel: 'Credit terms',
    insDetailCreditTermsDays: '{days} days',
    insDetailRatingLabel: 'Financial strength',
    insDetailRfqContactLabel: 'RFQ contact',
    insDetailClaimsContactLabel: 'Claims contact',
    insDetailUnderwriterLabel: 'Underwriter contact',
    insDetailRegisteredLabel: 'Registered',
    insDetailEmptyField: '—',

    // deactivation / reactivation
    insDeactivateButton: 'Stop dealing with them',
    insReactivateButton: 'Put them back in play',
    insImpactHeading: 'What this affects',
    insImpactIntro:
      'None of these obligations is cancelled or stopped: stopping only prevents NEW business, and it is recorded with these counts as they stand now.',
    insImpactInForce: 'Policies in force',
    insImpactInIssuance: 'Policies the insurer still owes an action on',
    insImpactRenewals: 'Open renewal cases',
    insImpactRfqs: 'Unanswered RFQ submissions',
    insImpactInvoices: 'Unsettled invoices',
    insImpactLoading: 'Working out the impact…',
    insImpactError: 'Could not work out the impact.',
    insDeactivateReasonLabel: 'Reason',
    insDeactivateReasonRequired: 'A reason is required to stop dealing with an insurer.',
    insDeactivateConfirmButton: 'Confirm — stop dealing',
    insReactivateReasonLabel: 'Reason (optional)',
    insReactivateConfirmButton: 'Confirm — back in play',
    insStatusCancelButton: 'Cancel',
    insStatusBusyButton: 'Working…',
    insStatusError: 'Could not change the dealing status.',
    insDeactivatedNotice: 'Your office has stopped dealing with this company.',

    // directory/page.tsx — the cross-office directory
    insDirHeading: 'Insurer directory',
    insDirIntro:
      'Every company any office on the platform has registered, one entry per company. For finding who writes cover nobody on your panel writes — and it never says which offices deal with any of them.',
    insDirBoundaryNote:
      'The directory shows public company facts only: no credit terms, no rating, no office-specific contacts, and nothing at all about other offices.',
    insDirNoPermission:
      'You do not hold insurer.directory.read, so there is nothing to show here.',
    insDirLoadError: 'Could not load the directory.',
    insDirSearchLabel: 'Search by company name',
    insDirLineLabel: 'Insurance line',
    insDirLineAny: 'Any line',
    insDirSearchButton: 'Search',
    insDirEmpty: 'No company matches.',
    insDirEmptyForLine: 'No office has registered a company that writes this line.',
    insDirLoading: 'Loading…',
    insDirTotal: '{count} companies',
    insDirNoContact: 'No contact details recorded.',
    insDirUnknownLine:
      'The directory refused that line because it is not in the managed catalogue. This is NOT an empty result — pick a line from the list.',
  },
} as const;
