// MODULE 0-ب — the platform operator's own screens.
//
// Its own dictionary, not an addition to `compliance-risk.ts`, because the provider's screens are
// about OTHER organizations: the office-state dashboard reads every office, and this one CREATES a
// tenant. Folding that wording in beside a brokerage's own compliance screens is how a reader stops
// noticing which they are looking at — the same reason `/provider-offices` is not a section on
// `/regulatory-compliance`.
//
// Vocabulary fixed once and reused:
//   مكتب الوساطة        brokerage office
//   التسجيل             registration
//   الشكل القانوني       legal form
//   رقم المنشأة الوطني   national establishment number
//   جهة الترخيص          licensing authority
//   الفروع التأمينية     the insurance branches (lines) a licence covers
//   رأس المال المدفوع    paid-up capital
//   المسؤولية المهنية    professional indemnity
//   الكفالة البنكية      the bank guarantee
export const PROVIDER = {
  AR: {
    regInsRefusalAct: 'تسجيل شركة تأمين على المنصّة',
    regInsHeading: 'تسجيل شركة تأمين',
    regInsIntro:
      'يُنشئ هذا النموذج شركةَ تأمينٍ على المنصّة. تُدخَل البيانات كما وردت في ترخيص الشركة وسجلّ المنشأة.',
    regInsTenantWarning:
      'التسجيل يُنشئ مستأجراً جديداً. لا يوجد في هذا النظام طريق لحذف شركة بعد تسجيلها، لأن سجلّ التدقيق لا يُحذف — فتحقّق من رقم المنشأة الوطني قبل الحفظ.',
    regInsSectionIdentity: 'التعريف الأساسي',
    regInsSectionLicence: 'الترخيص والنشاط',
    regInsSectionAddress: 'العنوان ووسائل الاتصال',
    regInsSectionIntegration: 'طريقة الربط',
    regInsSectionBanking: 'البيانات البنكية',
    regInsSectionPlatform: 'بيانات المنصّة',
    regInsCode: 'رمز الشركة',
    regInsShortName: 'الاسم المختصر',
    regInsLicenseNo: 'رقم الترخيص',
    regInsLicenseExpiry: 'تاريخُ انتهاءِ الترخيصِ كما هو مطبوعٌ على الشهادة',
    regInsLicenseIssued: 'تاريخُ إصدارِ الترخيص — إن كان مطبوعاً',
    regInsBusinessModel: 'نمط النشاط',
    regInsLicensedLines: 'فروع التأمين المرخَّص بها',
    regInsLicensedLinesHint:
      'هذه فروعُ الاكتتاب التي يُجيزها ترخيصُ الشركة. وهي ليست ما سجّله المكاتبُ من تعاملٍ معها — وهما حقيقتان مختلفتان ولا تُدمجان.',
    regInsQuotationEmail: 'بريد طلبات التسعير',
    regInsClaimsEmail: 'بريد المطالبات',
    regInsPublishedChannelsNote:
      'هذه قنواتٌ منشورةٌ للشركة. أمّا مسؤولُ علاقات الوسطاء وتصنيفُ الملاءة فيُسجّلهما كلُّ مكتبٍ عنده، لأنّ لكلِّ مكتبٍ جهةَ اتصالٍ مختلفةً داخل الشركة نفسها.',
    regInsIntegrationMethod: 'طريقة الربط',
    regInsApiEndpoint: 'عنوان الواجهة البرمجية',
    regInsApiEndpointHint:
      'مطلوبٌ إذا كانت طريقةُ الربط API، ولا يُدخَل مع غيرها.',
    regInsCertificateFileName: 'اسم ملف شهادة الترخيص',
    regInsCertificateStorageRef: 'موضع حفظ الشهادة',
    regInsSubmit: 'تسجيل الشركة',
    regInsSubmitting: 'جارٍ التسجيل…',
    regInsSuccessHeading: 'تمّ تسجيل الشركة',
    regInsSuccessLines: 'عدد الفروع المرخَّص بها: {count}',
    regInsSuccessCategories: 'أنواع التأمين المرخَّص بها: {types}',
    regInsRegisterAnother: 'تسجيل شركة أخرى',
    regOfficeSectionPack: 'وثائق التسجيل (المادة ١٠/أ)',
    regOfficePremisesTenureFileName: 'اسم ملف عقد الإيجار أو سند الملكية',
    regOfficePremisesTenureStorageRef: 'موضع حفظ عقد الإيجار أو سند الملكية',
    regOfficeAssociationFileName: 'اسم ملف إثبات الانتساب إلى الجمعية',
    regOfficeAssociationStorageRef: 'موضع حفظ إثبات الانتساب',
    regOfficeBrokerageKindNote:
      'يُسجَّل هذا الحقلُ ولا يترتّب عليه أثر: لا يقرأه أيُّ ضابطٍ في النظام، ولا نملك نصّاً تنظيمياً لوساطة إعادة التأمين — فاختيارُ «إعادة التأمين» لا يُعفي المكتبَ من شيء ولا يُلزمه بشيء، والضوابطُ القائمة تُطبَّق على المكتب بصفته مكتبَ وساطة.',
    regOfficePackNote:
      'المادة (١٠/أ/٢) تُوجب نسخةً عن عقد الإيجار أو سند الملكية للمقر، والمادة (١٠/أ/٣) تُوجب ما يُثبت الانتساب إلى الجمعية الأردنية لوسطاء التأمين، وتُكرّرها المادة (١٨/أ) في البيانات الدورية. وبالقرار ٨٨: غيابُهما لا يمنع الحفظ، ويُحسَب السجلُّ ناقصاً. وإثباتُ الانتساب يُحفَظ ضمن حزمة تسجيل المكتب بلا ربطٍ بشخصٍ بعد، لأنّ الأشخاص الذين تذكرهم المادة لا وجود لهم في النظام لحظةَ التسجيل.',
    regOfficePackHeading: 'اكتمال حزمة التسجيل',
    regOfficePackComplete:
      'حزمة التسجيل مكتملة: الوثيقتان مُسجَّلتان في النظام — اسمُ الملف وموضعُ حفظه ومَن سجّله.',
    regOfficePackMissingIntro: 'الناقص:',
    regOfficePackNotHeld: 'هذه الوثيقة غير محفوظة في النظام',
    regOfficePackPremisesTenure: 'عقد الإيجار أو سند الملكية',
    regOfficePackAssociation: 'إثبات الانتساب إلى الجمعية الأردنية لوسطاء التأمين',
    regOfficePackScope:
      'هذا بيانٌ عمّا يُسجّله النظام، لا حُكمٌ على المكتب. والمكتبُ المرخَّص من البنك المركزي قد قدّم هذه الوثائق إلى الجهة الرقابية بالفعل، فغيابُ سجلٍّ عندنا نقصٌ في سجلّنا نحن. والنظامُ لا يحفظ الملفات نفسها؛ ما يُحفَظ سجلٌّ بالوثيقة — اسمُها وموضعُ حفظها ومَن سجّلها — فـ«مُسجَّلة» تعني مُثبَتةً ومنسوبةً إلى مَن سجّلها، لا أنّ الملفَّ قابلٌ للاسترجاع من هنا.',
    regOfficeRefusalAct: 'تسجيل مكتب وساطة على المنصّة',
    regOfficeHeading: 'تسجيل مكتب وساطة',
    regOfficeIntro:
      'يُنشئ هذا النموذج مكتب وساطة جديداً على المنصّة: سجلّاته منفصلة تماماً عن كلّ مكتب آخر، ولا يصل إليها أحد خارجه. تُدخَل البيانات كما وردت في شهادة الترخيص وسجلّ المنشأة.',
    regOfficeTenantWarning:
      'التسجيل يُنشئ مستأجراً جديداً. لا يوجد في هذا النظام طريق لحذف مكتب بعد تسجيله، لأن سجلّ التدقيق لا يُحذف — فتحقّق من رقم المنشأة الوطني قبل الحفظ.',

    // ---- the dictionary's own groups -----------------------------------
    regOfficeSectionIdentity: 'التعريف الأساسي',
    regOfficeSectionLicence: 'الترخيص',
    regOfficeSectionAddress: 'العنوان ووسائل الاتصال',
    regOfficeSectionPeople: 'الأشخاص الرئيسيون',
    regOfficeSectionGuarantees: 'الضمانات التنظيمية',
    regOfficeSectionBanking: 'البيانات البنكية',
    regOfficeSectionPlatform: 'بيانات المنصّة',

    regOfficeCode: 'رمز المكتب',
    regOfficeLegalNameAr: 'الاسم القانوني (عربي)',
    regOfficeLegalNameEn: 'الاسم القانوني (إنجليزي)',
    regOfficeTradeName: 'الاسم التجاري (اختياري)',
    regOfficeLegalForm: 'الشكل القانوني',
    regOfficeNationalEstablishmentNo: 'رقم المنشأة الوطني',
    regOfficeCrNo: 'رقم السجل التجاري',
    regOfficeCrDate: 'تاريخ التسجيل (اختياري)',
    regOfficeTaxNo: 'الرقم الضريبي',

    regOfficeBrokerageKind: 'نوع الترخيص',
    regOfficeBrokerKind: 'صفة الوسيط',
    regOfficeLicenseNo: 'رقم الترخيص',
    regOfficeLicensingAuthority: 'جهة الترخيص',
    regOfficeLicenseIssuedAt: 'تاريخ إصدار الترخيص',
    regOfficeLicenseExpiresAt: 'تاريخ انتهاء الترخيص',
    regOfficeCertificateFileName: 'اسم ملف شهادة الترخيص',
    regOfficeCertificateStorageRef: 'موضع حفظ الشهادة',
    regOfficeLicensedLines: 'الفروع التأمينية المرخَّصة',
    regOfficeLicensedLinesHint:
      'أنواع الترخيص (عامّ / حياة) مشتقّةٌ من تصنيفات هذه الفروع ولا تُدخَل.',
    regOfficeStatusDerivedNote:
      'حالة الترخيص لا تُدخَل ولا تُخزَّن: تُحسَب من تواريخ المدّة وطلب التجديد وأيِّ فعلٍ رقابيٍّ قائم.',

    regOfficeCountry: 'الدولة',
    regOfficeCity: 'المدينة',
    regOfficeAddress: 'العنوان',
    regOfficePhone: 'الهاتف',
    regOfficeEmail: 'البريد الإلكتروني الرسمي',
    regOfficeWebsite: 'الموقع الإلكتروني (اختياري)',

    regOfficeGmName: 'اسم المدير العام',
    regOfficeComplianceOfficerName: 'اسم مسؤول الالتزام',
    regOfficeComplianceOfficerEmail: 'بريد مسؤول الالتزام',
    regOfficeComplianceOfficerPhone: 'هاتف مسؤول الالتزام (اختياري)',
    regOfficePeopleNote:
      'هذه بياناتٌ شخصيةٌ بموجب قانون حماية البيانات الشخصية رقم ٢٤ لسنة ٢٠٢٣، وتُدخَل نصّاً عند التسجيل.',

    regOfficeBankGuaranteeNo: 'رقم الكفالة البنكية (اختياري)',
    regOfficeBankGuaranteeBank: 'بنك الكفالة (اختياري)',
    regOfficeBankGuaranteeAmount: 'قيمة الكفالة (اختياري)',
    regOfficeBankGuaranteeExpiry: 'تاريخ انتهاء الكفالة (اختياري)',
    regOfficeGuaranteeNote:
      'لا ترد الكفالة البنكية في تعليمات البنك المركزي رقم (٩) لسنة ٢٠٢٦. تُجمَع إن وُجدت، ولا تُطلَب، ولا يُرفَض مكتبٌ لغيابها.',
    regOfficePiPolicyNo: 'رقم وثيقة المسؤولية المهنية',
    regOfficePiInsurerName: 'شركة التأمين المصدِرة للوثيقة',
    regOfficePiLimit: 'حدّ التعويض',
    regOfficePiExpiry: 'تاريخ انتهاء الوثيقة',
    regOfficePiNote:
      'المسؤولية المهنية إلزاميةٌ بلا شرط (م١٠/أ/٤ وم١٨/أ/٣). ولا حدَّ أدنى مفروضٌ لمبلغ التغطية: شروط الوثيقة تنتظر قراراً من البنك المركزي، فلا يُختلَق حدٌّ.',
    regOfficePaidUpCapital: 'رأس المال المدفوع (اختياري)',
    regOfficeCapitalNote:
      'يُحسَب المتطلّب لكلّ نوعٍ على حدة ثم يُجمَع (م٤/أ). والنقص يُعرَض ولا يمنع التسجيل.',

    regOfficeBank: 'البنك',
    regOfficeIban: 'رقم الحساب الدولي (IBAN)',
    regOfficeCurrency: 'العملة الأساسية',
    regOfficeIbanNote: 'يُحفظ رقم الحساب مشفَّراً.',

    regOfficeSubdomain: 'النطاق الفرعي',
    regOfficeSubdomainHint:
      'هذا ليس حقلاً من حقول قاموس البيانات، بل الطريقة التي تُعنوِن بها المنصّة المستأجر.',

    regOfficeSubmit: 'تسجيل المكتب',
    regOfficeSubmitting: 'جارٍ التسجيل…',
    regOfficeLoadError: 'تعذّر تحميل القوائم المرجعية — حاول مرة أخرى.',
    regOfficeListReference: 'القوائم المرجعية (الشكل القانوني، الجهة المرخِّصة، الدولة، المدينة، البنك، العملة، نموذج العمل)',
    regOfficeListLines: 'قائمة فروع التأمين',
    regOfficeSuccessHeading: 'تمّ تسجيل المكتب',
    regOfficeSuccessAdministrator:
      'أُنشئ دور «مدير المكتب» بـ{count} صلاحية، محسوبةً من كتالوج الصلاحيات.',
    regOfficeSuccessTypes: 'أنواع التأمين المرخَّص بها: {types}',
    regOfficeCapitalRequired: 'المتطلّب',
    regOfficeCapitalRecorded: 'المسجَّل',
    regOfficeCapitalShortfall: 'النقص',
    regOfficeCapitalUnrecorded:
      'لم يُسجَّل رأس مال. هذه حقيقةٌ ناقصةٌ عن المكتب، وليست نقصاً في رأس ماله.',
    regOfficeCapitalShort:
      'رأس المال المسجَّل أقلّ من المتطلّب المحسوب. عُرض ولم يمنع التسجيل.',
    regOfficeExpiryNotYearEnd:
      'تاريخ الانتهاء المُدخَل ليس ٣١ كانون الأول. م١٠/ب تُنهي المدّة في نهاية السنة الميلادية — تحقّق من الشهادة؛ الشهادة هي المرجع ولم يُمنَع الحفظ.',
    regOfficeExpiryNotThreeYears:
      'تاريخ الانتهاء لا يطابق مدّة الثلاث سنوات التي تقتضيها م١٠/ب لتاريخ الإصدار المُدخَل. أُدرِج للاطّلاع ولم يُمنَع الحفظ.',
    regOfficeRegisterAnother: 'تسجيل مكتب آخر',
  },
  EN: {
    regInsRefusalAct: 'register an insurance company on the platform',
    regInsHeading: 'Register an insurance company',
    regInsIntro:
      "This form creates an insurance company on the platform. Enter the details as they appear on the company's licence and the establishment register.",
    regInsTenantWarning:
      'Registering creates a tenant. There is no route in this product to delete a company once registered, because the audit trail cannot be deleted — check the national establishment number before saving.',
    regInsSectionIdentity: 'Basic identity',
    regInsSectionLicence: 'Licensing and activity',
    regInsSectionAddress: 'Address and contact',
    regInsSectionIntegration: 'Integration',
    regInsSectionBanking: 'Banking',
    regInsSectionPlatform: 'Platform data',
    regInsCode: 'Company code',
    regInsShortName: 'Short name',
    regInsLicenseNo: 'Licence number',
    regInsLicenseExpiry: 'When the licence expires, as printed on the certificate',
    regInsLicenseIssued: 'When it was issued — if the certificate prints one',
    regInsBusinessModel: 'Business model',
    regInsLicensedLines: 'Licensed lines of business',
    regInsLicensedLinesHint:
      "These are the lines the company's licence permits it to underwrite. They are NOT what offices have recorded buying from it — two different facts, never merged.",
    regInsQuotationEmail: 'Quotation email',
    regInsClaimsEmail: 'Claims email',
    regInsPublishedChannelsNote:
      "These are the company's published channels. The broker-relations contact and the financial strength rating are recorded by each office on its own record, because every office deals with a different named person inside the same company.",
    regInsIntegrationMethod: 'Integration method',
    regInsApiEndpoint: 'API endpoint',
    regInsApiEndpointHint:
      'Required when the integration method is API, and not entered with any other.',
    regInsCertificateFileName: 'Licence certificate file name',
    regInsCertificateStorageRef: 'Where the certificate is filed',
    regInsSubmit: 'Register company',
    regInsSubmitting: 'Registering…',
    regInsSuccessHeading: 'Company registered',
    regInsSuccessLines: 'Licensed lines: {count}',
    regInsSuccessCategories: 'Licensed insurance types: {types}',
    regInsRegisterAnother: 'Register another company',
    regOfficeSectionPack: 'Registration documents (art. 10/a)',
    regOfficePremisesTenureFileName: 'Lease or title deed file name',
    regOfficePremisesTenureStorageRef: 'Where the lease or title deed is filed',
    regOfficeAssociationFileName: 'Association membership proof file name',
    regOfficeAssociationStorageRef: 'Where the membership proof is filed',
    regOfficeBrokerageKindNote:
      'This field is recorded and carries no consequence: no guard in the system reads it, and this product holds no regulatory text for reinsurance brokerage — so choosing REINSURANCE neither exempts the office from anything nor binds it to anything, and the existing rules apply to it as a brokerage office.',
    regOfficePackNote:
      'Art. 10/a/2 requires a copy of the lease contract or the title deed for the premises, and art. 10/a/3 requires proof of membership of the Jordanian Insurance Brokers Association, which art. 18/a repeats in the periodic returns. Under decision 88 their absence does not block the save; the record is counted as incomplete. The membership proof is held in the office’s registration pack with no link to a person yet, because the people the article names do not exist in the system when an office is registered.',
    regOfficePackHeading: 'Registration pack',
    regOfficePackComplete:
      'The registration pack is complete: both documents are recorded in the system — the file name, where it is filed, and who filed it.',
    regOfficePackMissingIntro: 'Missing:',
    regOfficePackNotHeld: 'this document is not stored in the system',
    regOfficePackPremisesTenure: 'lease contract or title deed',
    regOfficePackAssociation:
      'proof of membership of the Jordanian Insurance Brokers Association',
    regOfficePackScope:
      'This states what the system records, not a judgement about the office. An office licensed by the Central Bank has already submitted these documents to the regulator, so our holding no record is a gap in our own record. The system does not store the files themselves; what is stored is a record of each document — its name, where it is filed, and who filed it — so “recorded” means filed and attributed, not that the file can be fetched from here.',
    regOfficeRefusalAct: 'register a brokerage office on the platform',
    regOfficeHeading: 'Register a brokerage office',
    regOfficeIntro:
      'This form creates a new brokerage office on the platform: its records are entirely separate from every other office, and nobody outside it can reach them. Enter the details as they appear on the licence certificate and the establishment register.',
    regOfficeTenantWarning:
      'Registering creates a tenant. There is no route in this product to delete an office once registered, because the audit trail cannot be deleted — check the national establishment number before saving.',

    regOfficeSectionIdentity: 'Basic identity',
    regOfficeSectionLicence: 'Licence',
    regOfficeSectionAddress: 'Address and contact',
    regOfficeSectionPeople: 'Key people',
    regOfficeSectionGuarantees: 'Regulatory guarantees',
    regOfficeSectionBanking: 'Banking',
    regOfficeSectionPlatform: 'Platform data',

    regOfficeCode: 'Office code',
    regOfficeLegalNameAr: 'Legal name (Arabic)',
    regOfficeLegalNameEn: 'Legal name (English)',
    regOfficeTradeName: 'Trade name (optional)',
    regOfficeLegalForm: 'Legal form',
    regOfficeNationalEstablishmentNo: 'National establishment number',
    regOfficeCrNo: 'Commercial registration number',
    regOfficeCrDate: 'Registration date (optional)',
    regOfficeTaxNo: 'Tax number',

    regOfficeBrokerageKind: 'Licence type',
    regOfficeBrokerKind: 'Broker kind',
    regOfficeLicenseNo: 'Licence number',
    regOfficeLicensingAuthority: 'Licensing authority',
    regOfficeLicenseIssuedAt: 'Licence issue date',
    regOfficeLicenseExpiresAt: 'Licence expiry date',
    regOfficeCertificateFileName: 'Licence certificate file name',
    regOfficeCertificateStorageRef: 'Where the certificate is filed',
    regOfficeLicensedLines: 'Licensed insurance branches',
    regOfficeLicensedLinesHint:
      'The licence types (general / life) are derived from these branches and are never entered.',
    regOfficeStatusDerivedNote:
      'Licence status is neither entered nor stored: it is derived from the term dates, the renewal application and any standing regulatory act.',

    regOfficeCountry: 'Country',
    regOfficeCity: 'City',
    regOfficeAddress: 'Address',
    regOfficePhone: 'Main phone',
    regOfficeEmail: 'Official email',
    regOfficeWebsite: 'Website (optional)',

    regOfficeGmName: 'General manager name',
    regOfficeComplianceOfficerName: 'Compliance officer name',
    regOfficeComplianceOfficerEmail: 'Compliance officer email',
    regOfficeComplianceOfficerPhone: 'Compliance officer phone (optional)',
    regOfficePeopleNote:
      'These are personal data under PDPL No. 24/2023 and are entered as text at registration.',

    regOfficeBankGuaranteeNo: 'Bank guarantee number (optional)',
    regOfficeBankGuaranteeBank: 'Guarantee issuing bank (optional)',
    regOfficeBankGuaranteeAmount: 'Guarantee amount (optional)',
    regOfficeBankGuaranteeExpiry: 'Guarantee expiry date (optional)',
    regOfficeGuaranteeNote:
      'The bank guarantee does not appear in CBJ Instructions No. 9 of 2026. It is collected if the office has one, never required, and never a reason to refuse a registration.',
    regOfficePiPolicyNo: 'PI policy number',
    regOfficePiInsurerName: 'PI insurer',
    regOfficePiLimit: 'Limit of indemnity',
    regOfficePiExpiry: 'PI expiry date',
    regOfficePiNote:
      'Professional indemnity is mandatory without condition (art. 10/a/4 and art. 18/a/3). No minimum limit is enforced: the policy terms await a CBJ decision, so none is invented.',
    regOfficePaidUpCapital: 'Paid-up capital (optional)',
    regOfficeCapitalNote:
      'The requirement is computed per insurance type and summed (art. 4/a). A shortfall is reported and does not block registration.',

    regOfficeBank: 'Bank',
    regOfficeIban: 'IBAN',
    regOfficeCurrency: 'Base currency',
    regOfficeIbanNote: 'The account number is stored encrypted.',

    regOfficeSubdomain: 'Subdomain',
    regOfficeSubdomainHint:
      'Not a field of the data dictionary — it is how the platform addresses a tenant.',

    regOfficeSubmit: 'Register office',
    regOfficeSubmitting: 'Registering…',
    regOfficeLoadError: 'Could not load the reference lists — try again.',
    regOfficeListReference: 'the reference lists (legal form, licensing authority, country, city, bank, currency, business model)',
    regOfficeListLines: 'the insurance-branches list',
    regOfficeSuccessHeading: 'Office registered',
    regOfficeSuccessAdministrator:
      'An Office administrator role was created with {count} permissions, computed from the permission catalogue.',
    regOfficeSuccessTypes: 'Licensed insurance types: {types}',
    regOfficeCapitalRequired: 'Required',
    regOfficeCapitalRecorded: 'Recorded',
    regOfficeCapitalShortfall: 'Shortfall',
    regOfficeCapitalUnrecorded:
      'No capital was recorded. That is a missing fact about the office, not a finding about its capital.',
    regOfficeCapitalShort:
      'The recorded capital is below the computed requirement. Reported; registration was not blocked.',
    regOfficeExpiryNotYearEnd:
      'The expiry entered is not 31 December. Art. 10/b ends a term at the end of a calendar year — check the certificate; the certificate is the authority and saving was not blocked.',
    regOfficeExpiryNotThreeYears:
      'The expiry does not match the three-calendar-year term art. 10/b requires for the issue date entered. Shown for information; saving was not blocked.',
    regOfficeRegisterAnother: 'Register another office',
  },
} as const;
