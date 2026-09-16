// Enum value labels — the words a person reads where the database stores a
// code. Every list, table and detail screen that prints a `status`,
// `category`, `classification`, `severity` or `outcome` reads its label from
// here through `lib/i18n/enum-labels.ts`, so `PENDING_KYC` never reaches the
// screen in either language.
//
// One file rather than thirty: these vocabularies are cross-cutting (a
// DocumentCategory is printed on four unrelated screens), and splitting them
// per domain would put the same value in several places — the exact thing
// that let eight of them drift out of sync before this existed.
export const ENUMS = {
  AR: {
    // AuditAction
    auditActionCreate: 'إنشاء',
    auditActionRead: 'اطّلاع',
    auditActionUpdate: 'تعديل',
    auditActionDelete: 'حذف',
    auditActionApprove: 'اعتماد',
    auditActionReject: 'رفض',
    auditActionTransition: 'تغيير حالة',
    auditActionExport: 'تصدير',
    auditActionPrint: 'طباعة',
    auditActionLogin: 'تسجيل دخول',
    auditActionLoginFailed: 'محاولة دخول فاشلة',
    auditActionLogout: 'تسجيل خروج',
    auditActionPasswordResetRequested: 'طلب إعادة تعيين كلمة المرور',
    auditActionPasswordResetCompleted: 'اكتمال إعادة تعيين كلمة المرور',
    auditActionMfaEnrolled: 'تسجيل المصادقة الثنائية',
    auditActionMfaVerified: 'تحقق المصادقة الثنائية',
    auditActionMfaFailed: 'فشل المصادقة الثنائية',
    auditActionStepUpVerified: 'تحقق إضافي ناجح',
    auditActionAccessWindowExpired: 'انتهاء نافذة الوصول',
    // BrokerLicenseStatus
    licStatusActive: 'سارية',
    licStatusLapsed: 'منتهية',
    // ClaimStatus
    claimStatusNotified: 'مُبلَّغ عنها',
    claimStatusRegistered: 'مسجّلة',
    claimStatusDocumentationInProgress: 'استكمال المستندات',
    claimStatusUnderAssessment: 'قيد التقييم',
    claimStatusPartiallyApproved: 'معتمدة جزئياً',
    claimStatusDeclined: 'مرفوضة',
    claimStatusSettled: 'مسوّاة',
    claimStatusApproved: 'معتمدة',
    // CrossSellStatus
    xsStatusOpen: 'مفتوحة',
    xsStatusConverted: 'محوّلة',
    xsStatusDismissed: 'مستبعدة',
    // DataClassification
    dataClassPublic: 'عام',
    dataClassInternal: 'داخلي',
    dataClassConfidential: 'سرّي',
    dataClassHighlyConfidential: 'سرّي للغاية',
    // DataSharingChannel
    dshChannelSecureSftp: 'نقل آمن SFTP',
    dshChannelEncryptedEmail: 'بريد إلكتروني مُشفَّر',
    dshChannelVendorSecurePortal: 'بوابة المورّد الآمنة',
    dshChannelCbjRegulatoryPortal: 'البوابة التنظيمية للبنك المركزي',
    dshChannelInPersonEncryptedMedia: 'تسليم شخصي بوسيط مُشفَّر',
    dshChannelUnencryptedEmail: 'بريد إلكتروني غير مُشفَّر',
    dshChannelPostalMail: 'بريد عادي',
    dshChannelOtherUnsecured: 'وسيلة أخرى غير آمنة',
    // DatasetVersionStatus
    datasetStatusDownloaded: 'مُنزَّلة',
    datasetStatusValidated: 'مُتحقَّق منها',
    datasetStatusPublished: 'منشورة',
    datasetStatusSuperseded: 'مستبدَلة',
    datasetStatusRejected: 'مرفوضة',
    // DisposalBatchStatus
    rdStatusClosed: 'مغلقة',
    // DocumentCategory
    docCategoryApplicationProposal: 'طلب التأمين',
    docCategoryRiskSurvey: 'مسح المخاطر',
    docCategoryQuotation: 'عرض سعر',
    docCategoryComparison: 'مقارنة',
    docCategoryRecommendation: 'توصية',
    docCategoryClientApproval: 'موافقة العميل',
    docCategoryPolicy: 'وثيقة تأمين',
    docCategoryEndorsement: 'ملحق',
    docCategoryInvoice: 'فاتورة',
    docCategoryReceipt: 'سند قبض',
    docCategoryClaim: 'مطالبة',
    docCategoryCorrespondence: 'مراسلات',
    docCategoryOther: 'أخرى',
    // DocumentClassification
    docClassConfidential: 'سرّي',
    docClassHighlyConfidential: 'سرّي للغاية',
    // DpiaOutcome
    dpiaOutcomeEscalatedFullDpia: 'مُصعَّد إلى تقييم أثر كامل',
    // EndorsementStatus
    endStatusRequested: 'مطلوب',
    endStatusSubmittedToInsurer: 'مُرسَل إلى شركة التأمين',
    endStatusInsurerConfirmed: 'مؤكَّد من شركة التأمين',
    endStatusFinancialAdjustmentCalculated: 'احتُسبت التسوية المالية',
    endStatusRefundApprovalPending: 'بانتظار اعتماد الاسترداد',
    endStatusApplied: 'مُطبَّق',
    endStatusClientNotified: 'أُبلغ العميل',
    // IncidentSeverity
    incSeverityLow: 'منخفضة',
    incSeverityMedium: 'متوسطة',
    incSeverityHigh: 'عالية',
    incSeverityCritical: 'حرجة',
    // InsuranceProgramStatus
    iprogStatusDraft: 'مسودة',
    iprogStatusFinalized: 'معتمد نهائياً',
    iprogStatusSuperseded: 'مستبدَل',
    // InternalAuditFindingStatus
    iafStatusOpen: 'مفتوحة',
    iafStatusClosed: 'مغلقة',
    // KbCategory
    kbCategoryProductKnowledge: 'معرفة المنتجات',
    kbCategoryInsurerAppetite: 'توجهات شركات التأمين',
    kbCategoryRateGuide: 'دليل الأسعار',
    kbCategoryRegulatoryUpdate: 'تحديث تنظيمي',
    // NeedsAssessmentStatus
    nadStatusDraft: 'مسودة',
    nadStatusRejected: 'مرفوض',
    // ProspectStatus
    prospStatusQualifying: 'قيد التأهيل',
    // ProviderHealthState
    provStateHealthy: 'سليم',
    provStateDegraded: 'متدهور',
    provStateUnavailable: 'غير متاح',
    provStateNotConfigured: 'غير مُهيّأ',
    provStateConfigured: 'مُهيّأ',
    provStateFailed: 'فشل',
    // ProviderHealthStatus
    provHealthHealthy: 'سليم',
    provHealthDegraded: 'متدهور',
    provHealthUnavailable: 'غير متاح',
    provHealthNotConfigured: 'غير مُهيّأ',
    // ReconciliationExceptionStatus
    recExcStatusOpen: 'مفتوحة',
    recExcStatusInvestigating: 'قيد البحث',
    recExcStatusResolved: 'مُسوّاة',
    // RenewalStatus
    renStatusRenewalDue: 'التجديد مستحق',
    renStatusInProgress: 'قيد التنفيذ',
    renStatusQuotesObtained: 'وردت عروض الأسعار',
    renStatusRecommended: 'صدرت التوصية',
    renStatusClientDecision: 'قرار العميل',
    renStatusRenewed: 'مُجدَّدة',
    renStatusLapsed: 'منتهية',
    renStatusCancelled: 'ملغاة',
    // RiskRegisterStatus
    rrStatusOpen: 'مفتوح',
    rrStatusClosed: 'مغلق',
    // ScreeningAttemptOutcome
    screenOutcomeNoMatch: 'لا يوجد تطابق',
    screenOutcomePotentialMatch: 'تطابق محتمل',
    screenOutcomeNotConfigured: 'غير مُهيّأ',
    screenOutcomeScreeningFailed: 'فشل الفحص',
    screenOutcomeUnableToScreen: 'تعذّر الفحص',
    // ScreeningHoldStatus
    holdStatusReviewRequired: 'تتطلب مراجعة',
    holdStatusBlocked: 'محجوبة',
    // ScreeningMatchStatus
    matchStatusPending: 'قيد الانتظار',
    matchStatusCleared: 'مستبعد',
    matchStatusConfirmed: 'مؤكَّد',
    // SlaPolicyStatus
    slaPolStatusDraft: 'مسودة',
    slaPolStatusActive: 'سارية',
    slaPolStatusInactive: 'غير سارية',
    // TimelineEventKind
    timelineKindInteraction: 'تفاعل',
    timelineKindPolicy: 'وثيقة',
    timelineKindClaim: 'مطالبة',
    timelineKindComplaint: 'شكوى',
    // TransactionMonitoringStatus
    tmStatusOpen: 'مفتوح',
    tmStatusClosed: 'مغلق',
    // UpSellStatus
    upsStatusOpen: 'مفتوحة',
    upsStatusConverted: 'محوّلة',
    upsStatusDismissed: 'مستبعدة',
    // WatchlistSource
    wlSourceOfacSdn: 'قائمة OFAC للمصنّفين',
    wlSourceUnConsolidated: 'قائمة الأمم المتحدة الموحدة',
    // WatchlistSyncRunStatus
    syncRunStatusRunning: 'قيد التشغيل',
    syncRunStatusSucceeded: 'نجحت',
    syncRunStatusFailed: 'فشلت',
  },
  EN: {
    // AuditAction
    auditActionCreate: 'Create',
    auditActionRead: 'Read',
    auditActionUpdate: 'Update',
    auditActionDelete: 'Delete',
    auditActionApprove: 'Approve',
    auditActionReject: 'Reject',
    auditActionTransition: 'Status change',
    auditActionExport: 'Export',
    auditActionPrint: 'Print',
    auditActionLogin: 'Sign-in',
    auditActionLoginFailed: 'Failed sign-in',
    auditActionLogout: 'Sign-out',
    auditActionPasswordResetRequested: 'Password reset requested',
    auditActionPasswordResetCompleted: 'Password reset completed',
    auditActionMfaEnrolled: 'MFA enrolled',
    auditActionMfaVerified: 'MFA verified',
    auditActionMfaFailed: 'MFA failed',
    auditActionStepUpVerified: 'Step-up verified',
    auditActionAccessWindowExpired: 'Access window expired',
    // BrokerLicenseStatus
    licStatusActive: 'Active',
    licStatusLapsed: 'Lapsed',
    // ClaimStatus
    claimStatusNotified: 'Notified',
    claimStatusRegistered: 'Registered',
    claimStatusDocumentationInProgress: 'Documentation in progress',
    claimStatusUnderAssessment: 'Under assessment',
    claimStatusPartiallyApproved: 'Partially approved',
    claimStatusDeclined: 'Declined',
    claimStatusSettled: 'Settled',
    claimStatusApproved: 'Approved',
    // CrossSellStatus
    xsStatusOpen: 'Open',
    xsStatusConverted: 'Converted',
    xsStatusDismissed: 'Dismissed',
    // DataClassification
    dataClassPublic: 'Public',
    dataClassInternal: 'Internal',
    dataClassConfidential: 'Confidential',
    dataClassHighlyConfidential: 'Highly confidential',
    // DataSharingChannel
    dshChannelSecureSftp: 'Secure SFTP',
    dshChannelEncryptedEmail: 'Encrypted email',
    dshChannelVendorSecurePortal: 'Vendor secure portal',
    dshChannelCbjRegulatoryPortal: 'CBJ regulatory portal',
    dshChannelInPersonEncryptedMedia: 'In person, encrypted media',
    dshChannelUnencryptedEmail: 'Unencrypted email',
    dshChannelPostalMail: 'Postal mail',
    dshChannelOtherUnsecured: 'Other, unsecured',
    // DatasetVersionStatus
    datasetStatusDownloaded: 'Downloaded',
    datasetStatusValidated: 'Validated',
    datasetStatusPublished: 'Published',
    datasetStatusSuperseded: 'Superseded',
    datasetStatusRejected: 'Rejected',
    // DisposalBatchStatus
    rdStatusClosed: 'Closed',
    // DocumentCategory
    docCategoryApplicationProposal: 'Application / proposal',
    docCategoryRiskSurvey: 'Risk survey',
    docCategoryQuotation: 'Quotation',
    docCategoryComparison: 'Comparison',
    docCategoryRecommendation: 'Recommendation',
    docCategoryClientApproval: 'Client approval',
    docCategoryPolicy: 'Policy',
    docCategoryEndorsement: 'Endorsement',
    docCategoryInvoice: 'Invoice',
    docCategoryReceipt: 'Receipt',
    docCategoryClaim: 'Claim',
    docCategoryCorrespondence: 'Correspondence',
    docCategoryOther: 'Other',
    // DocumentClassification
    docClassConfidential: 'Confidential',
    docClassHighlyConfidential: 'Highly confidential',
    // DpiaOutcome
    dpiaOutcomeEscalatedFullDpia: 'Escalated to a full DPIA',
    // EndorsementStatus
    endStatusRequested: 'Requested',
    endStatusSubmittedToInsurer: 'Submitted to insurer',
    endStatusInsurerConfirmed: 'Insurer confirmed',
    endStatusFinancialAdjustmentCalculated: 'Financial adjustment calculated',
    endStatusRefundApprovalPending: 'Refund approval pending',
    endStatusApplied: 'Applied',
    endStatusClientNotified: 'Client notified',
    // IncidentSeverity
    incSeverityLow: 'Low',
    incSeverityMedium: 'Medium',
    incSeverityHigh: 'High',
    incSeverityCritical: 'Critical',
    // InsuranceProgramStatus
    iprogStatusDraft: 'Draft',
    iprogStatusFinalized: 'Finalized',
    iprogStatusSuperseded: 'Superseded',
    // InternalAuditFindingStatus
    iafStatusOpen: 'Open',
    iafStatusClosed: 'Closed',
    // KbCategory
    kbCategoryProductKnowledge: 'Product knowledge',
    kbCategoryInsurerAppetite: 'Insurer appetite',
    kbCategoryRateGuide: 'Rate guide',
    kbCategoryRegulatoryUpdate: 'Regulatory update',
    // NeedsAssessmentStatus
    nadStatusDraft: 'Draft',
    nadStatusRejected: 'Rejected',
    // ProspectStatus
    prospStatusQualifying: 'Qualifying',
    // ProviderHealthState
    provStateHealthy: 'Healthy',
    provStateDegraded: 'Degraded',
    provStateUnavailable: 'Unavailable',
    provStateNotConfigured: 'Not configured',
    provStateConfigured: 'Configured',
    provStateFailed: 'Failed',
    // ProviderHealthStatus
    provHealthHealthy: 'Healthy',
    provHealthDegraded: 'Degraded',
    provHealthUnavailable: 'Unavailable',
    provHealthNotConfigured: 'Not configured',
    // ReconciliationExceptionStatus
    recExcStatusOpen: 'Open',
    recExcStatusInvestigating: 'Investigating',
    recExcStatusResolved: 'Resolved',
    // RenewalStatus
    renStatusRenewalDue: 'Renewal due',
    renStatusInProgress: 'In progress',
    renStatusQuotesObtained: 'Quotes obtained',
    renStatusRecommended: 'Recommended',
    renStatusClientDecision: 'Client decision',
    renStatusRenewed: 'Renewed',
    renStatusLapsed: 'Lapsed',
    renStatusCancelled: 'Cancelled',
    // RiskRegisterStatus
    rrStatusOpen: 'Open',
    rrStatusClosed: 'Closed',
    // ScreeningAttemptOutcome
    screenOutcomeNoMatch: 'No match',
    screenOutcomePotentialMatch: 'Potential match',
    screenOutcomeNotConfigured: 'Not configured',
    screenOutcomeScreeningFailed: 'Screening failed',
    screenOutcomeUnableToScreen: 'Unable to screen',
    // ScreeningHoldStatus
    holdStatusReviewRequired: 'Review required',
    holdStatusBlocked: 'Blocked',
    // ScreeningMatchStatus
    matchStatusPending: 'Pending',
    matchStatusCleared: 'Cleared',
    matchStatusConfirmed: 'Confirmed',
    // SlaPolicyStatus
    slaPolStatusDraft: 'Draft',
    slaPolStatusActive: 'Active',
    slaPolStatusInactive: 'Inactive',
    // TimelineEventKind
    timelineKindInteraction: 'Interaction',
    timelineKindPolicy: 'Policy',
    timelineKindClaim: 'Claim',
    timelineKindComplaint: 'Complaint',
    // TransactionMonitoringStatus
    tmStatusOpen: 'Open',
    tmStatusClosed: 'Closed',
    // UpSellStatus
    upsStatusOpen: 'Open',
    upsStatusConverted: 'Converted',
    upsStatusDismissed: 'Dismissed',
    // WatchlistSource
    wlSourceOfacSdn: 'OFAC SDN',
    wlSourceUnConsolidated: 'UN consolidated list',
    // WatchlistSyncRunStatus
    syncRunStatusRunning: 'Running',
    syncRunStatusSucceeded: 'Succeeded',
    syncRunStatusFailed: 'Failed',
  },
} as const;
