/**
 * Part B — "the four insurance form templates (motor/general/health/life)
 * as referenced in the two source documents". Both source documents name
 * these four lines repeatedly (e.g. `productsOfInterest`,
 * `InsuranceProgramLine.insuranceLine`, the `ConsentRecord` touchpoint
 * "Group Medical/Life & Motor Fleet") but neither one supplies actual
 * proposal-form wording — this is a structural skeleton (the fields any
 * insurance proposal form collects) per line, not transcribed regulatory
 * text. Treat `bodyEn`/`bodyAr` as placeholder copy for underwriting/
 * Compliance to replace with the broker's approved wording before this
 * template is used to produce a real document.
 *
 * `DocumentTemplate.templateType` has no enum backing it (plain `String`,
 * schema.prisma "PART 4.2" section) — `proposal_form_<line>` extends the
 * existing snake_case convention (`quotation_comparison`,
 * `recommendation_report`, ...) rather than requiring a schema change.
 */
export interface DocumentTemplateSeed {
  templateType: string;
  nameEn: string;
  nameAr: string;
  bodyEn: string;
  bodyAr: string;
}

const PROPOSAL_FORM_SKELETON_EN = (line: string) =>
  `[PLACEHOLDER — pending Underwriting/Compliance sign-off]\n\n` +
  `${line} Insurance Proposal Form\n` +
  `1. Applicant / policyholder details\n` +
  `2. Risk details specific to ${line.toLowerCase()} cover\n` +
  `3. Sum insured / coverage requested\n` +
  `4. Prior claims / loss history\n` +
  `5. Declarations and signature`;

const PROPOSAL_FORM_SKELETON_AR = (lineAr: string) =>
  `[نص مبدئي — بانتظار اعتماد إدارة الاكتتاب والامتثال]\n\n` +
  `نموذج طلب تأمين ${lineAr}\n` +
  `1. بيانات مقدم الطلب / حامل الوثيقة\n` +
  `2. تفاصيل الخطر الخاصة بتغطية ${lineAr}\n` +
  `3. مبلغ التأمين / التغطية المطلوبة\n` +
  `4. سجل المطالبات / الخسائر السابقة\n` +
  `5. الإقرارات والتوقيع`;

