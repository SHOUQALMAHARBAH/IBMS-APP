import { describe, expect, it } from 'vitest';
import { certificateFileName } from './certificate-of-insurance-document.service';

/**
 * 🔴 OWNER DECISION 153 RULING 1 — THE FILE NAME, which is the half of the certificate that the
 * content test cannot see.
 *
 * The rendered HTML is asserted in `certificate-of-insurance.template.spec.ts`; the name the
 * customer's browser saves it under is built in the SERVICE, from the policy, and goes straight
 * into an HTTP header. Her §٦ criterion 2 is about what the downloaded certificate carries, and
 * what it is called is part of that: the walk's own row reads
 * `certificate-of-insurance-ced189b0-….pdf`.
 *
 * It is tested as a pure function rather than through the service because the question is
 * entirely about the string — no policy, no licence, no render.
 */
describe('certificateFileName — decision 153 ruling 1', () => {
  it('carries the policy number and the language, and no internal id', () => {
    expect(certificateFileName('POL-2026-001', 'AR')).toBe(
      'certificate-of-insurance-POL-2026-001-AR.pdf',
    );
    expect(certificateFileName('POL-2026-001', 'EN')).toBe(
      'certificate-of-insurance-POL-2026-001-EN.pdf',
    );
  });

  it('🔴 never contains a uuid — the shape the walk read off the download', () => {
    const name = certificateFileName('POL-OFFICE-A-1792248704513-540', 'AR');
    expect(name).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(name).toContain('POL-OFFICE-A-1792248704513-540');
  });

  it('🔴 THE LANGUAGE STILL TELLS TWO LEGITIMATE CERTIFICATES APART', () => {
    // Load-bearing rather than cosmetic: `storeIssuedCertificate` keys on (policy, file name,
    // facts digest), so without the language the Arabic and English certificates of one policy
    // would collide and the second language would silently return the first.
    expect(certificateFileName('POL-1', 'AR')).not.toBe(
      certificateFileName('POL-1', 'EN'),
    );
    expect(certificateFileName('POL-1', 'DUAL')).not.toBe(
      certificateFileName('POL-1', 'AR'),
    );
  });

  /*
   * 🔴 SANITISING IS LOAD-BEARING, NOT TIDINESS.
   *
   * The result goes into `disposition: attachment; filename="${fileName}"`. The uuid this
   * replaces could not carry a quote, a slash or a newline; `policyNumber` is free text with no
   * character restriction at all in its DTO (`@IsString`, `@MinLength(2)`, `@MaxLength(120)`).
   *
   * ⚠️ Measured 2026-11-19: 0 of 805 policy numbers across both databases contain a character
   * outside `[A-Za-z0-9._-]`. So this guards a real office rather than a seed — which is exactly
   * when a guard has to be written, not after.
   */
  it('refuses to let a free-text policy number escape into the header or the path', () => {
    expect(certificateFileName('2026/014', 'AR')).toBe(
      'certificate-of-insurance-2026-014-AR.pdf',
    );
    /* ⚠️ A DOT IS KEPT AND THAT IS CORRECT. `2026.014` is a plausible policy number, and `..`
       with no separator beside it cannot traverse anything — what makes a path is the SLASH.
       So this asserts the property rather than a cosmetic string: the result is one file name
       with no path segment in it. */
    const traversal = certificateFileName('../../etc/passwd', 'AR');
    expect(traversal).not.toContain('/');
    expect(traversal).not.toContain('\\');
    expect(traversal).toBe('certificate-of-insurance-..-..-etc-passwd-AR.pdf');
    const quoted = certificateFileName('A" ; drop', 'EN');
    expect(quoted).not.toContain('"');
    expect(quoted).not.toContain(';');
    const broken = certificateFileName('A\r\nX-Injected: 1', 'EN');
    expect(broken).not.toContain('\r');
    expect(broken).not.toContain('\n');
  });

  it('omits the segment entirely where there is no policy number — never a uuid, never an invented token', () => {
    /*
     * ⚠️ Unreachable on a path that produces a certificate, measured: 0 of 99 certifiable
     * policies on dev and 0 of 674 on db-test lack a number, because a policy with no schedule
     * or a CANCELLED/EXPIRED one is refused 422 before this is called. `Policy.policyNumber` is
     * nullable in the schema, so the function still has to answer — and the answer is silence
     * rather than the internal id decision 153 ruling 1 removes, or a word nobody ratified.
     *
     * Two policies cannot collide on it: `storeIssuedCertificate` matches on `policyId` first.
     */
    expect(certificateFileName(null, 'AR')).toBe(
      'certificate-of-insurance-AR.pdf',
    );
    expect(certificateFileName('   ', 'EN')).toBe(
      'certificate-of-insurance-EN.pdf',
    );
    expect(certificateFileName('///', 'EN')).toBe(
      'certificate-of-insurance-EN.pdf',
    );
    expect(certificateFileName(null, 'AR')).not.toContain('undefined');
    expect(certificateFileName(null, 'AR')).not.toContain('null');
  });
});
