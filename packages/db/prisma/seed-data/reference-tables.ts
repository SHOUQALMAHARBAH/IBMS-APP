/**
 * Module 0-ب item (c) — the eight PROVIDER-MAINTAINED reference tables.
 *
 * ## Why these eight are tables and the other four are enums
 *
 * The owner's test, and it is NOT "closed set versus open set":
 *
 *   > Does any code path branch on the value? If the code branches on it, it stays an enum,
 *   > because a new row would create a state no code path handles — and that failure is silent.
 *   > If the code only displays, stores and filters it, it becomes a seeded table, because it
 *   > will grow without us and every growth must not require a release.
 *
 * Nothing branches on a bank, a city, a country, a currency, a licensing authority, a rating
 * agency, a legal form or a business model. They are stored, displayed and filtered. A new bank
 * opens in Jordan and nobody should wait for a deploy.
 *
 * And the referential-integrity half of the field dictionary's note R17 is satisfied either way —
 * the owner's words: *"an FK to a seeded row is a stronger guarantee than a string compared
 * against an enum, not a weaker one."*
 *
 * ## PLATFORM-scoped, every one
 *
 * An office adds no bank and no city. That is the whole difference from `OfficeInsuranceLine`,
 * where an office's own vocabulary IS genuinely its own. These are maintained by the provider, so
 * they carry no `organizationId` and are not in `TENANT_SCOPED_MODELS`.
 *
 * ## The shape is `InsuranceLine`'s, deliberately
 *
 * `code @unique`, `nameEn`, `nameAr`, `displayOrder` — so module 1's legal-values table becomes the
 * ninth of the same family rather than a second pattern. Upserted on `code`, never on the uuid:
 * each database generates its own ids, so a re-seed recognises a row by the one value stable
 * across all of them. `displayOrder` comes from the array index, so reordering a list here
 * reorders every picker and nothing else.
 *
 * ## "A seed row that is a placeholder is worse than a short list"
 *
 * The owner's instruction, and it is why there is no `OTHER`, no `TBD` and no padding below. Every
 * row names a real thing. Where a list is genuinely incomplete it says so in its own comment
 * rather than inventing a filler row — and because these are tables, the cure is a row rather than
 * a release.
 */

export interface ReferenceSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  /**
   * Arabic explanation of what this value MEANS — required only where the value carries a RULE the
   * name does not convey, and absent everywhere else.
   *
   * The owner's reasoning, and it is why this is optional rather than on all eight: "a city, a bank
   * and a country are satisfied by their Arabic name — the name IS the Arabic, and a description
   * there would only restate it, which trains people to stop reading descriptions at exactly the
   * point where one matters."
   *
   * `LegalForm` and `BusinessModel` carry one on every row, enforced by a CHECK rather than by this
   * type — a convention is satisfied by the seed and then broken by the first row added through a
   * screen.
   *
   * MEASURED, because the owner named four rule-bearing vocabularies and only TWO are tables:
   * `BrokerageKind` and `IntegrationMethod` are ENUMS with no row to hang this on, and their Arabic
   * lives in `apps/web/lib/i18n/translations/enums.ts`.
   */
  descriptionAr?: string;
}

/**
 * Countries. Jordan alone, and that is "minimal and real" rather than an oversight.
 *
 * A foreign country IS representable — art. 10/a/1/b contemplates a branch of a foreign company,
 * and an insurer may be foreign — but seeding a world list would be padding, and the provider adds
 * the one it needs as a row. That is precisely what makes this a table.
 */
export const COUNTRIES: ReferenceSeed[] = [
  { code: "JO", nameEn: "Jordan", nameAr: "الأردن" },
];

/**
 * Jordan's twelve governorates, by their capitals — the administrative division an address is
 * actually recorded against. Ordered as the Department of Statistics orders them: the three
 * northern, then central, then southern.
 */
export const CITIES: ReferenceSeed[] = [
  { code: "AMMAN", nameEn: "Amman", nameAr: "عمّان" },
  { code: "IRBID", nameEn: "Irbid", nameAr: "إربد" },
  { code: "ZARQA", nameEn: "Zarqa", nameAr: "الزرقاء" },
  { code: "BALQA", nameEn: "Balqa (Salt)", nameAr: "البلقاء (السلط)" },
  { code: "MAFRAQ", nameEn: "Mafraq", nameAr: "المفرق" },
  { code: "JERASH", nameEn: "Jerash", nameAr: "جرش" },
  { code: "AJLOUN", nameEn: "Ajloun", nameAr: "عجلون" },
  { code: "MADABA", nameEn: "Madaba", nameAr: "مادبا" },
  { code: "KARAK", nameEn: "Karak", nameAr: "الكرك" },
  { code: "TAFILAH", nameEn: "Tafilah", nameAr: "الطفيلة" },
  { code: "MAAN", nameEn: "Ma'an", nameAr: "معان" },
  { code: "AQABA", nameEn: "Aqaba", nameAr: "العقبة" },
];

