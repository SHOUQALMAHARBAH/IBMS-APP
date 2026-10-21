// MODULE 0-ب ITEM (f), COMPANY HALF — an insurance company's own screen.
//
// ITS OWN DICTIONARY, not an addition to `provider.ts`, and the reason is that file's own header:
// the provider's screens are about OTHER organizations, and this one is a company reading ITSELF.
// Folding a company-facing screen's wording in beside the operator's is how a reader stops noticing
// whose record they are looking at.
//
// Vocabulary fixed once and reused:
//   سجلّ الشركة لدينا     the company's record as WE hold it (never «سجل الشركة», which reads as the
//                        company's own books)
//   أنواع التأمين المرخَّصة  the licensed insurance lines
//   شهادة الترخيص         the licence certificate
//   مُسجَّلة               RECORDED — established and attributed, never "retrievable"
export const COMPANY = {
  AR: {
    companyRecordHeading: 'سجلّ شركتكم لدينا',
    companyRecordIntro:
      'هذه هي البيانات التي سجّلها مشغّل المنصّة عن شركتكم. الصفحة للقراءة فقط: تصحيحُ أيِّ بيانٍ هنا يجري عبر المشغّل، لأنّ السجلَّ الذي يُقدَّم للجهة الرقابية يجب أن يكون له مصدرٌ واحد.',
    companyRecordLoading: 'يُحمّل سجلّ الشركة…',
    companyRecordLoadError: 'تعذّر تحميل سجلّ الشركة — حاول مرة أخرى.',
    companyRecordRefusal:
      'هذه الصفحة تعرض على شركة التأمين سجلَّها لدينا، وجهتكم ليست شركة تأمين. إن كنتم مكتب وساطة فترخيصُكم ونطاقُه في صفحة الامتثال التنظيمي.',

    companySectionIdentity: 'الهُويّة',
    companySectionLicensedLines: 'أنواع التأمين المرخَّصة',
    companySectionCertificate: 'شهادة الترخيص',
    companySectionRecordState: 'حالة السجلّ',

    companyLegalName: 'الاسم القانوني',
    companyLegalNameAr: 'الاسم القانوني بالعربية',
    companyShortName: 'الاسم المختصر',
    companyCode: 'رمز الشركة',
    companyNationalEstablishmentNo: 'رقم المنشأة الوطني',
    companyCommercialRegistrationNo: 'رقم السجل التجاري',
    companyTaxNumber: 'الرقم الضريبي',
    companyInsurerLicenseNumber: 'رقم ترخيص شركة التأمين',
    companyLicenseStanding: 'حالةُ الترخيص',
    companyLicenseStandingCurrent: 'ساري',
    companyLicenseStandingExpired: 'منتهي',
    companyLicenseStandingNone: 'لا توجدُ مدّةُ ترخيصٍ مسجّلةٌ لدينا',
    companyLicenseStandingDerived: 'هذه الحالةُ مُستنبَطةٌ من تاريخِ الانتهاءِ المسجّل، وليست محفوظةً كحقل. ولا يترتّبُ عليها أيُّ منعٍ أو تحذيرٍ في أيِّ إجراء.',
    companyLicenseTermCount: 'عددُ مدَدِ الترخيصِ المسجّلة',
    companyLicenseExpiresAt: 'تنتهي في',
    companyLicenseIssuedAt: 'صدرَ في',
    companyLegalForm: 'الشكل القانوني',
    companyLicensingAuthority: 'الجهة المرخِّصة',
    companyBusinessModel: 'نموذج العمل',
    companyCountry: 'الدولة',
    companyCity: 'المدينة',
    companyAddress: 'العنوان',
    companyPhone: 'الهاتف',
    companyEmail: 'البريد الإلكتروني',
    companyWebsite: 'الموقع الإلكتروني',
    companyQuotationEmail: 'بريد طلبات التسعير',
    companyClaimsEmail: 'بريد المطالبات',
    companyIntegrationMethod: 'طريقة التكامل',
    companyRegisteredAt: 'تاريخ التسجيل لدينا',

    companyLineCode: 'الرمز',
    companyLineName: 'النوع',
    companyLineCategory: 'الفئة',
    companyLicensedCategories: 'الفئات المرخَّصة',
    companyNoLicensedLines:
      'لا توجد أنواع تأمين مسجَّلة على شركتكم لدينا. هذا نقصٌ في سجلّنا، لا حُكمٌ على ترخيصكم.',

    companyCertificateFileName: 'اسم الملف',
    companyCertificateRecordedAt: 'تاريخ التسجيل',
    companyNoCertificate:
      'لا توجد شهادةُ ترخيصٍ مُسجَّلةٌ لدينا. الشركةُ المرخَّصة من البنك المركزي قدّمت شهادتَها للجهة الرقابية بالفعل، فغيابُ سجلٍّ عندنا نقصٌ في سجلّنا نحن.',
    companyRecordStateScope:
      'هذا بيانٌ عمّا يُسجّله النظام، لا حُكمٌ على الشركة. والنظامُ لا يحفظ الملفات نفسها؛ ما يُحفَظ سجلٌّ بالوثيقة — اسمُها وموضعُ حفظها ومَن سجّلها — فـ«مُسجَّلة» تعني مُثبَتةً ومنسوبةً، لا أنّ الملفَّ قابلٌ للاسترجاع من هنا.',
    companyCertificateOnRecord: 'شهادة الترخيص مُسجَّلة',
    companyLicensedLineCount: 'عدد أنواع التأمين المسجَّلة',
    companyYes: 'نعم',
    companyNo: 'لا',
    companyNotRecorded: 'غير مُسجَّل',
  },
  EN: {
    companyRecordHeading: 'Your company record as we hold it',
    companyRecordIntro:
      'These are the details the platform operator recorded about your company. This page is read-only: a correction to anything here goes through the operator, because a record shown to the regulator must have one source.',
    companyRecordLoading: 'Loading your company record…',
    companyRecordLoadError: 'Could not load your company record — try again.',
    companyRecordRefusal:
      'This page shows an insurance company its own record as we hold it, and your organization is not an insurance company. If you are a brokerage office, your licence and its scope are on the regulatory-compliance page.',

    companySectionIdentity: 'Identity',
    companySectionLicensedLines: 'Licensed insurance lines',
    companySectionCertificate: 'Licence certificate',
    companySectionRecordState: 'Record state',

    companyLegalName: 'Legal name',
    companyLegalNameAr: 'Legal name (Arabic)',
    companyShortName: 'Short name',
    companyCode: 'Company code',
    companyNationalEstablishmentNo: 'National establishment number',
    companyCommercialRegistrationNo: 'Commercial registration number',
    companyTaxNumber: 'Tax number',
    companyInsurerLicenseNumber: 'Insurer licence number',
    companyLicenseStanding: 'Licence standing',
    companyLicenseStandingCurrent: 'Current',
    companyLicenseStandingExpired: 'Expired',
    companyLicenseStandingNone: 'We hold no licence term on record',
    companyLicenseStandingDerived: 'This standing is derived from the recorded expiry date, not stored as a field. Nothing in the system is refused or warned about because of it.',
    companyLicenseTermCount: 'Licence terms on record',
    companyLicenseExpiresAt: 'Expires',
    companyLicenseIssuedAt: 'Issued',
    companyLegalForm: 'Legal form',
    companyLicensingAuthority: 'Licensing authority',
    companyBusinessModel: 'Business model',
    companyCountry: 'Country',
    companyCity: 'City',
    companyAddress: 'Address',
    companyPhone: 'Phone',
    companyEmail: 'Email',
    companyWebsite: 'Website',
    companyQuotationEmail: 'Quotation email',
    companyClaimsEmail: 'Claims email',
    companyIntegrationMethod: 'Integration method',
    companyRegisteredAt: 'Recorded with us on',

    companyLineCode: 'Code',
    companyLineName: 'Line',
    companyLineCategory: 'Category',
    companyLicensedCategories: 'Licensed categories',
    companyNoLicensedLines:
      'No insurance lines are recorded against your company here. That is a gap in OUR record, not a finding about your licence.',

    companyCertificateFileName: 'File name',
    companyCertificateRecordedAt: 'Recorded on',
    companyNoCertificate:
      'No licence certificate is recorded here. A company licensed by the Central Bank has already filed its certificate with the regulator, so our not holding a copy is a gap in OUR record.',
    companyRecordStateScope:
      'This states what the system records, not a finding about the company. The system does not keep the files themselves; what is kept is a record of the document — its name, where it is filed and who filed it — so "recorded" means established and attributed, never that the file can be retrieved from here.',
    companyCertificateOnRecord: 'Licence certificate recorded',
    companyLicensedLineCount: 'Insurance lines recorded',
    companyYes: 'Yes',
    companyNo: 'No',
    companyNotRecorded: 'Not recorded',
  },
} as const;
