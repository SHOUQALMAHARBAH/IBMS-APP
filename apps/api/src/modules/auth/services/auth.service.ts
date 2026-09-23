import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { User } from '@ibms/db';
import { resolveDisplayName } from '../../../common/display-name.util';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { UserRepository } from '../../../repositories/user.repository';
import { OrganizationRepository } from '../../../repositories/organization.repository';
import { OrgContextService } from '../../../common/org-context/org-context.service';
import { RefreshTokenRepository } from '../../../repositories/refresh-token.repository';
import { MfaCredentialRepository } from '../../../repositories/mfa-credential.repository';
import { PasswordResetTokenRepository } from '../../../repositories/password-reset-token.repository';
import { AuditService } from '../../audit/audit.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { SecurityConfigService } from './security-config.service';
import {
  roleSecurityAttributes,
  type RoleSecurityAttributes,
} from '../auth.types';
import { TrustedDeviceService } from './trusted-device.service';
import { PasswordHistoryRepository } from '../../../repositories/password-history.repository';
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
import type {
  ChangePasswordDto,
  ForceChangePasswordDto,
} from '../dto/password-change.dto';
import { OutboundEmailService } from '../../email/outbound-email.service';

/** Part II §4.3.1 — the purpose token that reaches the mandatory password
 * change and nothing else. */
const ONBOARDING_PURPOSE = 'onboarding';
const ONBOARDING_TTL_MINUTES = 15;

/** Part II §4.7.3 — "reject reuse of, e.g., the last 5 passwords". */
const PASSWORD_HISTORY_DEPTH = 5;

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
  roles: string[];
  mfaEnabled: boolean;
  mfaPolicySatisfied: boolean;
}

