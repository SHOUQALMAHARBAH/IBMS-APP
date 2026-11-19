import {
  DOCUMENT_BASE_CSS,
  escapeHtml,
  formatDocumentDate,
  formatDocumentMoney,
  preferLanguage,
  type DocumentLanguage,
} from '../document-generation/document-html.util';
import type { CoverageFigureEntry } from './policy.config';

/** Part F item #7 — certificate of insurance, the 6th and FINAL of the 6
 * named document types (after complaint acknowledgement, quotation
 * comparison, recommendation report, policy schedule summary, invoice).
 * Confirms the backlog's own "Derive it from Policy + PolicySchedule"
 * scoping decision (made when the policy-schedule-summary slice was
 * built) applies here too — same underlying data, deliberately different
 * CONTENT.
 *
 * **A genuine Certificate of Insurance convention, confirmed with the
 * user via `AskUserQuestion` before building** — NOT the same content as
 * `policy-schedule-summary.template.ts` under a different heading. A
 * certificate of insurance is a short proof-of-coverage document, often
 * handed to a third party (a landlord, a regulator, a lender) rather than
 * kept as a billing/schedule record: insured, policy number, insurer,
 * insurance line, period of insurance, and a single-line sum-insured
 * summary — deliberately NO premium, tax, commission, or the full
 * limits/named-perils/extensions breakdown the schedule summary already
 * covers in detail.
 *
 * `sumsInsured` is free-form JSON with no fixed key vocabulary (the same
 * `policy.config.ts#assertCoverageFigures` shape the schedule-summary
 * document reads via the now-shared `coverageFigureEntries()`). Rendered
 * here as ONE summary line (`key: money-formatted-value` per entry,
 * joined by "; ") rather than a full table — this document is a short
 * proof of coverage, not an itemized breakdown.
 *
 * Reuses the SAME `PolicyService.getByIdWithCustomer()` visibility read
 * and the SAME `schedules.length === 0` data-availability gate the
 * schedule-summary slice already established (`policy-schedule-summary-
 * document.service.ts`) — a Policy has nothing to certify until Process
 * 19 issuance records the first schedule, exactly the same precondition
 * a certificate has. */

/*
 * 🔴 OWNER DECISION 153 §١ — WHAT A CERTIFICATE SAYS ABOUT ITSELF AND ABOUT WHO ISSUED IT.
 *
 * Her second demo walk downloaded one and read it (§U2, §U3). What it printed:
 *
 *   «رقم المرجع»   `ced189b0-6b28-4265-828b-9f1fdf0e9785`  — 36 characters of internal id
 *   «شركة التأمين» `Al-Manara Insurance (demo)`            — the screen says «شركة المنارة للتأمين»
 *   «خط التأمين»   `Group Life`                            — the screen says «تأمين الحياة الجماعي»
 *   «مبلغ التأمين» `total: JOD 214,470.000`                — an English data key
 *   the date       «18 نوفمبر 2026»                        — the screens say «تشرين الثاني»
 *   the office     NOTHING AT ALL                          — while the text says «يرجى التواصل معنا»
 *
 * ⟶ Ruling 1: «رقم المرجع» على الشهادة هو **رقم الوثيقة**، لا الرقم الداخلي.
 * ⟶ Ruling 2: الشهادة تحمل **اسم المكتب ورقم ترخيصه**.
 *
 * ## ⚠️ ONE NUMBER, ONE ROW — A JUDGEMENT STATED RATHER THAN HIDDEN
 *
 * This document carried BOTH «رقم المرجع» (the uuid) and «رقم الوثيقة» (the policy number). Ruling
 * 1 says the reference IS the policy number, which makes the two rows one fact — and printing one
 * fact twice under two labels tells a reader there are two numbers when there is one. So the
 * uuid-bearing row is GONE and «رقم الوثيقة» carries it, which is also the label her own §٦
 * criterion 2 uses («تحمل رقم الوثيقة»). ⟶ Reported so she can reverse it in one line.
 *
 * ## AND THE uuid IS NOT IN THIS TYPE AT ALL
 *
 * `policyId` was removed rather than left unused. A renderer that does not HAVE the internal id
 * cannot print it — which is a structural guarantee of her §٦ criterion 2 («ولا تحمل رقماً
 * داخلياً») instead of a discipline somebody has to keep. The compiler named every caller.
 */
