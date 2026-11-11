// THE LEGAL-VALUES CATALOGUE — one row per figure a legal instrument states or defers.
//
// OWNER DECISION 123 (third form): **a figure the instrument STATES is seeded by us with its
// article; only a figure the instrument DEFERS to a ruling not yet issued is supplied by the
// office.** The earlier forms of that decision rested on eight figures believed unreadable in our
// scanned copy — they are all readable, read off the page images on 10-11 November 2026 — so the
// split is no longer *can we read it* but *has the Central Bank issued it*.
//
// ## WHY A SEPARATE TABLE AND NOT `SlaPolicy`, AND NOT THE NINTH REFERENCE TABLE
//
// Recorded as a departure from the intention of 12 October («التاسع من عائلة الجداول المرجعية، لا
// نمطاً ثانياً» — the ninth of the reference-table family, not a second pattern), with the three
// measured reasons, because the paper and the schema must not disagree in silence:
//
//   1. `SlaPolicy` is TENANT-SCOPED — `organizationId String @default(dbgenerated())`, NOT NULL —
//      so a provider-owned row cannot exist in it at all. Decision 123's whole subject is WHOSE
//      row this is, and that table can only answer "the office's".
//   2. Its `@@unique([organizationId, policyCode])` stops a superseded value sitting beside its
//      replacement, which directly contradicts criterion 3 (*read an old transaction and it
//      computes at the value in force on its own day*). The uniqueness here is PARTIAL, on
//      `effectiveTo IS NULL`, so history accumulates and one row is current.
//   3. The eight reference tables are provider-owned and global, and carry NEITHER dated history
//      NOR a citation. A `Country` row has no article and no effective date; a legal value is
//      nothing without both. Extending that family would have meant adding four columns to eight
//      tables that do not want them.
//
// The four nullable-pair precedents (`BrokerLicenseScopeLine`, `EmployeeCbjApprovalBranch`,
// `RoleScopeBranch`, `RegulatoryActionScopeLine`) are why a nullable tenant column is not a second
// pattern either: this repository already expresses "either the provider's or the office's" that
// way, four times.
//
// ## THE FIGURES BELOW ARE READ OFF THE PAGE IMAGES, NOT OFF THE OCR
//
// `docs/legal/cbj-instructions-9-2026-source-text.md` is an OCR extraction and its head marker
// records that it publishes TWO WRONG figures marked «موثوق» — art. 4/a/2 as 7,000 where the
// instrument says ٧٬٥٠٠, and art. 4/a/1 as 5 branches where it says ٦ — because its stated
// reliability rule reads a Latin-digit OUTPUT as evidence of a Latin-digit INPUT. **Never take a
// figure from that file.** Every `printedPage` below is the page of the scanned instrument the
// owner read it on.
//
// ## MONEY IS A STRING HERE, DELIBERATELY
//
// `ibms-brain/meta/lex/money-decimal-jod.md` forbids a JOD figure as a JavaScript number. The
// amounts are strings and reach the database as `Decimal(18,3)`. That is also what hid art. 4/a's
// five figures from `check:legal-numbers` until 2026-11-10 — the right rule for money hiding the
// figures from the right rule for legal numbers — so the gate reads structured literals now.

/** What the figure IS, which decides which value column it occupies. */
export type LegalValueKind =
  | "MONEY_JOD"
  | "COUNT"
  | "CALENDAR_DAYS"
  | "YEARS"
  | "PERCENT"
  | "DATE"
  | "TEXT_LIST";

/**
 * WHOSE ROW IT IS — decision 123's third form, and the only thing that decides whether we may
 * supply a value.
 *
 * Stored in the database as `organizationId IS NULL` (provider) or NOT NULL (an office's), never as
 * a column of its own: one fact, one home. This type exists so the CATALOGUE can say which codes
 * each side owns, which is what the parity spec pins.
 */
export type LegalValueOwner = "PROVIDER" | "OFFICE";

export interface LegalValueCatalogueEntry {
  /** Stable, quotable identifier. Named after the FACT, never after the article, because an
   *  article number can be renumbered by a later instrument while the fact survives. */
  code: string;
  owner: LegalValueOwner;
  kind: LegalValueKind;
  /** English only. No screen ships in this batch and no Arabic is invented — every string a person
   *  will read goes to the owner as a table first (message 35 §6). */
  name: string;
  /** The instrument's own article designation, as printed. */
  article: string;
  instrument: string;
  /** The printed page of the scanned instrument the figure was READ on. Null only for an
   *  OFFICE-owned code, where there is no figure of ours to cite. */
  printedPage: number | null;
  /** The value, as the instrument states it. `null` for every OFFICE-owned code: the Central Bank
   *  has issued none of them, so the row ships with its shape and its guards and NO value, and an
   *  empty field is DORMANT (criterion 6) — never a zero, never an exemption, never an alert. */
  value: string | null;
  /** Why this code exists and what reads it. */
  note: string;
}

const INSTR = "CBJ Instructions No. 9 of 2026";