/**
 * Jordanian licensed banks.
 *
 * ## THE LIMIT OF THIS LIST, STATED RATHER THAN IMPLIED
 *
 * These are the Jordanian banks operating in the Kingdom as known at the time of writing. It is
 * NOT transcribed from a CBJ register that this repository holds — no such file is in the repo —
 * so treat it as a working list to be checked against the Central Bank's published register, not
 * as an authority.
 *
 * That is survivable precisely because this is a table: a bank missing here is a row the provider
 * adds, and a bank that merges or closes is a row the provider edits. Had this been an enum, every
 * one of those would be a release, which is the whole argument for the shape.
 *
 * Branches of foreign banks operating in Jordan are deliberately omitted rather than half-listed.
 */
export const BANKS: ReferenceSeed[] = [
  { code: "ARAB_BANK", nameEn: "Arab Bank", nameAr: "البنك العربي" },
  {
    code: "HOUSING_BANK",
    nameEn: "Housing Bank for Trade and Finance",
    nameAr: "بنك الإسكان للتجارة والتمويل",
  },
  { code: "BANK_OF_JORDAN", nameEn: "Bank of Jordan", nameAr: "بنك الأردن" },
  {
    code: "JORDAN_AHLI_BANK",
    nameEn: "Jordan Ahli Bank",
    nameAr: "البنك الأهلي الأردني",
  },
  {
    code: "CAIRO_AMMAN_BANK",
    nameEn: "Cairo Amman Bank",
    nameAr: "بنك القاهرة عمّان",
  },
  {
    code: "JORDAN_KUWAIT_BANK",
    nameEn: "Jordan Kuwait Bank",
    nameAr: "البنك الأردني الكويتي",
  },
  { code: "BANK_AL_ETIHAD", nameEn: "Bank al Etihad", nameAr: "بنك الاتحاد" },
  {
    code: "CAPITAL_BANK",
    nameEn: "Capital Bank of Jordan",
    nameAr: "كابيتال بنك",
  },
  {
    code: "ARAB_JORDAN_INVESTMENT_BANK",
    nameEn: "Arab Jordan Investment Bank",
    nameAr: "بنك الاستثمار العربي الأردني",
  },
  {
    code: "INVEST_BANK",
    nameEn: "InvestBank",
    nameAr: "بنك الاستثمار",
  },
  {
    code: "ABC_BANK_JORDAN",
    nameEn: "Arab Banking Corporation (Jordan)",
    nameAr: "بنك المؤسسة العربية المصرفية (الأردن)",
  },
  // Islamic banks — a separate licence category at the CBJ, and the distinction matters to a
  // takaful-writing office, so they are named rather than folded in.
  {
    code: "JORDAN_ISLAMIC_BANK",
    nameEn: "Jordan Islamic Bank",
    nameAr: "البنك الإسلامي الأردني",
  },
  {
    code: "ISLAMIC_INTERNATIONAL_ARAB_BANK",
    nameEn: "Islamic International Arab Bank",
    nameAr: "البنك العربي الإسلامي الدولي",
  },
  {
    code: "SAFWA_ISLAMIC_BANK",
    nameEn: "Safwa Islamic Bank",
    nameAr: "بنك صفوة الإسلامي",
  },
];

/**
 * Currencies.
 *
 * JOD is the base — `money-decimal-jod` and every `Decimal(18,3)` in this schema exist because the
 * dinar divides into 1000 fils. USD and EUR are seeded beside it because reinsurance placements and
 * some marine and aviation covers are denominated in them, so an office that cannot name them
 * cannot record the business it actually writes.
 *
 * Nothing in this module converts between them, and no rate table exists. The currency is RECORDED,
 * not arithmetic — stated here so nobody reads three rows as a multi-currency capability.
 *
 * ## A NON-JOD VALUE HAS NO CONVERSION PATH, AND NO AMOUNT IN ONE MAY BE COMPARED TO A THRESHOLD
 *
 * Read this before writing any comparison between a stored amount and a legal threshold.
 *
 * EVERY threshold in Instructions No. 9 of 2026 is denominated in Jordanian dinars — the art. 4/a
 * capital slabs (5,000 / 7,500 / 10,000 per type), the 50,000 in art. 13/b/2, and the 2,000 in
 * art. 15/d that exempts a placement from the three-insurer minimum.
 *
 * So an amount recorded in USD or EUR CANNOT be tested against any of them. Comparing 3,000 dollars
 * to 2,000 dinars as bare numbers would have the system reach a REGULATORY CONCLUSION from an
 * invalid comparison — granting the art. 15/d exemption where it does not apply, or refusing it
 * where it does. That is the same class as the provider being reported an unlicensed office: a
 * true-sounding statement produced by comparing the wrong things.
 *
 * Conversion needs two things this system does not hold: a RATE, and the DATE the rate was taken.
 * A rate without its date is useless to an audit two years later.
 *
 * NOT BUILT — module 14. See `docs/deferred-register.md`, which also carries the question that
 * SIZES that work and must be asked at module 14's OPENING rather than during it: whether
 * offices write policies in foreign currency at all. If they do not, this shrinks to a
 * reinsurance reference; either way the answer shapes the build instead of correcting it.
 */
