import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateOpaqueToken, hashToken } from '../../../common/crypto.util';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  private accessSecret(): string {
    return (
      process.env.JWT_ACCESS_SECRET ??
      'dev-insecure-secret-change-me-32chars-minimum'
    );
  }

  signAccessToken(payload: AccessTokenPayload, ttlMinutes: number): string {
    return this.jwtService.sign(payload, {
      secret: this.accessSecret(),
      expiresIn: `${ttlMinutes}m`,
    });
  }

  /** Also used to sign the short-lived MFA login-challenge token. */
  signShortLivedPurposeToken(
    payload: { sub: string; purpose: string },
    ttlMinutes: number,
  ): string {
    return this.jwtService.sign(payload, {
      secret: this.accessSecret(),
      expiresIn: `${ttlMinutes}m`,
    });
  }

  verifyPurposeToken<T extends object>(token: string): T {
    return this.jwtService.verify<T>(token, { secret: this.accessSecret() });
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