const MFA_CHALLENGE_PURPOSE = 'mfa_challenge';
const MFA_CHALLENGE_TTL_MINUTES = 5;
const PASSWORD_RESET_TTL_MINUTES = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly outboundEmail: OutboundEmailService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly passwordHistory: PasswordHistoryRepository,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly mfaCredentials: MfaCredentialRepository,
    private readonly passwordResetTokens: PasswordResetTokenRepository,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly permissionsService: PermissionsService,
    private readonly securityConfig: SecurityConfigService,
    private readonly organizations: OrganizationRepository,
    private readonly orgContext: OrgContextService,
  ) {}

  async signup(dto: SignupDto): Promise<{ id: string; email: string }> {
    const violations = this.passwords.validatePolicy(dto.password);
    if (violations.length > 0) throw new BadRequestException(violations);

    // Multi-tenancy Phase 2 — signup is the one anonymous path with no user to
    // read an Organization from, so it resolves the platform's SOLE
    // Organization and refuses if there is more than one. That refusal is the
    // point: it makes onboarding a second office impossible until Phase 4
    // resolves the org from the subdomain BEFORE the signup form (§4.10),
    // rather than silently filing the new account under an arbitrary office.
    const organizationId = await this.organizations.soleOrganizationIdOrThrow();
    this.orgContext.adopt(organizationId);

    const existing = await this.users.findByEmailInOrganization(
      organizationId,
      dto.email,
    );
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

  /**
   * Part II §4.3.1 — the password step of onboarding deliberately hands back a
   * purpose token, NOT a session: "response is MUST_CHANGE_PASSWORD, not a
   * session token". It reaches exactly one endpoint,
   * `POST /auth/password/force-change`, and expires quickly.
   */
  private onboardingToken(userId: string): string {
    return this.tokens.signShortLivedPurposeToken(
      { sub: userId, purpose: ONBOARDING_PURPOSE },
      ONBOARDING_TTL_MINUTES,
    );
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta,
  ): Promise<
    | { mfaRequired: true; mfaChallengeToken: string }
    | { outcome: 'MUST_CHANGE_PASSWORD'; onboardingToken: string }
    | IssuedSession
  > {
    // Only the lookup is unscoped — working out which Organization this caller
    // belongs to is exactly what it is for. Everything after `adopt()` (the
    // failed-login counter, the session, the audit entry) is properly scoped.
    const user = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.users.findByEmailAcrossOrganizations(dto.email),
    );
    if (!user) throw new UnauthorizedException('Invalid email or password');
    this.orgContext.adopt(user.organizationId);

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

    // The password counts as proven from here, so the failed-attempt counter is
    // cleared even when the outcome below is an onboarding step rather than a
    // session — otherwise someone stuck mid-onboarding accumulates failures
    // from a password that was in fact correct.
    await this.users.resetFailedLoginAttempts(user.id);

    // Part II §4.3.1 — the mandatory first password change outranks everything
    // else, including MFA. The admin who provisioned this account knows the
    // temporary password; nothing else may happen until it is rotated.
    if (user.mustChangePassword) {
      await this.audit.record({
        userId: user.id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        afterValue: { outcome: 'MUST_CHANGE_PASSWORD' },
      });
      return {
        outcome: 'MUST_CHANGE_PASSWORD' as const,
        onboardingToken: this.onboardingToken(user.id),
      };
    }

    // Part II §4.4 — a live trust on THIS device lets a standard role skip the
    // prompt. Never for an always-MFA role, and never without a password first:
    // this shortens the second factor, it never replaces the first.
    //
    // Resolved from the roles' own security attributes, not their names: a name
    // list could not recognise a role an office defined, so a custom role
    // silently qualified for the skip (see `RoleSecurityAttributes`).
    // `mfaEnabled` is a FLAG; an active credential is the FACT. When they disagree — the flag set
    // with nothing behind it — challenging the user is a dead end, not a control: there is no
    // credential to check a code against, so every code they type is wrong and no screen offers a
    // way out. Measured: a fresh account planted into that state answered `mfaRequired: true` with a
    // challenge token, which the web renders as a six-digit box with no QR and nothing to pair.
    //
    // That state is reachable without anyone doing something stupid. Enrolment is TWO calls
    // (`create` then `activate`), so an interrupted enrolment leaves an INACTIVE credential; a
    // cleanup that deletes credentials without clearing the flag lands here; and so does any future
    // "reset this user's MFA" action that forgets one of the two writes.
    //
    // So the honest reading of flag-without-credential is "enrolment owed", and the user is let
    // through to a session — NOT to the application. `MfaRequiredGuard` keys on the same predicate
    // and still refuses every route but enrolment itself, which is why this cannot be a bypass:
    // both sides now ask the same question.
    const activeCredentials = user.mfaEnabled
      ? await this.mfaCredentials.findActiveByUser(user.id)
      : [];

    if (user.mfaEnabled && activeCredentials.length === 0) {
      await this.audit.record({
        userId: user.id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        afterValue: { outcome: 'MFA_ENROLLMENT_OWED_FLAG_WITHOUT_CREDENTIAL' },
      });
      return this.issueSession(user, meta);
    }

    if (user.mfaEnabled) {
      const security = roleSecurityAttributes(
        await this.users.getRoleRefs(user.id),
      );
      const skip = await this.trustedDevices.maySkipMfa(user.id, security, {
        fingerprint: dto.deviceFingerprint,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      });
      if (!skip) {
        const mfaChallengeToken = this.tokens.signShortLivedPurposeToken(
          { sub: user.id, purpose: MFA_CHALLENGE_PURPOSE },
          MFA_CHALLENGE_TTL_MINUTES,
        );
        return { mfaRequired: true, mfaChallengeToken };
      }
    }

    return this.issueSession(user, meta);
  }

  /**
   * Part II §4.3.1 — the one mandatory password change, consuming the
   * onboarding token issued by `login`.
   *
   * Valid ONLY while `mustChangePassword` is true. Once it is false this
   * endpoint is closed and §4.7's self-service change is the way in, which
   * requires the current password — so a leaked onboarding token cannot be
   * replayed later to set a password without knowing the old one.
   */
  async forceChangePassword(
    dto: ForceChangePasswordDto,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.tokens.verifyPurposeToken(dto.onboardingToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired onboarding token');
    }
    if (payload.purpose !== ONBOARDING_PURPOSE) {
      throw new UnauthorizedException('Invalid onboarding token');
    }

    const user = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.users.findById(payload.sub),
    );
    if (!user) throw new UnauthorizedException('Invalid onboarding token');
    this.orgContext.adopt(user.organizationId);

    if (!user.mustChangePassword) {
      throw new ForbiddenException(
        'The mandatory password change has already been completed; use the self-service change instead',
      );
    }
    if (!user.isActive)
      throw new ForbiddenException('This account is disabled');

    await this.applyNewPassword(user, dto.newPassword);

    await this.audit.record({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: user.id,
      afterValue: { reason: 'mandatory_first_change' },
    });

    // Reloaded so the session is issued against the post-change state — in
    // particular `mustChangePassword`, which the onboarding guard reads.
    const updated = await this.users.findById(user.id);
    return this.issueSession(updated ?? user, meta);
  }

  /**
   * Part II §4.7 — self-service password change, available from Settings once
   * onboarding is done.
   */
  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
  ): Promise<{ otherSessionsRevoked: number }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    const currentOk = await this.passwords.verify(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentOk) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.applyNewPassword(user, dto.newPassword);

    // §4.7.4 — every OTHER session is revoked. The one that made the change
    // survives, so the user is not logged out of the screen they are looking
    // at; anyone else holding a session for this account is.
    const revoked = await this.sessions.revokeAllForUserExcept(
      userId,
      sessionId,
      'password_changed',
    );
    // A password change is the moment to stop trusting devices that were
    // trusted under the old one.
    await this.trustedDevices.revokeAllForUser(userId, 'password_changed');

    await this.audit.record({
      userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: userId,
      afterValue: { reason: 'self_service', otherSessionsRevoked: revoked },
    });
    return { otherSessionsRevoked: revoked };
  }

  /**
   * Shared by the mandatory and self-service changes: policy check, reuse
   * check, hash, history append.
   *
   * §4.3.1.4 and §4.7.3 both require the new password to be absent from the
   * user's `PasswordHistoryEntry` rows — reusing the temporary password the
   * admin set would defeat the mandatory change entirely.
   */
  private async applyNewPassword(
    user: User,
    newPassword: string,
  ): Promise<void> {
    this.passwords.assertMeetsPolicy(newPassword);

    const history = await this.passwordHistory.recentForUser(
      user.id,
      PASSWORD_HISTORY_DEPTH,
    );
    for (const previous of [{ passwordHash: user.passwordHash }, ...history]) {
      if (await this.passwords.verify(newPassword, previous.passwordHash)) {
        throw new UnprocessableEntityException(
          `This password has been used before. Choose one you have not used in your last ${PASSWORD_HISTORY_DEPTH} passwords.`,
        );
      }
    }

    const passwordHash = await this.passwords.hash(newPassword);
    // The OLD hash is what goes into history: the new one is live on the user.
    await this.passwordHistory.append(user.id, user.passwordHash);
    await this.users.setPassword(user.id, passwordHash);
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

    const user = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.users.findById(payload.sub),
    );
    if (!user?.mfaEnabled)
      throw new UnauthorizedException('Invalid MFA challenge');
    this.orgContext.adopt(user.organizationId);
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

    // Part II §4.4.2 — the trust grant belongs HERE, right after a verified
    // second factor, and nowhere else: granting it on a password-only step
    // would let a stolen password mint its own MFA bypass.
    if (dto.trustDevice) {
      const security = roleSecurityAttributes(
        await this.users.getRoleRefs(user.id),
      );
      await this.trustedDevices.trust(user.id, security, {
        fingerprint: dto.deviceFingerprint,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      });
    }

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
    // A refresh token is a bearer secret: it is resolved by its value alone,
    // at the point in the flow where the org context does not exist yet —
    // spec §3.1's own reasoning for why these stay globally unique.
    const stored = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.refreshTokens.findByHash(tokenHash),
    );
    if (!stored) throw new UnauthorizedException('Invalid session');
    const refreshingUser = await this.orgContext.runUnscoped(
      'auth-bootstrap',
      () => this.users.findById(stored.userId),
    );
    if (!refreshingUser) throw new UnauthorizedException('Invalid session');
    this.orgContext.adopt(refreshingUser.organizationId);

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
      // The refreshed token carries the SESSION's Organization, not one the
      // caller supplied — a refresh must not be a way to re-issue a token for a
      // different office.
      { sub: stored.userId, sid: session.id, org: session.organizationId },
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
    const user = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.users.findByEmailAcrossOrganizations(dto.email),
    );
    if (!user) return {};
    this.orgContext.adopt(user.organizationId);

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

    // Part I §6 — sent from THIS office's own connected mailbox, never from a
    // platform address. The body carries a link, not the payload: the token is
    // what the link is for, and the new password is chosen inside the platform.
    //
    // A send failure is logged by OutboundEmailService and deliberately NOT
    // surfaced here: this endpoint returns the same shape whether or not the
    // address matched an account, and reporting a mail failure for one email
    // but not another would reintroduce exactly the account enumeration that
    // shape exists to prevent. The reset row is already written either way, so
    // an administrator can still see the mailbox is broken on the integration
    // screen, and the user can retry.
    await this.outboundEmail.send({
      to: dto.email,
      language: user.languagePreference,
      actorUserId: user.id,
      template: {
        kind: 'password_reset',
        params: {
          recipientName: user.fullName,
          resetUrl: `${this.outboundEmail.appBaseUrl}/reset-password?token=${encodeURIComponent(token.raw)}`,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        },
      },
    });

    // Never log the raw token — only ever return it, and only when explicitly
    // opted in via ENABLE_DEV_RESET_TOKEN, so local/e2e testing can exercise
    // the full flow without a mailbox. NODE_ENV=production is a hard override
    // on top of the flag — not the primary gate — so a misconfigured flag can
    // never leak a token in prod even if someone sets it there by mistake.
    if (
      process.env.ENABLE_DEV_RESET_TOKEN === 'true' &&
      process.env.NODE_ENV !== 'production'
    )
      return { devResetToken: token.raw };
    return {};
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const stored = await this.orgContext.runUnscoped('auth-bootstrap', () =>
      this.passwordResetTokens.findByHash(this.tokens.hash(dto.token)),
    );
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const resettingUser = await this.orgContext.runUnscoped(
      'auth-bootstrap',
      () => this.users.findById(stored.userId),
    );
    if (!resettingUser) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    this.orgContext.adopt(resettingUser.organizationId);
    const violations = this.passwords.validatePolicy(dto.newPassword);
    if (violations.length > 0) throw new BadRequestException(violations);

    // Claim the token FIRST, before touching the password — this
    // status-conditional write (not the `stored.usedAt` read above) is what
    // actually closes the race between two concurrent resets presenting the
    // same token; the loser gets the exact same rejection as an
    // already-used token (race-safe-invariants.md).
    const claimed = await this.passwordResetTokens.markUsed(stored.id);
    if (!claimed) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.users.updatePassword(stored.userId, passwordHash);
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
    // Part II §4.3.2.4 — only NOW is enrolment complete. The live code is what
    // marks it, not the act of scanning the QR: an account flipped to
    // `mfaEnabled` at enrolment-start would be one whose authenticator may
    // never have worked, and the user would discover that at their next login,
    // locked out, with no way back in.
    await this.mfaCredentials.activate(credential.id);
    await this.users.completeMfaEnrollment(userId, 'TOTP_APP');
    await this.audit.record({
      userId,
      action: 'MFA_ENROLLED',
      entityType: 'User',
      entityId: userId,
      afterValue: { method: 'TOTP_APP' },
    });
  }

  /** Part II §4.4 — this user's live trusted devices. Never exposes the stored
   * fingerprint hash: it identifies a specific machine, and the user already
   * knows which of their own devices these are from the label and dates. */
  async listTrustedDevices(userId: string) {
    const devices = await this.trustedDevices.list(userId);
    return devices.map((d) => ({
      id: d.id,
      label: d.label,
      trustedAt: d.trustedAt,
      expiresAt: d.expiresAt,
      lastUsedAt: d.lastUsedAt,
    }));
  }

  async revokeTrustedDevice(userId: string, deviceId: string): Promise<void> {
    await this.trustedDevices.revoke(userId, deviceId, userId);
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
    const user = await this.users.findByIdWithDepartment(userId);
    if (!user) throw new NotFoundException('User not found');
    const roleRefs = await this.users.getRoleRefs(userId);
    const roles = roleRefs.map((r) => r.name);
    const config = await this.securityConfig.get();
    const stepUpFresh = await this.sessions.isStepUpFresh(sessionId);
    // Part IV §10.4 — the single source the frontend drives every conditional
    // render from. Roles alone are not enough: the permission grid is what
    // actually decides what an action requires, and a UI branching on role
    // names re-implements that mapping in a second place, where it drifts.
    // That is doubly true now that an office names its own roles — a role
    // called "Manager" means whatever that office made it mean.
    // Resolved from role IDS, never the names above: see
    // `PermissionRepository.findCodesForRoles`. Sorted so the response is
    // stable and diffable.
    const permissions = [
      ...(await this.permissionsService.getCodesForRoles(
        roleRefs.map((r) => r.id),
      )),
    ].sort();

    return {
      id: user.id,
      email: user.email,
      // The HR record when one is linked, the account's own free text when
      // not. Same field name, so nothing downstream changes shape.
      fullName: resolveDisplayName(user),
      languagePreference: user.languagePreference,
      roles,
      permissions,
      mfaEnabled: user.mfaEnabled,
      mfaPolicySatisfied: this.mfaPolicySatisfied(
        user,
        roleSecurityAttributes(roleRefs),
      ),
      accessValidUntil: user.accessValidUntil,
      // Both spellings, not one resolved string: the caller knows which
      // language it is rendering in and `nameAr` is nullable, so picking here
      // would either need the language passed in or would strand Arabic
      // users on the English name. Same optional-Arabic shape
      // KnowledgeBaseArticle uses. Null when the user has no Department —
      // signup grants none, only provisioning does.
      department: user.department
        ? { name: user.department.name, nameAr: user.department.nameAr }
        : null,
      idleTimeoutMinutes: config.idleTimeoutMinutes,
      hardLogoutAfterIdleMinutes: config.hardLogoutAfterIdleMinutes,
      stepUpFresh,
    };
  }

  /**
   * Part F — Bilingual UI, item #1: "a persistent per-user language
   * preference." Every user manages their own — no maker/checker, no
   * permission beyond being signed in (the same self-service shape as
   * `updatePassword`/`setMfaEnabled`). Returns the fresh `me()` shape so the
   * frontend can just re-render from one response, the same round-trip its
   * own instant local UI flip already made optimistically.
   */
  async updateLanguagePreference(
    userId: string,
    sessionId: string,
    languagePreference: 'AR' | 'EN',
  ) {
    await this.users.updateLanguagePreference(userId, languagePreference);
    return this.me(userId, sessionId);
  }

  private mfaPolicySatisfied(
    user: User,
    security: RoleSecurityAttributes,
  ): boolean {
    // WebAuthn is not implemented yet (see A.1 plan) — a role flagged for the
    // hardware-token requirement can never satisfy it today, so this is
    // surfaced to the frontend as a banner, never used to block login.
    return user.mfaEnabled && !security.requiresHardwareToken;
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
      { sub: user.id, sid: session.id, org: user.organizationId },
      config.accessTokenTtlMinutes,
    );
    await this.users.recordSuccessfulLogin(user.id);
    // Names for display in the response, obligations for `mfaPolicySatisfied`
    // — one read, two uses.
    const roleRefs = await this.users.getRoleRefs(user.id);
    const roles = roleRefs.map((r) => r.name);
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
        mfaPolicySatisfied: this.mfaPolicySatisfied(
          user,
          roleSecurityAttributes(roleRefs),
        ),
      },
    };
  }
}
