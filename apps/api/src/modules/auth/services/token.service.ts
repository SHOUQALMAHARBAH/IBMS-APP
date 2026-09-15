import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  generateOpaqueToken,
  hashToken,
  jwtSecret,
} from '../../../common/crypto.util';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  /**
   * Part II §4.10.2 — "every issued JWT/session carries an organizationId
   * claim".
   *
   * It is a claim, not the source of truth: `validateAndTouch` still resolves
   * the Organization from the SESSION ROW, and the two are compared. A token
   * whose claim disagrees with its own session is rejected — which is what the
   * claim is for, since a token is the one part of this a client holds.
   */
  org: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(payload: AccessTokenPayload, ttlMinutes: number): string {
    return this.jwtService.sign(payload, {
      secret: jwtSecret(),
      expiresIn: `${ttlMinutes}m`,
    });
  }

  /** Also used to sign the short-lived MFA login-challenge token. */
  signShortLivedPurposeToken(
    payload: { sub: string; purpose: string },
    ttlMinutes: number,
  ): string {
    return this.jwtService.sign(payload, {
      secret: jwtSecret(),
      expiresIn: `${ttlMinutes}m`,
    });
  }

  verifyPurposeToken<T extends object>(token: string): T {
    return this.jwtService.verify<T>(token, { secret: jwtSecret() });
  }

  /** Opaque (non-JWT) refresh/reset bearer secret — raw value + its stored hash. */
  issueOpaqueSecret(): { raw: string; hash: string } {
    const raw = generateOpaqueToken();
    return { raw, hash: hashToken(raw) };
  }

  hash(raw: string): string {
    return hashToken(raw);
  }
}