export const CURRENCIES: ReferenceSeed[] = [
  { code: "JOD", nameEn: "Jordanian Dinar", nameAr: "دينار أردني" },
  { code: "USD", nameEn: "US Dollar", nameAr: "دولار أمريكي" },
  { code: "EUR", nameEn: "Euro", nameAr: "يورو" },
];

/**
 * Licensing authorities. One row, because for insurance brokerage in Jordan there is one.
 *
 * The Central Bank of Jordan took over insurance supervision; the field dictionary's own example
 * names it, and Instructions No. 9 of 2026 are issued by it under arts. 82/a and 109/b of Law No.
 * 12 of 2021. A foreign regulator would be a row, added when a foreign-licensed entity is first
 * registered.
 */
export const LICENSING_AUTHORITIES: ReferenceSeed[] = [
  {
    code: "CBJ",
    nameEn: "Central Bank of Jordan",
    nameAr: "البنك المركزي الأردني",
  },
];

/**
 * Credit rating agencies — the four whose ratings an insurer actually quotes. The field
 * dictionary's example is AM Best.
 *
 * Only ever read beside `Insurer.financialStrengthRating`, which stays OFFICE-SCOPED: what it holds
 * is the rating THIS office recorded in discharging its duty of care when selecting an insurer, not
 * a fact about the company. See `docs/decision-insurer-field-split.md`.
 */
export const RATING_AGENCIES: ReferenceSeed[] = [
  { code: "AM_BEST", nameEn: "AM Best", nameAr: "إيه إم بست" },
  {
    code: "SP_GLOBAL",
    nameEn: "S&P Global Ratings",
    nameAr: "إس آند بي جلوبال للتصنيف",
  },
  { code: "MOODYS", nameEn: "Moody's", nameAr: "موديز" },
  { code: "FITCH", nameEn: "Fitch Ratings", nameAr: "فيتش للتصنيف" },
];

/**
 * Legal forms, from the field dictionary's reference tab — PLUS ONE THE SHEET DOES NOT HAVE.
 *
 * ## `SOLE_ESTABLISHMENT` is added, with its citation, and that is a finding
 *
 * The sheet lists five: public shareholding, private shareholding, limited liability, general
 * partnership, limited partnership. All five are companies.
 *
 * But art. 10/a/1/a of Instructions No. 9 of 2026 requires an applicant licensed as a NATURAL
 * PERSON broker to be registered as a sole establishment (مؤسسة فردية), and `BrokerKind` already
 * has `NATURAL_PERSON` as one of its two values. Seeding the sheet's five alone would make a
 * natural-person broker — half of the kinds this system models — unregisterable, which is the
 * unreachable-precondition shape this project has shipped once already.
 *
 * So it is seeded with the article named. Flagged here rather than slipped in, because it is the
 * one row below that the owner's source document does not contain.
 */