export interface CertificateOfInsuranceData {
  customerLegalName: string;
  policyNumber: string | null;
  insurerName: string;
  /** The insurer's Arabic name, or null when none is known. Resolved by
   *  `resolveInsurerNamePair` — ⛔ never coalesced field by field, see `insurer-identity.ts`. */
  insurerNameAr: string | null;
  insuranceLine: string;
  /** The line's Arabic name from the managed catalogue, or null when the record's catalogue FK
   *  was never back-filled. ⛔ `null` is not a cue to invent one: the English the record stored
   *  is printed instead, which is honest. See `insurance-line-names.ts`. */
  insuranceLineAr: string | null;
  /** OWNER DECISION 153 RULING 2 — the issuing office, in both scripts, so the DUAL render can
   *  name it in each half. Both are NOT NULL on `Organization` (module 0-ب made the Arabic one
   *  so), which is why neither is nullable here. */
  officeLegalName: string;
  officeLegalNameAr: string;
  /**
   * OWNER DECISION 153 RULING 2 — the licence number of the term in force AT ISSUANCE.
   *
   * ⚠️ Nullable only because TypeScript cannot see the refusal that makes it impossible.
   * `BrokerLicense.licenseNumber` is NOT NULL and an office with NO term on record derives
   * `NO_TERM_ON_RECORD` with `mayPractise: false` — which `assertMayPractise` throws on, BEFORE
   * this renderer is reached. Measured 2026-11-19: 0 blank licence numbers on either database
   * (dev 4 terms, db-test 59). So the null branch is unreachable on a path that produces a
   * certificate, and the line is simply omitted rather than printing a dash for a number the
   * office does have.
   */
  brokerLicenseNumber: string | null;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  currency: string;
  sumsInsured: CoverageFigureEntry[];
  /** From `DocumentTemplate` when a `certificate_of_insurance` row
   * exists; a built-in fallback otherwise (see
   * `certificate-of-insurance-document.service.ts`). */
  bodyEn: string;
  bodyAr: string;
}

/**
 * THE SUM-INSURED KEYS, IN THE READER'S LANGUAGE — and the keys are DATA, not literals.
 *
 * ⚠️ MEASURED BEFORE BEING TREATED AS A STRING. Message 48 §1 item 4 names `total:` as a literal
 * in the code; it is not. `sumsInsured` is free-form JSON with no fixed key vocabulary
 * (`policy.config.ts#assertCoverageFigures`), and `total` is a key a writer stored. Measured
 * 2026-11-19 on BOTH databases: **the only key that exists anywhere is `total`** — 99 of 99
 * schedules on dev, 767 of 767 on db-test.
 *
 * ⟶ So it is translated through a MAP rather than replaced with a word: the vocabulary is open,
 *   and a key this map does not carry is printed AS STORED. That is owner decision 49's rule —
 *   a value with no label is shown as itself, visibly machine text, never blanked and never
 *   dressed up as a name. Blanking is the decision-148 defect (an empty cell nobody is told
 *   about); a label invented for a key nobody has ruled on is the decision-125 one.
 *
 * ⛔ «الإجمالي» IS NOT A NEW WORD. It ships four times already for exactly this — a total column
 * header — at `compliance-screening.ts:313`, `finance.ts:44`, `finance.ts:61` and
 * `operations.ts:352`, and `invoice-document.template.ts:141` carries «الإجمالي المستحق» on a
 * document beside this one.
 */
const SUM_INSURED_KEY_LABEL: Record<string, { ar: string; en: string }> = {
  total: { ar: 'الإجمالي', en: 'Total' },
};

function sumInsuredSummary(
  entries: CoverageFigureEntry[],
  lang: 'en' | 'ar',
  currency: string,
): string {
  if (entries.length === 0) return '—';
  return entries
    .map((e) => {
      const label = SUM_INSURED_KEY_LABEL[e.key];
      const shown = label ? label[lang] : e.key;
      return `${escapeHtml(shown)}: ${formatDocumentMoney(
        { toString: () => String(e.value) },
        lang,
        currency,
      )}`;
    })
    .join('; ');
}

