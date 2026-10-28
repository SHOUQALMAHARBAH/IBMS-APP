import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('MfaService', () => {
  const service = new MfaService();

  it('generates a secret, encrypts it, and verifies a code generated from the raw secret', () => {
    const secret = service.generateTotpSecret();
    const secretEnc = service.encryptSecret(secret);
    expect(secretEnc).not.toContain(secret);

    const code = authenticator.generate(secret);
    expect(service.verifyCode(code, secretEnc)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = service.generateTotpSecret();
    const secretEnc = service.encryptSecret(secret);
    const wrongCode =
      authenticator.generate(secret) === '000000' ? '111111' : '000000';
    expect(service.verifyCode(wrongCode, secretEnc)).toBe(false);
  });

  it('rejects a code checked against a different secret', () => {
    const secretA = service.generateTotpSecret();
    const secretB = service.generateTotpSecret();
    const secretBEnc = service.encryptSecret(secretB);
    const codeForA = authenticator.generate(secretA);
    expect(service.verifyCode(codeForA, secretBEnc)).toBe(false);
  });

  it('builds an otpauth:// URI carrying the account and issuer', () => {
    const secret = service.generateTotpSecret();
    const uri = service.buildOtpAuthUri('someone@example.com', secret);
    expect(uri).toContain('otpauth://totp/');
    /*
     * THE ISSUER IS PERCENT-ENCODED, AND THE RENAME IS WHAT SURFACED IT.
     *
     * `IBMS` had no space and this assertion could read the raw string; `WASEET 360` does, and
     * `otpauth://` URL-encodes both the label and the `issuer` parameter — so the URI carries
     * `WASEET%20360` in both places and an authenticator app decodes it before showing the user
     * `WASEET 360`. Both are asserted rather than only the encoded form: the encoding is what the
     * URI must contain, and the DECODED value is the claim that actually matters, because it is
     * what a person reads in their phone.
     *
     * The label prefix and the `issuer` parameter must AGREE — they do, both `WASEET%20360` — which
     * is the spec-compliant shape and the one older authenticator apps handle correctly.
     */
    expect(uri).toContain('issuer=WASEET%20360');
    expect(uri).toContain('otpauth://totp/WASEET%20360:');
    expect(decodeURIComponent(new URL(uri).searchParams.get('issuer') ?? '')).toBe('WASEET 360');
    expect(uri).toContain(secret);
  });

  it('generates a QR code as a data URL', async () => {
    const uri = service.buildOtpAuthUri(
      'someone@example.com',
      service.generateTotpSecret(),
    );
    const dataUrl = await service.generateQrCodeDataUrl(uri);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