/**
 * SEEDED IN THIS BATCH: the instrument's own figures only, each read from the page image.
 *
 * **Every figure below is stated by CBJ Instructions No. 9 of 2026** — arts. 1, 4/a, 11, 13/b/2,
 * 14/c, 15/d, 15/d/4, 21/a/12 and 22/m — and each entry carries its own article and the printed page
 * it was read on. The citation is HERE, on the declaration, and not only in the file header: a
 * reader who opens this array must meet the instrument's name without scrolling, and
 * `check:legal-numbers` reads a declaration's OWN comment block, so a citation two declarations up
 * is a citation the gate cannot attribute. That exact defect is what hid art. 4/a's five figures
 * from it until 2026-11-10.
 *
 * Deliberately NOT here — the contract-law deadlines, the motor reference values and the rest of
 * the module paper's §4.2 list. Each arrives with the module that reads it: **a row nothing reads
 * is a row nobody tests.**
 */
export const LEGAL_VALUES: LegalValueCatalogueEntry[] = [
  {
    code: "INSTRUMENT_EFFECTIVE_DATE",
    owner: "PROVIDER",
    kind: "DATE",
    name: "Date Instructions No. 9 of 2026 came into force",
    article: "art. 1",
    instrument: INSTR,
    printedPage: 3,
    value: "2026-06-24",
    note:
      "The instrument's own commencement. Called the most important missing number in the whole " +
      "instrument while the OCR could not read it; read off the page image as 24/6/2026.",
  },

  // ── ART. 4/a — THE CAPITAL BANDS. Five figures: three amounts and two branch boundaries. ──
  //
  // `CAPITAL_BANDS` in `broker-license-scope.config.ts` is rebuilt from these five rows. The band
  // boundaries are rows in their own right rather than being implied by the amounts' order,
  // because «حتى ٦ فروع» is a figure the instrument states and a reader must be able to cite it.
  {
    code: "CAPITAL_MIN_JOD_BAND_1",
    owner: "PROVIDER",
    kind: "MONEY_JOD",
    name: "Minimum paid-up capital, up to the first branch boundary",
    article: "art. 4/a/1",
    instrument: INSTR,
    printedPage: 5,
    value: "5000",
    note: "Read as ٥٬٠٠٠ on the page image.",
  },
  {
    code: "CAPITAL_MAX_BRANCHES_BAND_1",
    owner: "PROVIDER",
    kind: "COUNT",
    name: "Highest branch count still inside the first capital band",
    article: "art. 4/a/1",
    instrument: INSTR,
    printedPage: 5,
    value: "6",
    note:
      "SIX. The OCR extraction publishes 5 here and marks it «رقمٌ لاتينيٌّ ومن ثمّ موثوق»; the " +
      "instrument draws it in Arabic-Indic as ٦ and the transliteration changed its value.",
  },
  {
    code: "CAPITAL_MIN_JOD_BAND_2",
    owner: "PROVIDER",
    kind: "MONEY_JOD",
    name: "Minimum paid-up capital, up to the second branch boundary",
    article: "art. 4/a/2",
    instrument: INSTR,
    printedPage: 5,
    value: "7500",
    note:
      "SEVEN THOUSAND FIVE HUNDRED. The OCR extraction publishes 7,000 here on the same false " +
      "reliability rule; the instrument draws ٧٬٥٠٠.",
  },
  {
    code: "CAPITAL_MAX_BRANCHES_BAND_2",
    owner: "PROVIDER",
    kind: "COUNT",
    name: "Highest branch count still inside the second capital band",
    article: "art. 4/a/2",
    instrument: INSTR,
    printedPage: 5,
    value: "12",
    note: "Read as ١٢ on the page image.",
  },
  {
    code: "CAPITAL_MIN_JOD_BAND_3",
    owner: "PROVIDER",
    kind: "MONEY_JOD",
    name: "Minimum paid-up capital above the second branch boundary",
    article: "art. 4/a/3",
    instrument: INSTR,
    printedPage: 5,
    value: "10000",
    note: "The top band has no upper branch bound — it is «لما يزيد عن ١٢».",
  },

  {
    code: "RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY",
    owner: "PROVIDER",
    kind: "CALENDAR_DAYS",
    name: "Days before expiry by which a renewal application must be filed",
    article: "art. 11",
    instrument: INSTR,
    printedPage: 15,
    value: "45",
    note:
      "CALENDAR days, not business days: the deadline is a span before a fixed calendar date, and " +
      "counting it in business days would move it EARLIER and make the office late for a filing " +
      "the regulation calls timely. Art. 11's title is «تجديد الترخيص» — read 2026-11-11; our " +
      "own reference had recorded the article as untitled.",
  },
  {
    code: "MIN_CAPITAL_JOD_ABOVE_FIVE_PHYSICAL_BRANCHES",
    owner: "PROVIDER",
    kind: "MONEY_JOD",
    name: "Minimum capital for a broker with more than five physical branches",
    article: "art. 13/b/2",
    instrument: INSTR,
    printedPage: 16,
    value: "50000",
    note:
      "«أن لا يقل رأسماله عن (٥٠) الف دينار» — read off the page image 2026-11-11. This is the " +
      "figure the OCR marked trusted on a rule that had already failed twice, and the reading " +
      "confirms it rather than inheriting its doubt.",
  },
  {
    code: "ARTICLE_14C_SUSPENSION_LIMIT_YEARS",
    owner: "PROVIDER",
    kind: "YEARS",
    name: "Years a licence suspension may stand before the licence is deemed cancelled",
    article: "art. 14/c",
    instrument: INSTR,
    printedPage: 16,
    value: "2",
    note:
      "«في حال تجاوزت مدة وقف الترخيص سنتين يعتبر الترخيص ملغى حكماً». Applied to the LICENCE, " +
      "never per insurance branch — the article's own words are the suspension of the licence.",
  },
  {
    code: "MIN_INSURERS_PER_REQUEST",
    owner: "PROVIDER",
    kind: "COUNT",
    name: "Insurance companies a quote request must reach",
    article: "art. 15/d",
    instrument: INSTR,
    printedPage: 17,
    value: "3",
    note:
      "«التواصل مع ثلاث شركات» is the SENDING, not receiving three replies — the owner's reading " +
      "of 9 October — so the proof is the record of who the request was sent to.",
  },
  {
    code: "SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD",
    owner: "PROVIDER",
    kind: "MONEY_JOD",
    name: "Annual premium ceiling under art. 15/d's fourth exemption",
    article: "art. 15/d/4",
    instrument: INSTR,
    printedPage: 17,
    value: "2000",
    note:
      "Read AT THE REQUEST'S OWN DATE, never at today's. The legal adviser's art. 15/d window " +
      "text carries this figure in his own sentence and is not ours to edit, so " +
      "`declared-act.spec.ts` pins the two together: the build fails the day this row moves.",
  },
  {
    code: "NET_EQUITY_FALL_SANCTION_PERCENT",
    owner: "PROVIDER",
    kind: "PERCENT",
    name: "Fall in net equity that is a ground for administrative sanction",
    article: "art. 21/a/12",
    instrument: INSTR,
    printedPage: 26,
    value: "50",
    note: "Read as ٥٠٪ on the page image.",
  },
  {
    code: "FORMER_AGENT_BAR_DAYS",
    owner: "PROVIDER",
    kind: "CALENDAR_DAYS",
    name: "Days a former agent is barred",
    article: "art. 22/m",
    instrument: INSTR,
    printedPage: 29,
    value: "30",
    note: "Read as ٣٠ يوماً on the page image.",
  },

  // ── THE THREE THE CENTRAL BANK HAS NOT ISSUED ────────────────────────────────────────────────
  //
  // Decision 123's third form: the instrument DEFERS these to a ruling that does not exist, so
  // they are the office's to supply, with its own reference and date, under its own permission.
  // They ship with their SHAPE and their GUARDS and NO VALUE, and an empty field is DORMANT —
  // criterion 6: no exemption rests on it, nothing is refused because of it, and no alert is
  // built on it.
  {
    code: "COMMISSION_BASIS_AND_CEILING",
    owner: "OFFICE",
    kind: "TEXT_LIST",
    name: "Commission bases and ceilings",
    article: "art. 22/z",
    instrument: INSTR,
    printedPage: null,
    value: null,
    note:
      "Deferred by the instrument to a Central Bank decision. Not issued as at 2026-11-11, so no " +
      "row exists and none may be invented — the commission module reads this when it is built.",
  },
  {
    code: "PROFESSIONAL_INDEMNITY_CONDITIONS",
    owner: "OFFICE",
    kind: "TEXT_LIST",
    name: "Professional indemnity cover conditions",
    article: "art. 10/a/4",
    instrument: INSTR,
    printedPage: null,
    value: null,
    note:
      "Deferred to a Central Bank decision, not issued as at 2026-11-11. `ProfessionalIndemnityPolicy` " +
      "exists and is not a singleton (a renewal is a new row); what is missing is the required " +
      "conditions, not the record.",
  },
  {
    code: "DEFINED_BENEFIT_CONTRACT_LIST",
    owner: "OFFICE",
    kind: "TEXT_LIST",
    name: "Contracts with defined benefits and coverages",
    article: "art. 2/a",
    instrument: INSTR,
    printedPage: null,
    value: null,
    note:
      "Deferred to a Central Bank decision, not issued as at 2026-11-11. It is art. 15/d's THIRD " +
      "exemption, which is why that exemption cannot be system-tagged: the list it depends on has " +
      "no value, and a dormant field tags nothing.",
  },
];

/** The codes WE seed — every PROVIDER-owned entry, which is every entry carrying a value. */
export const PROVIDER_LEGAL_VALUES: LegalValueCatalogueEntry[] = LEGAL_VALUES.filter(
  (v) => v.owner === "PROVIDER",
);

/** The codes the OFFICE supplies. Declared so the system knows the code exists and is dormant —
 *  which is a different statement from the code not existing, and the one a reader needs. */
export const OFFICE_SUPPLIED_LEGAL_VALUES: LegalValueCatalogueEntry[] = LEGAL_VALUES.filter(
  (v) => v.owner === "OFFICE",
);
