import { Injectable } from '@nestjs/common';
// Pinned to otplib 12.0.1, not the current-latest 13.x — v13 is a ground-up
// API redesign (class/functional, no `authenticator` facade) with far less
// real-world usage precedent. For security-critical MFA code, the
// well-documented v12 facade is the safer choice; the deprecation warning
// is a migration nudge, not a vulnerability (0 findings either way via
// `npm audit`). Revisit deliberately, the same way the Prisma 6-vs-7 call
// was recorded — see ibms-brain/meta/designs.
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { decryptField, encryptField } from '../../../common/crypto.util';

const ISSUER = 'IBMS';

@Injectable()
export class MfaService {
  generateTotpSecret(): string {
    return authenticator.generateSecret();
  }

  encryptSecret(secret: string): string {
    return encryptField(secret);
  }

  private decryptSecret(secretEnc: string): string {
    return decryptField(secretEnc);
  }

  buildOtpAuthUri(email: string, secret: string): string {
    return authenticator.keyuri(email, ISSUER, secret);
  }

  generateQrCodeDataUrl(otpAuthUri: string): Promise<string> {
    return QRCode.toDataURL(otpAuthUri);
  }

  verifyCode(code: string, secretEnc: string): boolean {
    try {
      return authenticator.verify({
        token: code,
        secret: this.decryptSecret(secretEnc),
      });
    } catch {
      return false;
    }
  }
}
