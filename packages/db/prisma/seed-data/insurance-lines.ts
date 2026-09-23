/**
 * The 32 standard insurance lines — the managed half of the insurance-line
 * vocabulary.
 *
 * ## What this list is, and what it is not
 *
 * It is a PRACTICAL MARKET CLASSIFICATION, not a regulatory citation. The Central
 * Bank of Jordan regulates the sector but publishes only the general/life split that
 * `InsuranceLineCategory` carries; everything below that level is how the market
 * actually names its products. So this file is seed data an office extends, never an
 * authority — an office that needs a line this list does not have adds it, and does
 * not wait for a release.
 *
 * ## Why all 32 are seeded and none are trimmed
 *
 * A line nobody sells today may be asked for tomorrow, and a broader list makes
 * directory search more useful rather than heavier: an office searching for who
 * writes Plate Glass gets an answer, instead of finding that the vocabulary never
 * had the word. The cost of a row nobody picks is zero.
 *
 * ## Two modelling decisions visible in the list
 *
 * **Engineering is FOUR lines, not one.** Contractors' All Risks, Erection All
 * Risks, Machinery Breakdown and Electronic Equipment are different products for
 * different clients — a contractor needs CAR, a factory installing machinery needs
 * EAR, a running factory needs Machinery Breakdown, an office needs Electronic
 * Equipment — and an insurer may write one and not another. Merging them would make
 * a directory search return wrong answers. They share a name prefix, which groups
 * them visually without needing a data hierarchy.
 *
 * **Takaful is not in this list at all.** It is a structure, carried by
 * `Insurer.structure`, not a parallel set of products. Doubling 32 entries to 64
 * would break vocabulary search for no gain: a client needing Sharia-compliant motor
 * cover wants Motor Comprehensive from a takaful company, not a different line.
 *
 * ## One inconsistency inside the list, SEEN and left alone
 *
 * The 32 split life into `LIFE_INDIVIDUAL` and `LIFE_GROUP` but give medical a single
 * `MEDICAL_HEALTH` — so the group/individual distinction exists on one side of the
 * general/life split and not the other. That is an inconsistency in the classification, and it
 * is recorded here so the next reader knows it was noticed rather than missed.
 *
 * Deliberately not fixed. Once a variant axis exists on the models that need the distinction
 * (a policy, a commission agreement), splitting the line adds nothing behavioural — and it
 * would cost the owner a decision already made about a settled list. A segment promoted to its
 * own line also stops appearing under its parent in the directory, which is the opposite of
 * what the directory is for: a company writing only group medical should still answer "who
 * writes medical?".
 *
 * ## The `code` is the identity
 *
 * `id` is a uuid generated per database, so it means something different in dev,
 * test and production. `code` is stable, unique platform-wide, and is what the seed
 * upserts on and what a report groups by. Renaming a line means editing `nameEn` /
 * `nameAr` here; changing a `code` orphans every row that referenced it, so do not.
 */
export interface InsuranceLineSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  category: "GENERAL" | "LIFE";
}

/** In the order the market names them, which is neither alphabetical nor by code.
 *  `displayOrder` is assigned from this array's index, so reordering here reorders
 *  every picker. */