function renderSection(
  data: CertificateOfInsuranceData,
  lang: 'en' | 'ar',
): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = lang === 'ar' ? 'شهادة تأمين' : 'Certificate of Insurance';

  const periodRange = `${
    data.inceptionDate ? formatDocumentDate(data.inceptionDate, lang) : '—'
  } – ${data.expiryDate ? formatDocumentDate(data.expiryDate, lang) : lang === 'ar' ? 'مستمر' : 'ongoing'}`;

  const insurer = preferLanguage(data.insurerName, data.insurerNameAr, lang);
  const line = preferLanguage(data.insuranceLine, data.insuranceLineAr, lang);

  const metaRows: [string, string][] =
    lang === 'ar'
      ? [
          ['المؤمَّن له', escapeHtml(data.customerLegalName)],
          ['رقم الوثيقة', escapeHtml(data.policyNumber ?? '—')],
          ['شركة التأمين', escapeHtml(insurer)],
          // 🔴 «خط التأمين» -> «فرع التأمين». Decision 150 ruling 5 settled the word for the
          // nineteen DICTIONARY strings; this label is not one of them — it is hard-coded in
          // FIVE api document templates, which is why it was never in her table and is answered
          // here instead. ⚠️ The other four (quotation comparison, invoice, policy schedule
          // summary, recommendation report) still say «خط التأمين» and are REPORTED rather than
          // changed: §1 of this message is the certificate, and four more customer-facing
          // documents are hers to sweep.
          ['فرع التأمين', escapeHtml(line)],
          ['فترة التأمين', periodRange],
          [
            'مبلغ التأمين',
            sumInsuredSummary(data.sumsInsured, 'ar', data.currency),
          ],
        ]
      : [
          ['Insured', escapeHtml(data.customerLegalName)],
          ['Policy Number', escapeHtml(data.policyNumber ?? '—')],
          ['Insurer', escapeHtml(insurer)],
          ['Insurance Line', escapeHtml(line)],
          ['Period of Insurance', periodRange],
          [
            'Sum Insured',
            sumInsuredSummary(data.sumsInsured, 'en', data.currency),
          ],
        ];

  const certifyText =
    lang === 'ar'
      ? 'تشهد هذه الوثيقة بأن المؤمَّن له المذكور أعلاه يحمل التغطية التالية، السارية حالياً بتاريخ إصدار هذه الشهادة.'
      : 'This certifies that the below-named insured holds the following coverage, currently in force as at the date of this certificate.';

  const body = lang === 'ar' ? data.bodyAr : data.bodyEn;

  /*
   * 🔴 OWNER DECISION 153 RULING 2 — THE ISSUER BLOCK, AND IT IS NOT A TABLE ROW.
   *
   * The walk's §U3: «الشهادة تقول «يرجى التواصل معنا» ولا تقول مَن «نحن»». The office's name and
   * licence number stand at the TOP, above the attestation, which is where a certificate names
   * its issuer and is also what lets the name carry NO LABEL. That matters: «اسم المكتب» ships
   * nowhere, and the nearest shipping span is «الاسم القانوني» — which, placed in the meta table
   * beside «المؤمَّن له», would ask the reader whose legal name it is. An issuer line above the
   * attestation cannot be read as the insured's.
   *
   * ⛔ «رقم الترخيص» IS NOT A NEW WORD either — it ships five times for exactly this number
   * (`compliance-risk.ts:101`, `:130`, `:384`, `provider.ts:35`, `:104`).
   */
  const licenceLine =
    data.brokerLicenseNumber === null
      ? ''
      : `<p class="issuer-licence">${escapeHtml(
          lang === 'ar' ? 'رقم الترخيص' : 'Licence Number',
        )}: ${escapeHtml(data.brokerLicenseNumber)}</p>`;

  return `
    <section dir="${dir}" lang="${lang}">
      <h1>${title}</h1>
      <p class="issuer">${escapeHtml(
        preferLanguage(data.officeLegalName, data.officeLegalNameAr, lang),
      )}</p>
      ${licenceLine}
      <p class="meta">${formatDocumentDate(new Date(), lang)}</p>
      <p>${escapeHtml(certifyText)}</p>
      <table>
        ${metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}
      </table>
      ${body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}
    </section>
  `;
}

export function buildCertificateOfInsuranceHtml(
  data: CertificateOfInsuranceData,
  language: DocumentLanguage,
): string {
  const sections =
    language === 'DUAL'
      ? `${renderSection(data, 'ar')}<div class="page-break"></div>${renderSection(data, 'en')}`
      : renderSection(data, language === 'AR' ? 'ar' : 'en');

  /*
   * The issuer block's own rules, appended after the shared base — which is the arrangement that
   * base's own header describes («A template may append its own additional rules after this»).
   * They are presentation only: the two lines say who issued this and under which licence, and
   * they read as the issuer rather than as the insured because of WHERE THEY SIT, not because of
   * how they look.
   *
   * ## 🔴 AND THERE IS NO `font-weight` HERE, WHICH IS A MEASUREMENT RATHER THAN A PREFERENCE
   *
   * The first version set `font-weight: 600` on the office name, and `policy.e2e-spec.ts`'s
   * «the certificate is genuinely smaller than the schedule-summary document» assertion went red
   * — 36,264 bytes against 29,438. Measured through the real renderer, twice each and
   * byte-stable: **the two lines of text cost 584 bytes and the single `font-weight` declaration
   * cost 8,108 more** (29,733 -> 30,317 -> 38,441), because a weight no other element on the
   * page uses makes Chromium embed a SECOND font subset.
   *
   * ⛔ So the declaration is gone rather than the assertion relaxed. Decision 142 stores every
   * issued certificate's BYTES IN THE DATABASE until a storage service exists, so eight kilobytes
   * a certificate is storage this product pays for on every download, for a semibold line.
   */
  const css = `${DOCUMENT_BASE_CSS}
  .issuer { font-size: 15px; margin: 0 0 2px; }
  .issuer-licence { color: #555; font-size: 13px; margin: 0; }
`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>${sections}</body>
</html>`;
}
