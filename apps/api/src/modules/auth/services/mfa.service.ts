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

/**
 * Part II §4.3.2 — accept the previous, current and next 30-second code.
 *
 * otplib's default is ZERO tolerance, which is the cause of the "the code is
 * wrong even though I set it up right" reports the spec calls out: a phone
 * whose clock has drifted by a few seconds generates a code the server has
 * already moved past. One step either side absorbs that drift without
 * meaningfully widening the guessing window — a code stays valid for at most 90
 * seconds rather than 30, and brute force is bounded by the lockout counter,
 * not by this.
 *
 * The server's own clock must be NTP-synced; this tolerates a user's drift, not
 * ours.
 */
const TOTP_WINDOW_STEPS = 1;

/** One 30-second TOTP step, in seconds. Named so the tolerance above reads as
 * a number of steps rather than a magic constant. */
export const TOTP_STEP_SECONDS = 30;

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

  /**
   * Validates a TOTP code against the stored secret, with the §4.3.2 tolerance.
   *
   * `authenticator.verify` reads its window from the shared `authenticator`
   * options, so the tolerance is applied through a per-call clone rather than by
   * mutating global state — otplib's facade is a singleton, and a global
   * `options` assignment here would silently change the behaviour of every other
   * caller in the process.
   */
  verifyCode(code: string, secretEnc: string): boolean {
    try {
      const totp = authenticator.clone({
        window: TOTP_WINDOW_STEPS,
        step: TOTP_STEP_SECONDS,
      });
      return totp.verify({
        token: code,
        secret: this.decryptSecret(secretEnc),
      });
    } catch {
      return false;
    }
  }
}