export const LEGAL_FORMS: ReferenceSeed[] = [
  {
    code: "SOLE_ESTABLISHMENT",
    nameEn: "Sole establishment",
    nameAr: "مؤسسة فردية",
    descriptionAr:
      "الشكل القانوني لوسيط التأمين الطبيعي. المادة 10/أ/1/أ من تعليمات رقم (9) لسنة 2026 تشترط تسجيل طالب الترخيص كوسيط تأمين طبيعي كمؤسسة فردية. ولا يجوز لهذا الشكل فتح أكثر من خمسة فروع (المادة 13/ب).",
  },
  {
    /*
     * MODULE 0-ب ITEM (e) — art. 10/a/1/b's SECOND corporate shape, and the dictionary's own list
     * does not carry it.
     *
     * The article accepts a corporate broker registered «كشركةٍ أو فرعٍ لشركةٍ أجنبيةٍ عاملةٍ حسب
     * مقتضى الحال» — as a company OR as a branch of a foreign company operating in the Kingdom. The
     * six forms the dictionary lists are all the first kind, so a foreign company's branch was
     * unregisterable: a precondition nothing could satisfy, which is the § 1.62 shape this project
     * has shipped once already.
     *
     * A SEEDED ROW AND NOT A MIGRATION, which was measured before being instructed: `legalForm` is a
     * reference TABLE (`Organization.legalFormId` -> `LegalForm`), there is no `enum LegalForm`
     * anywhere, and zero `Organization` rows named a legal form at the time. So this reaches both
     * databases through the seed, with no schema change and no `ALTER TYPE`.
     */
    code: "FOREIGN_COMPANY_BRANCH",
    nameEn: "Branch of a foreign company operating in the Kingdom",
    nameAr: "فرع لشركة أجنبية عاملة",
    descriptionAr:
      "شكلٌ قانونيٌّ للوسيط الاعتباري: فرعٌ لشركةٍ أجنبيةٍ عاملةٍ في المملكة. وسندُه المادة (١٠/أ/١/ب) من تعليمات ترخيص وسيط التأمين رقم (٩) لسنة ٢٠٢٦، التي تُوجب أن يكون مقدّمُ طلبِ الترخيص كوسيطٍ اعتباريٍّ مسجَّلاً «كشركةٍ أو فرعٍ لشركةٍ أجنبيةٍ عاملةٍ حسب مقتضى الحال». ولا يُختار هذا الشكلُ لوسيطٍ طبيعيٍّ، لأنّ المادة (١٠/أ/١/أ) تُوجب تسجيلَه مؤسسةً فردية.",
  },
  {
    code: "PUBLIC_SHAREHOLDING",
    nameEn: "Public shareholding company",
    nameAr: "شركة مساهمة عامة",
    descriptionAr:
      "شركة مساهمة عامة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.",
  },
  {
    code: "PRIVATE_SHAREHOLDING",
    nameEn: "Private shareholding company",
    nameAr: "شركة مساهمة خاصة",
    descriptionAr:
      "شركة مساهمة خاصة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.",
  },
  {
    code: "LIMITED_LIABILITY",
    nameEn: "Limited liability company",
    nameAr: "شركة ذات مسؤولية محدودة",
    descriptionAr:
      "شركة ذات مسؤولية محدودة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.",
  },
  {
    code: "GENERAL_PARTNERSHIP",
    nameEn: "General partnership",
    nameAr: "شركة تضامن",
    descriptionAr:
      "شركة تضامن. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع.",
  },
  {
    code: "LIMITED_PARTNERSHIP",
    nameEn: "Limited partnership",
    nameAr: "شركة توصية بسيطة",
    descriptionAr:
      "شركة توصية بسيطة. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع.",
  },
];

/**
 * Business models — conventional and takaful.
 *
 * ## NOTHING MAY BRANCH ON THIS VALUE. That is the design, not an accident.
 *
 * The field dictionary says the business model "affects the wording of quotations and policies and
 * their terminology", which sounds like a branch and by the owner's own rule would make it an enum.
 * The rule is satisfied differently and deliberately here: where terminology differs, the
 * difference lives in TEMPLATE ROWS keyed to the model row — data, not an `if`. A third business
 * model is then a row plus its templates, not a release.
 *
 * If you find yourself writing `if (model === 'TAKAFUL')`, stop: that is the signal the design was
 * lost.
 */
export const BUSINESS_MODELS: ReferenceSeed[] = [
  {
    code: "CONVENTIONAL",
    nameEn: "Conventional insurance",
    nameAr: "تأمين تقليدي",
    descriptionAr:
      "نمط النشاط التقليدي. يحدّد صياغة العروض والوثائق ومصطلحاتها، وتُشتقّ هذه الصياغة من قوالب مرتبطة بهذا السطر — لا من شرط في الشيفرة، حتى يكون إدخال نمط ثالث سطراً وقوالبَ لا إصداراً جديداً.",
  },
  {
    code: "TAKAFUL",
    nameEn: "Takaful insurance",
    nameAr: "تأمين تكافلي",
    descriptionAr:
      "نمط النشاط التكافلي. يحدّد صياغة العروض والوثائق ومصطلحاتها (اشتراك بدل قسط، وفائض بدل ربح)، وتُشتقّ من قوالب مرتبطة بهذا السطر لا من شرط في الشيفرة. قوالب المصطلحات التكافلية لم تُبنَ بعد — انظر سجلّ المؤجَّل.",
  },
];