export const DOCUMENT_TEMPLATES: DocumentTemplateSeed[] = [
  {
    templateType: 'proposal_form_motor',
    nameEn: 'Motor Insurance Proposal Form',
    nameAr: 'نموذج طلب تأمين المركبات',
    bodyEn: PROPOSAL_FORM_SKELETON_EN('Motor'),
    bodyAr: PROPOSAL_FORM_SKELETON_AR('المركبات'),
  },
  {
    templateType: 'proposal_form_general',
    nameEn: 'General Insurance Proposal Form (Property/Liability/Marine)',
    nameAr: 'نموذج طلب تأمين عام (ممتلكات / مسؤولية / بحري)',
    bodyEn: PROPOSAL_FORM_SKELETON_EN('General'),
    bodyAr: PROPOSAL_FORM_SKELETON_AR('عام'),
  },
  {
    templateType: 'proposal_form_health',
    nameEn: 'Health Insurance Proposal Form (Group/Individual Medical)',
    nameAr: 'نموذج طلب التأمين الصحي (جماعي / فردي)',
    bodyEn: PROPOSAL_FORM_SKELETON_EN('Health'),
    bodyAr: PROPOSAL_FORM_SKELETON_AR('صحي'),
  },
  {
    templateType: 'proposal_form_life',
    nameEn: 'Life Insurance Proposal Form (Group/Individual Life)',
    nameAr: 'نموذج طلب التأمين على الحياة (جماعي / فردي)',
    bodyEn: PROPOSAL_FORM_SKELETON_EN('Life'),
    bodyAr: PROPOSAL_FORM_SKELETON_AR('على الحياة'),
  },
  /**
   * Part F item #7 — the first of `templateType`'s 6 real (non-proposal-
   * form) document types to get an actual seeded row. Editable boilerplate
   * prose only (Compliance/Customer Service can revise this without a code
   * change) — the per-complaint facts (reference, dates, category, SLA due
   * date) are real domain data merged in by
   * `apps/api/src/modules/customer-service/complaint-acknowledgement.template.ts`,
   * never stored here. `ComplaintAcknowledgementService` falls back to this
   * exact wording in code when no row exists yet (a fresh environment
   * before this seed has run) — kept identical so the seeded and
   * fallback-default text never silently diverge.
   */
  {
    templateType: 'complaint_acknowledgement',
    nameEn: 'Complaint Acknowledgement',
    nameAr: 'إشعار استلام شكوى',
    bodyEn:
      'Thank you for contacting us. We confirm that we have received your ' +
      'complaint and that it has been logged for review. Our team will ' +
      'investigate the matter and keep you informed of its progress.\n' +
      'We appreciate your patience and your continued trust in us.',
    bodyAr:
      'شكراً لتواصلكم معنا. نؤكد استلام شكواكم وتسجيلها للمراجعة. سيقوم ' +
      'فريقنا بدراسة الموضوع وإبقائكم على اطلاع بمستجداته.\n' +
      'نقدّر صبركم وثقتكم المستمرة بنا.',
  },
  /**
   * Part F item #7 — the second of `templateType`'s 6 real document types
   * to get an actual seeded row. Editable boilerplate prose only; the
   * per-comparison facts (customer, insurance line, the row table itself,
   * missing/declined insurers) are real domain data merged in by
   * `apps/api/src/modules/comparison/quotation-comparison.template.ts`,
   * never stored here. `QuotationComparisonDocumentService` falls back to
   * this exact wording in code when no row exists yet — kept identical so
   * the seeded and fallback-default text never silently diverge.
   */
  {
    templateType: 'quotation_comparison',
    nameEn: 'Quotation Comparison',
    nameAr: 'مقارنة عروض التأمين',
    bodyEn:
      'The following is a structured comparison of the quotations ' +
      'received for this insurance requirement. Coverage, exclusions, ' +
      'deductibles, limits, and insurer service quality have all been ' +
      'considered alongside price — this comparison should never be ' +
      'read on price alone.',
    bodyAr:
      'فيما يلي مقارنة منظّمة لعروض التأمين الواردة لهذا الطلب. تم النظر ' +
      'في التغطية والاستثناءات والتحملات وحدود التغطية وجودة خدمة شركة ' +
      'التأمين إلى جانب السعر — لا ينبغي قراءة هذه المقارنة بناءً على ' +
      'السعر فقط.',
  },
  /**
   * Part F item #7 — the third of `templateType`'s 6 real document types
   * to get an actual seeded row. Editable boilerplate prose only; the
   * per-recommendation facts (customer, insurer, premium, rationale, the
   * 6 factor notes, the COI disclosure text when flagged) are real
   * domain data merged in by
   * `apps/api/src/modules/recommendation/recommendation-report.template.ts`,
   * never stored here. `RecommendationReportDocumentService` falls back
   * to this exact wording in code when no row exists yet — kept
   * identical so the seeded and fallback-default text never silently
   * diverge.
   */
  {
    templateType: 'recommendation_report',
    nameEn: 'Recommendation Report',
    nameAr: 'تقرير التوصية',
    bodyEn:
      'Based on a structured comparison of the quotations received for ' +
      'this insurance requirement, we recommend the following. Our ' +
      'assessment considered coverage, price, insurer financial ' +
      'strength, claims service, deductible, and policy conditions ' +
      'together — never price alone.',
    bodyAr:
      'بناءً على مقارنة منظّمة لعروض التأمين الواردة لهذا الطلب، نوصي ' +
      'بما يلي. أخذ تقييمنا بعين الاعتبار التغطية والسعر والقوة المالية ' +
      'لشركة التأمين وخدمة المطالبات والتحمل وشروط الوثيقة معاً — وليس ' +
      'السعر فقط.',
  },
  /**
   * Part F item #7 — the fourth of `templateType`'s 6 real document types
   * to get an actual seeded row. Editable boilerplate prose only; the
   * per-policy facts (customer, insurer, policy number, premium, the
   * most recent coverage schedule's limits/sums insured/named perils/
   * extensions) are real domain data merged in by
   * `apps/api/src/modules/policy/policy-schedule-summary.template.ts`,
   * never stored here. `PolicyScheduleSummaryDocumentService` falls back
   * to this exact wording in code when no row exists yet — kept
   * identical so the seeded and fallback-default text never silently
   * diverge.
   */
  {
    templateType: 'policy_schedule_summary',
    nameEn: 'Policy Schedule Summary',
    nameAr: 'ملخص جدول الوثيقة',
    bodyEn:
      'This document summarizes the coverage currently in force under ' +
      'this policy, as recorded from the insurer-issued schedule. ' +
      'Please review the limits, sums insured, named perils and ' +
      'extensions below, and contact us promptly if anything does not ' +
      'match your requirements.',
    bodyAr:
      'يلخّص هذا المستند التغطية السارية حالياً بموجب هذه الوثيقة، كما ' +
      'وردت في الجدول الصادر عن شركة التأمين. يرجى مراجعة الحدود ' +
      'ومبالغ التأمين والأخطار المسماة والامتدادات أدناه، والتواصل ' +
      'معنا فوراً في حال وجود أي تعارض مع متطلباتكم.',
  },
  /**
   * Part F item #7 — the fifth of `templateType`'s 6 real document types
   * to get an actual seeded row. Editable boilerplate prose only; the
   * per-invoice facts (customer, policy, premium/tax/fees/total, due
   * date, status, the client's own collection receipt) are real domain
   * data merged in by
   * `apps/api/src/modules/finance/invoice-document.template.ts`, never
   * stored here. Deliberately excludes commission/remittance figures — a
   * flagged content decision, see that template's own header comment.
   * `InvoiceDocumentService` falls back to this exact wording in code
   * when no row exists yet — kept identical so the seeded and
   * fallback-default text never silently diverge.
   */
  {
    templateType: 'invoice',
    nameEn: 'Premium Invoice',
    nameAr: 'فاتورة قسط التأمين',
    bodyEn:
      'This is your invoice for the insurance premium below. Please ' +
      'arrange payment by the due date shown. Contact us promptly if ' +
      'you have any questions about this invoice.',
    bodyAr:
      'هذه فاتورتكم لقسط التأمين المبيّن أدناه. يرجى ترتيب السداد قبل ' +
      'تاريخ الاستحقاق المذكور. يرجى التواصل معنا فوراً في حال وجود أي ' +
      'استفسار بخصوص هذه الفاتورة.',
  },
  /**
   * Part F item #7 — the sixth and final of `templateType`'s 6 real
   * document types to get an actual seeded row. Editable boilerplate
   * prose only; the per-policy facts (insured, policy number, insurer,
   * insurance line, period, sum insured) are real domain data merged in
   * by
   * `apps/api/src/modules/policy/certificate-of-insurance.template.ts`,
   * never stored here. A genuine Certificate of Insurance convention —
   * deliberately NOT the same content as `policy_schedule_summary`
   * (short proof-of-coverage, no premium/tax/commission figures at all).
   * `CertificateOfInsuranceDocumentService` falls back to this exact
   * wording in code when no row exists yet — kept identical so the
   * seeded and fallback-default text never silently diverge.
   */
  {
    templateType: 'certificate_of_insurance',
    nameEn: 'Certificate of Insurance',
    nameAr: 'شهادة تأمين',
    bodyEn:
      'This certificate is issued as a summary of coverage currently in ' +
      'force and is not evidence of a contract of insurance — the ' +
      'policy wording governs. Please contact us promptly if any detail ' +
      'below does not match your requirements.',
    bodyAr:
      'تصدر هذه الشهادة كملخص للتغطية السارية حالياً وليست دليلاً على ' +
      'عقد التأمين — تحكمها شروط الوثيقة. يرجى التواصل معنا فوراً في ' +
      'حال وجود أي تعارض بين ما ورد أدناه ومتطلباتكم.',
  },
];
