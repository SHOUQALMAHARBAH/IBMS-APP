import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RoleName, User } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { RefreshTokenRepository } from '../../../repositories/refresh-token.repository';
import { MfaCredentialRepository } from '../../../repositories/mfa-credential.repository';
import { PasswordResetTokenRepository } from '../../../repositories/password-reset-token.repository';
import { AuditService } from '../../audit/audit.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { SecurityConfigService } from './security-config.service';
import { requiresHardwareToken } from '../auth.types';
import type { SignupDto } from '../dto/signup.dto';
import type { LoginDto } from '../dto/login.dto';
import type {
  MfaChallengeVerifyDto,
  MfaDisableDto,
  MfaEnrollVerifyDto,
} from '../dto/mfa.dto';
import type {
  ForgotPasswordDto,
  ResetPasswordDto,
} from '../dto/password-reset.dto';
import type { StepUpDto } from '../dto/step-up.dto';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleName[];
  mfaEnabled: boolean;
  mfaPolicySatisfied: boolean;
}

const MFA_CHALLENGE_PURPOSE = 'mfa_challenge';
const MFA_CHALLENGE_TTL_MINUTES = 5;
const PASSWORD_RESET_TTL_MINUTES = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly mfaCredentials: MfaCredentialRepository,
    private readonly passwordResetTokens: PasswordResetTokenRepository,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly securityConfig: SecurityConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<{ id: string; email: string }> {
    const violations = this.passwords.validatePolicy(dto.password);
    if (violations.length > 0) throw new BadRequestException(violations);

    const existing = await this.users.findByEmail(dto.email);
    if (existing)
      throw new ConflictException('An account with this email already exists');

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      fullName: dto.fullName,
      email: dto.email,
      passwordHash,
      languagePreference: dto.languagePreference,
    });
    return { id: user.id, email: user.email };
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta,
  ): Promise<{ mfaRequired: true; mfaChallengeToken: string } | IssuedSession> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        'Account temporarily locked due to repeated failed sign-in attempts',
      );
    }

    const passwordOk = await this.passwords.verify(
      dto.password,
      user.passwordHash,
    );
    if (!passwordOk) {
      await this.recordFailedLogin(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive)
      throw new ForbiddenException('This account is disabled');
    this.assertAccessWindowActive(user);

    if (user.mfaEnabled) {
      const mfaChallengeToken = this.tokens.signShortLivedPurposeToken(
        { sub: user.id, purpose: MFA_CHALLENGE_PURPOSE },
        MFA_CHALLENGE_TTL_MINUTES,
      );
      return { mfaRequired: true, mfaChallengeToken };
    }

    return this.issueSession(user, meta);
  }

  async verifyMfaChallenge(
    dto: MfaChallengeVerifyDto,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.tokens.verifyPurposeToken(dto.mfaChallengeToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    if (payload.purpose !== MFA_CHALLENGE_PURPOSE) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }

    const user = await this.users.findById(payload.sub);
    if (!user?.mfaEnabled)
      throw new UnauthorizedException('Invalid MFA challenge');
    this.assertAccessWindowActive(user);

    const credential = await this.mfaCredentials.findActiveByUserAndType(
      user.id,
      'TOTP',
    );
    if (
      !credential?.secretEnc ||
      !this.mfa.verifyCode(dto.code, credential.secretEnc)
    ) {
      await this.audit.record({
        userId: user.id,
        action: 'MFA_FAILED',
        entityType: 'User',
        entityId: user.id,
      });
      throw new UnauthorizedException('Invalid authentication code');
    }
    await this.mfaCredentials.touchLastUsed(credential.id);
    await this.audit.record({
      userId: user.id,
      action: 'MFA_VERIFIED',
      entityType: 'User',
      entityId: user.id,
    });

    return this.issueSession(user, meta);
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta) {
    const tokenHash = this.tokens.hash(rawRefreshToken);
    const stored = await this.refreshTokens.findByHash(tokenHash);
    if (!stored) throw new UnauthorizedException('Invalid session');

    if (stored.revokedAt) {
      // A rotated-out refresh token was presented again — replay/theft
      // indicator. Kill every session for this user, not just this one.
      await this.sessions.revokeAllForUser(stored.userId, 'admin_revoked');
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(
        'Session invalidated — please log in again',
      );
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired — please log in again');
    }

    const session = await this.sessions.findSessionByRefreshTokenId(stored.id);
    if (!session) throw new UnauthorizedException('Invalid session');

    // Re-runs idle-timeout / access-window / revoked checks against the
    // live session before minting new tokens.
    await this.sessions.validateAndTouch(stored.userId, session.id);

    const config = await this.securityConfig.get();
    const next = this.tokens.issueOpaqueSecret();
    const refreshTokenExpiresAt = new Date(
      Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    const newStored = await this.refreshTokens.create({
      userId: stored.userId,
      tokenHash: next.hash,
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
    await this.refreshTokens.revoke(stored.id, newStored.id);
    await this.sessions.linkRefreshToken(session.id, newStored.id);

    const accessToken = this.tokens.signAccessToken(
      { sub: stored.userId, sid: session.id },
      config.accessTokenTtlMinutes,
    );
    return { accessToken, refreshToken: next.raw, refreshTokenExpiresAt };
  }

  async logout(
    sessionId: string,
    rawRefreshToken: string | undefined,
    userId: string,
  ): Promise<void> {
    await this.sessions.logout(sessionId);
    if (rawRefreshToken) {
      const stored = await this.refreshTokens.findByHash(
        this.tokens.hash(rawRefreshToken),
      );
      if (stored && !stored.revokedAt)
        await this.refreshTokens.revoke(stored.id);
    }
    await this.audit.record({
      userId,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: userId,
    });
  }

  /** Always returns the same shape regardless of whether the email matched
   * an account — prevents account enumeration via this endpoint. */
  async forgotPassword(
    dto: ForgotPasswordDto,
    ip: string | undefined,
  ): Promise<{ devResetToken?: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) return {};

    const token = this.tokens.issueOpaqueSecret();
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    );
    await this.passwordResetTokens.invalidateAllForUser(user.id);
    await this.passwordResetTokens.create({
      userId: user.id,
      tokenHash: token.hash,
      expiresAt,
      requestedIp: ip,
    });
    await this.audit.record({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
    });

    // No email/notification provider exists in this repo yet (see A.1
    // plan). Never log the raw token — only ever return it, and only when
    // explicitly opted in via ENABLE_DEV_RESET_TOKEN, so local/e2e testing
    // can exercise the full flow. NODE_ENV=production is a hard override on
    // top of the flag — not the primary gate — so a misconfigured flag can
    // never leak a token in prod even if someone sets it there by mistake.
    if (
      process.env.ENABLE_DEV_RESET_TOKEN === 'true' &&
      process.env.NODE_ENV !== 'production'
    )
      return { devResetToken: token.raw };
    return {};
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const stored = await this.passwordResetTokens.findByHash(
      this.tokens.hash(dto.token),
    );
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const violations = this.passwords.validatePolicy(dto.newPassword);
    if (violations.length > 0) throw new BadRequestException(violations);

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.users.updatePassword(stored.userId, passwordHash);
    await this.passwordResetTokens.markUsed(stored.id);
    await this.sessions.revokeAllForUser(stored.userId, 'password_reset');
    await this.refreshTokens.revokeAllForUser(stored.userId);
    await this.audit.record({
      userId: stored.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: stored.userId,
    });
  }

  async enrollTotp(userId: string, email: string) {
    const secret = this.mfa.generateTotpSecret();
    const secretEnc = this.mfa.encryptSecret(secret);
    const credential = await this.mfaCredentials.create({
      userId,
      type: 'TOTP',
      secretEnc,
      isActive: false,
    });
    const otpAuthUri = this.mfa.buildOtpAuthUri(email, secret);
    const qrCodeDataUrl = await this.mfa.generateQrCodeDataUrl(otpAuthUri);
    return { credentialId: credential.id, otpAuthUri, qrCodeDataUrl };
  }

  async verifyTotpEnrollment(
    userId: string,
    dto: MfaEnrollVerifyDto,
  ): Promise<void> {
    const credential = await this.mfaCredentials.findById(dto.credentialId);
    if (
      !credential ||
      credential.userId !== userId ||
      credential.type !== 'TOTP'
    ) {
      throw new NotFoundException('MFA enrollment not found');
    }
    if (
      !credential.secretEnc ||
      !this.mfa.verifyCode(dto.code, credential.secretEnc)
    ) {
      await this.audit.record({
        userId,
        action: 'MFA_FAILED',
        entityType: 'User',
        entityId: userId,
      });
      throw new BadRequestException(
        'Invalid code — check your authenticator app and try again',
      );
    }
    await this.mfaCredentials.activate(credential.id);
    await this.users.setMfaEnabled(userId, true);
    await this.audit.record({
      userId,
      action: 'MFA_ENROLLED',
      entityType: 'User',
      entityId: userId,
    });
  }

  async disableTotp(userId: string, dto: MfaDisableDto): Promise<void> {
    const user = await this.users.findById(userId);
    if (
      !user ||
      !(await this.passwords.verify(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid password');
    }
    const credential = await this.mfaCredentials.findActiveByUserAndType(
      userId,
      'TOTP',
    );
    if (
      !credential?.secretEnc ||
      !this.mfa.verifyCode(dto.code, credential.secretEnc)
    ) {
      throw new BadRequestException('Invalid code');
    }
    await this.mfaCredentials.deactivate(credential.id);
    const remaining = await this.mfaCredentials.findActiveByUser(userId);
    if (remaining.length === 0) await this.users.setMfaEnabled(userId, false);
    await this.audit.record({
      userId,
      action: 'UPDATE',
      entityType: 'MfaCredential',
      entityId: credential.id,
    });
  }

  async stepUp(
    userId: string,
    sessionId: string,
    dto: StepUpDto,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (
      !user ||
      !(await this.passwords.verify(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid password');
    }
    if (user.mfaEnabled) {
      if (!dto.code)
        throw new UnauthorizedException('Authentication code required');
      const credential = await this.mfaCredentials.findActiveByUserAndType(
        userId,
        'TOTP',
      );
      if (
        !credential?.secretEnc ||
        !this.mfa.verifyCode(dto.code, credential.secretEnc)
      ) {
        throw new UnauthorizedException('Invalid authentication code');
      }
    }
    await this.sessions.stepUp(sessionId);
    await this.audit.record({
      userId,
      action: 'STEP_UP_VERIFIED',
      entityType: 'User',
      entityId: userId,
    });
  }

  async me(userId: string, sessionId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const roles = await this.users.getRoleNames(userId);
    const config = await this.securityConfig.get();
    const stepUpFresh = await this.sessions.isStepUpFresh(sessionId);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      languagePreference: user.languagePreference,
      roles,
      mfaEnabled: user.mfaEnabled,
      mfaPolicySatisfied: this.mfaPolicySatisfied(user, roles),
      accessValidUntil: user.accessValidUntil,
      idleTimeoutMinutes: config.idleTimeoutMinutes,
      hardLogoutAfterIdleMinutes: config.hardLogoutAfterIdleMinutes,
      stepUpFresh,
    };
  }

  private mfaPolicySatisfied(user: User, roles: RoleName[]): boolean {
    // WebAuthn is not implemented yet (see A.1 plan) — privileged roles can
    // never satisfy the hardware-token requirement today, so this is
    // surfaced to the frontend as a banner, never used to block login.
    return user.mfaEnabled && !requiresHardwareToken(roles);
  }

  private assertAccessWindowActive(user: User): void {
    const now = Date.now();
    if (user.accessValidFrom && user.accessValidFrom.getTime() > now) {
      throw new ForbiddenException('Your access window has not started yet');
    }
    if (user.accessValidUntil && user.accessValidUntil.getTime() < now) {
      throw new ForbiddenException('Your time-boxed access window has ended');
    }
  }

  private async recordFailedLogin(user: User): Promise<void> {
    const config = await this.securityConfig.get();
    const nextAttempts = user.failedLoginAttempts + 1;
    const lockUntil =
      nextAttempts >= config.maxFailedLoginAttempts
        ? new Date(Date.now() + config.lockoutMinutes * 60 * 1000)
        : null;
    await this.users.recordFailedLogin(user.id, lockUntil);
    await this.audit.record({
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
    });
  }

  private async issueSession(
    user: User,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const config = await this.securityConfig.get();
    const refreshTokenSecret = this.tokens.issueOpaqueSecret();
    const refreshTokenExpiresAt = new Date(
      Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    const storedRefreshToken = await this.refreshTokens.create({
      userId: user.id,
      tokenHash: refreshTokenSecret.hash,
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenId: storedRefreshToken.id,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
    const accessToken = this.tokens.signAccessToken(
      { sub: user.id, sid: session.id },
      config.accessTokenTtlMinutes,
    );
    await this.users.recordSuccessfulLogin(user.id);
    const roles = await this.users.getRoleNames(user.id);
    await this.audit.record({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });

    return {
      accessToken,
      refreshToken: refreshTokenSecret.raw,
      refreshTokenExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles,
        mfaEnabled: user.mfaEnabled,
        mfaPolicySatisfied: this.mfaPolicySatisfied(user, roles),
      },
    };
  }
}
