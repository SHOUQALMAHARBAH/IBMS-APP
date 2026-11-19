import { describe, expect, it } from 'vitest';
import {
  buildCertificateOfInsuranceHtml,
  type CertificateOfInsuranceData,
} from './certificate-of-insurance.template';

/*
 * ⚠️ `insurerName` IS THE LATIN NAME AND `insurerNameAr` IS THE ARABIC ONE, which is a
 * CORRECTION to this fixture rather than a widening. It used to carry «الاتحاد للتأمين» in
 * `insurerName`, so every Arabic assertion below passed WITHOUT the renderer ever consulting an
 * Arabic field — the shape message 45 §2 records («the acceptance test passed against the defect
 * on its first run»). The Latin name is what `resolveInsurerNamePair` actually returns as
 * `name`, and the Arabic half is what the walk found missing.
 */
const BASE_DATA: CertificateOfInsuranceData = {
  customerLegalName: 'شركة الأفق للتأمين',
  policyNumber: 'POL-2026-001',
  insurerName: 'Al-Ittihad Insurance',
  insurerNameAr: 'الاتحاد للتأمين',
  insuranceLine: 'Property All Risks',
  insuranceLineAr: 'التأمين على الممتلكات ضد جميع الأخطار',
  officeLegalName: 'Nasser Insurance Office',
  officeLegalNameAr: 'مكتب ناصر للتأمينات',
  brokerLicenseNumber: 'CBJ-IB-2026-014',
  inceptionDate: new Date('2026-10-01T00:00:00Z'),
  expiryDate: new Date('2027-10-01T00:00:00Z'),
  currency: 'JOD',
  sumsInsured: [{ key: 'total', value: '6200000.000' }],
  bodyEn: 'This certificate is issued as a summary of coverage.',
  bodyAr: 'تصدر هذه الشهادة كملخص للتغطية.',
};