export const INSURANCE_LINES: InsuranceLineSeed[] = [
  // --- التأمينات العامة / General -----------------------------------------
  {
    code: "MOTOR_TPL_COMPULSORY",
    nameEn: "Motor Third-Party Liability (Compulsory)",
    nameAr: "تأمين المركبات الإلزامي (ضد الغير)",
    category: "GENERAL",
  },
  {
    code: "MOTOR_COMPREHENSIVE",
    nameEn: "Motor Comprehensive",
    nameAr: "تأمين المركبات الشامل",
    category: "GENERAL",
  },
  {
    code: "MEDICAL_HEALTH",
    nameEn: "Medical / Health",
    nameAr: "التأمين الصحي / الطبي",
    category: "GENERAL",
  },
  {
    code: "FIRE_ALLIED_PERILS",
    nameEn: "Fire & Allied Perils",
    nameAr: "تأمين الحريق والأخطار الإضافية",
    category: "GENERAL",
  },
  {
    code: "PROPERTY_ALL_RISKS",
    nameEn: "Property All Risks",
    nameAr: "تأمين جميع أخطار الممتلكات",
    category: "GENERAL",
  },
  {
    code: "BUSINESS_INTERRUPTION",
    nameEn: "Business Interruption",
    nameAr: "تأمين فقدان الأرباح / توقف الأعمال",
    category: "GENERAL",
  },
  {
    code: "MARINE_CARGO",
    nameEn: "Marine Cargo",
    nameAr: "التأمين البحري — بضائع",
    category: "GENERAL",
  },
  {
    code: "MARINE_HULL",
    nameEn: "Marine Hull",
    nameAr: "التأمين البحري — أجسام السفن",
    category: "GENERAL",
  },
  {
    code: "AVIATION",
    nameEn: "Aviation",
    nameAr: "تأمين الطيران",
    category: "GENERAL",
  },
  // The four engineering lines. Separate products, shared prefix — see the header.
  {
    code: "ENGINEERING_CAR",
    nameEn: "Contractors' All Risks (CAR)",
    nameAr: "التأمين الهندسي — كل أخطار المقاولين",
    category: "GENERAL",
  },
  {
    code: "ENGINEERING_EAR",
    nameEn: "Erection All Risks (EAR)",
    nameAr: "التأمين الهندسي — كل أخطار التركيب",
    category: "GENERAL",
  },
  {
    code: "ENGINEERING_MACHINERY_BREAKDOWN",
    nameEn: "Machinery Breakdown",
    nameAr: "التأمين الهندسي — عطل الآلات",
    category: "GENERAL",
  },
  {
    code: "ENGINEERING_ELECTRONIC_EQUIPMENT",
    nameEn: "Electronic Equipment",
    nameAr: "التأمين الهندسي — المعدات الإلكترونية",
    category: "GENERAL",
  },
  {
    code: "PUBLIC_GENERAL_LIABILITY",
    nameEn: "Public / General Liability",
    nameAr: "تأمين المسؤولية المدنية العامة",
    category: "GENERAL",
  },
  {
    code: "PROFESSIONAL_INDEMNITY",
    nameEn: "Professional Indemnity",
    nameAr: "تأمين المسؤولية المهنية",
    category: "GENERAL",
  },
  {
    code: "PRODUCT_LIABILITY",
    nameEn: "Product Liability",
    nameAr: "تأمين مسؤولية المنتجات",
    category: "GENERAL",
  },
  {
    code: "WORKMEN_COMPENSATION_EMPLOYER_LIABILITY",
    nameEn: "Workmen's Compensation / Employer's Liability",
    nameAr: "تأمين إصابات العمل / مسؤولية أصحاب العمل",
    category: "GENERAL",
  },
  {
    code: "PERSONAL_ACCIDENT",
    nameEn: "Personal Accident",
    nameAr: "تأمين الحوادث الشخصية",
    category: "GENERAL",
  },
  {
    code: "TRAVEL",
    nameEn: "Travel",
    nameAr: "تأمين السفر",
    category: "GENERAL",
  },
  {
    code: "MONEY",
    nameEn: "Money (Cash in Safe / in Transit)",
    nameAr: "تأمين الأموال (نقد بالصندوق / بالطريق)",
    category: "GENERAL",
  },
  {
    code: "FIDELITY_GUARANTEE",
    nameEn: "Fidelity Guarantee",
    nameAr: "تأمين خيانة الأمانة",
    category: "GENERAL",
  },
  {
    code: "BURGLARY_THEFT",
    nameEn: "Burglary & Theft",
    nameAr: "تأمين السرقة والسطو",
    category: "GENERAL",
  },
  {
    code: "PLATE_GLASS",
    nameEn: "Plate Glass",
    nameAr: "تأمين الزجاج",
    category: "GENERAL",
  },
  {
    code: "CREDIT",
    nameEn: "Credit",
    nameAr: "تأمين الائتمان",
    category: "GENERAL",
  },
  {
    code: "BONDS_SURETY",
    nameEn: "Bonds / Surety",
    nameAr: "الكفالات / عقود الضمان",
    category: "GENERAL",
  },
  {
    code: "CYBER",
    nameEn: "Cyber",
    nameAr: "التأمين السيبراني",
    category: "GENERAL",
  },
  {
    code: "AGRICULTURAL",
    nameEn: "Agricultural",
    nameAr: "التأمين الزراعي",
    category: "GENERAL",
  },
  // --- تأمينات الحياة / Life ----------------------------------------------
  {
    code: "LIFE_INDIVIDUAL",
    nameEn: "Individual Life",
    nameAr: "تأمين الحياة الفردي",
    category: "LIFE",
  },
  {
    code: "LIFE_GROUP",
    nameEn: "Group Life",
    nameAr: "تأمين الحياة الجماعي",
    category: "LIFE",
  },
  {
    code: "LIFE_CREDIT",
    nameEn: "Credit Life",
    nameAr: "تأمين حماية القروض / ائتمان الحياة",
    category: "LIFE",
  },
  {
    code: "LIFE_SAVINGS_INVESTMENT",
    nameEn: "Savings / Investment-Linked",
    nameAr: "تأمين الادخار والاستثمار",
    category: "LIFE",
  },
  {
    code: "LIFE_PENSION_ANNUITY",
    nameEn: "Pension / Annuity",
    nameAr: "تأمين التقاعد / الدفعات السنوية",
    category: "LIFE",
  },
];
