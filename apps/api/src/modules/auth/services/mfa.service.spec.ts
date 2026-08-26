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
    expect(uri).toContain('IBMS');
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