describe('buildCertificateOfInsuranceHtml', () => {
  it('renders an AR-only document with dir="rtl"', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="ltr"');
    expect(html).toContain('تصدر هذه الشهادة كملخص للتغطية.');
    expect(html).not.toContain(
      'This certificate is issued as a summary of coverage.',
    );
  });

  it('renders an EN-only document with dir="ltr"', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain(
      'This certificate is issued as a summary of coverage.',
    );
  });

  it("DUAL renders both sections, Arabic first (this system's primary language)", () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
  });

  it('includes the policy number, insurer, insurance line and period', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(html).toContain('POL-2026-001');
    expect(html).toContain('Al-Ittihad Insurance');
    expect(html).toContain('Property All Risks');
    expect(html).toContain('Period of Insurance');
  });

  it('renders sum insured as a single summary line, money-formatted, the key in the reader language', () => {
    const en = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(en).toContain('Total: JOD 6,200,000.000');
    const ar = buildCertificateOfInsuranceHtml(BASE_DATA, 'AR');
    expect(ar).toContain('الإجمالي: JOD 6,200,000.000');
    // 🔴 DECISION 153 §U2 — the walk read `total: JOD 214,470.000` off the paper. The stored key
    // must not reach the reader in either half.
    expect(en).not.toContain('total:');
    expect(ar).not.toContain('total:');
  });

  it('prints a sum-insured key it has no label for AS STORED, never blank — decision 49', () => {
    // The vocabulary is OPEN: `sumsInsured` is free-form JSON. A key nobody has ruled on renders
    // as itself rather than disappearing, which is decision 148's blank-cell defect, and rather
    // than acquiring an invented Arabic word, which is decision 125's.
    const ar = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, sumsInsured: [{ key: 'building', value: '10.000' }] },
      'AR',
    );
    expect(ar).toContain('building: JOD 10.000');
  });

  it('never renders premium, tax, fees, commission, or the full limits/named-perils/extensions breakdown — a genuinely different content shape than the schedule summary', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    for (const term of [
      'Premium',
      'قسط',
      'Tax',
      'Fees',
      'Commission',
      'عمولة',
      'Named Perils',
      'الأخطار المسماة',
      'Extensions',
      'الامتدادات',
    ]) {
      expect(html).not.toContain(term);
    }
  });

  it('renders an em dash for a null policy number and "—" for an empty sums-insured set, never omitting the row', () => {
    const html = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, policyNumber: null, sumsInsured: [] },
      'EN',
    );
    expect(html).toContain('Policy Number');
    expect(html).toContain('Sum Insured');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('shows "ongoing" for an open period (no expiryDate) in each language', () => {
    const htmlEn = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, expiryDate: null },
      'EN',
    );
    expect(htmlEn).toContain('ongoing');
    const htmlAr = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, expiryDate: null },
      'AR',
    );
    expect(htmlAr).toContain('مستمر');
  });

  it('escapes HTML-shaped content in the customer legal name and a sum-insured key instead of injecting it raw', () => {
    const html = buildCertificateOfInsuranceHtml(
      {
        ...BASE_DATA,
        customerLegalName: '<script>alert(1)</script>',
        sumsInsured: [{ key: '<b>total</b>', value: '100' }],
      },
      'EN',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>total</b>');
    expect(html).toContain('&lt;b&gt;total&lt;/b&gt;');
  });

  it('gracefully degrades a non-numeric sum-insured value instead of crashing', () => {
    const html = buildCertificateOfInsuranceHtml(
      {
        ...BASE_DATA,
        sumsInsured: [{ key: 'total', value: 'as per wording' }],
      },
      'EN',
    );
    expect(html).toContain('Total: JOD as per wording');
  });

  it('never renders internal governance metadata (placed/issued/checked-by ids)', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    expect(html).not.toContain('placedByUserId');
    expect(html).not.toContain('issuedByUserId');
    expect(html).not.toContain('checkedByUserId');
  });

  /* ───────────────────────────────────────────────────────────────────────────────────────
   * 🔴 OWNER DECISION 153 §١ — THE CERTIFICATE A CUSTOMER RECEIVES, IN ARABIC.
   *
   * Her §٦ criterion 2: «الشهادة المنزَّلة تحمل رقم الوثيقة واسم المكتب ورقم ترخيصه، ولا تحمل
   * رقماً داخلياً، باختبار على محتواها» — a test ON ITS CONTENT, which is this one.
   *
   * ⚠️ IT IS THE ARABIC RENDER, deliberately. The walk read an Arabic certificate, and every
   * defect it found was a field that HAD an Arabic value the renderer was not reading. An
   * English-half assertion would pass against all of them.
   * ─────────────────────────────────────────────────────────────────────────────────────── */
  it('🔴 decision 153 §١ — the Arabic certificate names the policy, the office, its licence, and the insurer and line in Arabic', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'AR');

    // Ruling 1 — the policy number, under the label her own criterion 2 uses.
    expect(html).toContain('رقم الوثيقة');
    expect(html).toContain('POL-2026-001');

    // Ruling 2 — the office and its licence number.
    expect(
      html,
      'the certificate names no office, while its own text says «يرجى التواصل معنا»',
    ).toContain('مكتب ناصر للتأمينات');
    expect(html).toContain('رقم الترخيص');
    expect(html).toContain('CBJ-IB-2026-014');

    // The insurer and the line, in Arabic — the two the walk read in English.
    expect(html).toContain('الاتحاد للتأمين');
    expect(html).not.toContain('Al-Ittihad Insurance');
    expect(html).toContain('التأمين على الممتلكات ضد جميع الأخطار');
    expect(html).not.toContain('Property All Risks');

    // Decision 150 ruling 5's word, on the label this document carries.
    expect(html).toContain('فرع التأمين');
    expect(html).not.toContain('خط التأمين');

    // The month reads as it does on screen. «نوفمبر» is what the bare `ar` tag gives and is
    // what the walk read off the paper.
    expect(html).toContain('تشرين الأول');
    expect(html).not.toContain('نوفمبر');
    expect(html).not.toContain('أكتوبر');
    // Decision 146 ruling 1 — every figure the system writes is in Western digits, so the
    // Levantine month must not drag Eastern-Arabic numerals in with it.
    expect(html).not.toMatch(/[٠-٩]/);
  });

  it('🔴 decision 153 §٦ criterion 2 — NO internal id can reach the page, because the renderer is not given one', () => {
    const html = buildCertificateOfInsuranceHtml(BASE_DATA, 'DUAL');
    // A uuid in any position. The old «رقم المرجع» row printed
    // `ced189b0-6b28-4265-828b-9f1fdf0e9785`, 36 characters, as the FIRST line of the table.
    expect(html).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(html).not.toContain('رقم المرجع');
    expect(html).not.toContain('Reference');
    // And the guarantee is STRUCTURAL rather than a discipline: `CertificateOfInsuranceData`
    // carries no policy id at all, so there is nothing here to print even by mistake.
    expect(Object.keys(BASE_DATA)).not.toContain('policyId');
  });

  it('omits the licence line rather than printing a dash, where no term could be read', () => {
    // Unreachable through the route — `assertMayPractise` refuses an office with no term on
    // record (`NO_TERM_ON_RECORD` / `mayPractise: false`) before this renderer is reached — so
    // this pins the SHAPE rather than a live case: a certificate must never assert a licence
    // number it does not have.
    const html = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, brokerLicenseNumber: null },
      'AR',
    );
    expect(html).toContain('مكتب ناصر للتأمينات');
    expect(html).not.toContain('رقم الترخيص');
    expect(html).not.toContain('null');
  });

  it('falls back one way only: an insurer or line with no Arabic renders its Latin name, and English never renders Arabic', () => {
    const ar = buildCertificateOfInsuranceHtml(
      { ...BASE_DATA, insurerNameAr: null, insuranceLineAr: '   ' },
      'AR',
    );
    // No Arabic is invented for either; the stored Latin name is shown.
    expect(ar).toContain('Al-Ittihad Insurance');
    expect(ar).toContain('Property All Risks');

    // And the other direction never happens: a reader who chose English is never handed Arabic.
    const en = buildCertificateOfInsuranceHtml(BASE_DATA, 'EN');
    expect(en).toContain('Al-Ittihad Insurance');
    expect(en).not.toContain('الاتحاد للتأمين');
    expect(en).toContain('Property All Risks');
    expect(en).not.toContain('التأمين على الممتلكات ضد جميع الأخطار');
    // The office too — the English half names it in English.
    expect(en).toContain('Nasser Insurance Office');
    expect(en).not.toContain('مكتب ناصر للتأمينات');
  });
});
