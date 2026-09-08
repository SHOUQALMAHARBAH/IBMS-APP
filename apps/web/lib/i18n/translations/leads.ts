// /leads (leads/page.tsx, LeadPipelineBoard.tsx, LeadIntakeForm.tsx) —
// Process 1, Lead Management.
export const LEADS = {
  AR: {
    leadsHeading: 'العملاء المحتملون',
    leadsProcessIntro:
      'العملية 1 — التقاط عميل محتمل من أي مصدر اكتساب ونقله عبر مسار المبيعات ' +
      '(جديد ← تم التواصل ← مؤهل ← تحويل إلى عميل مرتقب، أو استبعاد في أي مرحلة).',
    leadsPipelineHeading: 'مسار المبيعات',
    leadsNoPermission:
      'لا تملك صلاحية lead.list.read، لذا لا يوجد ما يمكن عرضه هنا.',
    leadsNoneYet: 'لا يوجد عملاء محتملون بعد — أضف واحداً أعلاه لبدء مسارك.',
    leadsColumnEmpty: 'فارغة',

    leadsNewLeadHeading: 'عميل محتمل جديد',
    leadsFullNameLabel: 'الاسم الكامل',
    leadsFullNamePlaceholder: 'مثال: أحمد الفلاني',
    leadsSourceLabel: 'المصدر',
    leadsPhoneLabel: 'رقم الهاتف (اختياري)',
    leadsEmailLabel: 'البريد الإلكتروني (اختياري)',
    leadsMarketingConsentLabel: 'وافق هذا العميل المحتمل على تلقي الرسائل التسويقية',
    leadsConsentTextVersionLabel: 'إصدار نص الموافقة',
    leadsAddButton: 'إضافة عميل محتمل',
    leadsAddingButton: 'جارٍ الإضافة…',
    leadsAddedMessage: 'تمت إضافة العميل المحتمل "{name}" إلى مسارك.',
    leadsCreateError: 'تعذر إنشاء العميل المحتمل — حاول مرة أخرى.',
    leadsUpdateError: 'تعذر تحديث هذا العميل المحتمل — حاول مرة أخرى.',

    leadStatusNew: 'جديد',
    leadStatusContacted: 'تم التواصل',
    leadStatusQualified: 'مؤهل',
    leadStatusConvertedToProspect: 'تم التحويل إلى عميل مرتقب',
    leadStatusDisqualified: 'مستبعد',

    leadMoveToNew: 'جديد',
    leadMoveToContacted: 'وضع علامة تم التواصل',
    leadMoveToQualified: 'وضع علامة مؤهل',
    leadMoveToConvertedToProspect: 'تحويل إلى عميل مرتقب',
    leadMoveToDisqualified: 'استبعاد',

    leadSourceReferral: 'إحالة',
    leadSourceWebsite: 'الموقع الإلكتروني',
    leadSourceSocialMedia: 'وسائل التواصل الاجتماعي',
    leadSourceCampaign: 'حملة تسويقية',
    leadSourceTender: 'مناقصة',
    leadSourceBankPartner: 'شريك بنكي',
    leadSourceStrategicPartner: 'شريك استراتيجي',
    leadSourceExCustomer: 'عميل سابق',
    leadSourceRenewal: 'فرصة تجديد',
  },
  EN: {
    leadsHeading: 'Leads',
    leadsProcessIntro:
      'Process 1 — capture a lead from any acquisition source and move it through the pipeline ' +
      '(New → Contacted → Qualified → Converted to prospect, or Disqualified at any stage).',
    leadsPipelineHeading: 'Pipeline',
    leadsNoPermission:
      "You don't hold the lead.list.read permission, so there's nothing to show here.",
    leadsNoneYet: 'No leads yet — add one above to start your pipeline.',
    leadsColumnEmpty: 'Empty',

    leadsNewLeadHeading: 'New lead',
    leadsFullNameLabel: 'Full name',
    leadsFullNamePlaceholder: 'e.g. Ahmad Al-Fulani',
    leadsSourceLabel: 'Source',
    leadsPhoneLabel: 'Contact phone (optional)',
    leadsEmailLabel: 'Contact email (optional)',
    leadsMarketingConsentLabel: 'This lead has agreed to receive marketing communications',
    leadsConsentTextVersionLabel: 'Consent text version',
    leadsAddButton: 'Add lead',
    leadsAddingButton: 'Adding…',
    leadsAddedMessage: 'Lead "{name}" added to your pipeline.',
    leadsCreateError: 'Could not create the lead — try again.',
    leadsUpdateError: 'Could not update this lead — try again.',

    leadStatusNew: 'New',
    leadStatusContacted: 'Contacted',
    leadStatusQualified: 'Qualified',
    leadStatusConvertedToProspect: 'Converted to prospect',
    leadStatusDisqualified: 'Disqualified',

    leadMoveToNew: 'New',
    leadMoveToContacted: 'Mark contacted',
    leadMoveToQualified: 'Mark qualified',
    leadMoveToConvertedToProspect: 'Convert to prospect',
    leadMoveToDisqualified: 'Disqualify',

    leadSourceReferral: 'Referral',
    leadSourceWebsite: 'Website',
    leadSourceSocialMedia: 'Social media',
    leadSourceCampaign: 'Campaign',
    leadSourceTender: 'Tender',
    leadSourceBankPartner: 'Bank partner',
    leadSourceStrategicPartner: 'Strategic partner',
    leadSourceExCustomer: 'Ex-customer',
    leadSourceRenewal: 'Renewal opportunity',
  },
} as const;
