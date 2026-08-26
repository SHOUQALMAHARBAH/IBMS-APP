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
];
