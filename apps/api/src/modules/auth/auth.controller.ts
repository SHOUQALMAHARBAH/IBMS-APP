import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './services/auth.service';
import { SecurityConfigService } from './services/security-config.service';
import { Public } from './decorators/public.decorator';
import { SkipMfaRequired } from './decorators/skip-mfa-required.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangePasswordDto,
  ForceChangePasswordDto,
} from './dto/password-change.dto';
import {
  AuthRateLimit,
  PasswordRateLimit,
  MfaRateLimit,
} from '../../common/rate-limit.decorator';
import {
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE,
  setRefreshTokenCookie,
} from './cookies.util';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  MfaChallengeVerifyDto,
  MfaDisableDto,
  MfaEnrollVerifyDto,
} from './dto/mfa.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { StepUpDto } from './dto/step-up.dto';
import { SecurityConfigUpdateDto } from './dto/security-config-update.dto';
import { UpdateLanguagePreferenceDto } from './dto/update-language-preference.dto';
import type { AuthenticatedUser } from './auth.types';
import type { IssuedSession } from './services/auth.service';

const meSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    email: { type: 'string' as const },
    fullName: { type: 'string' as const },
    languagePreference: { type: 'string' as const },
    roles: { type: 'array' as const, items: { type: 'string' as const } },
    /** Part IV §10.4 — the caller's RESOLVED permission codes, sorted. The
     * single source the frontend drives every conditional render from. */
    permissions: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    mfaEnabled: { type: 'boolean' as const },
    mfaPolicySatisfied: { type: 'boolean' as const },
    accessValidUntil: { type: 'string' as const, nullable: true },
    idleTimeoutMinutes: { type: 'number' as const },
    hardLogoutAfterIdleMinutes: { type: 'number' as const },
    stepUpFresh: { type: 'boolean' as const },
  },
  required: [
    'id',
    'email',
    'fullName',
    'permissions',
    'roles',
    'mfaEnabled',
    'mfaPolicySatisfied',
  ],
};

function requestMeta(req: Request) {
  return { userAgent: req.get('user-agent') ?? undefined, ipAddress: req.ip };
}

function issuedSessionResponse(res: Response, result: IssuedSession) {
  setRefreshTokenCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
  return { accessToken: result.accessToken, user: result.user };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly securityConfig: SecurityConfigService,
  ) {}

  @Public()
  @Post('signup')
  @AuthRateLimit()
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @AuthRateLimit()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, requestMeta(req));
    // Part II §4.3.1 — an onboarding outcome is returned as-is, WITHOUT setting
    // a session cookie: the caller gets a token that reaches the mandatory
    // password change and nothing else.
    if ('outcome' in result) return result;
    if ('mfaRequired' in result) return result;
    return issuedSessionResponse(res, result);
  }

  /**
   * Part II §4.3.1 — the one mandatory password change.
   *
   * Public because the caller has no session yet, by design. Authorisation
   * comes from the onboarding token in the body, which `login` issued only
   * after verifying the password.
   */
  @Public()
  @Post('password/force-change')
  @HttpCode(200)
  @AuthRateLimit()
  async forceChangePassword(
    @Body() dto: ForceChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.forceChangePassword(dto, requestMeta(req));
    return issuedSessionResponse(res, result);
  }

  /** Part II §4.7 — self-service change, post-onboarding. Revokes every other
   * session for this user. */
  @SkipMfaRequired()
  @Post('password/change')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, user.sessionId, dto);
  }

  /** Part II §4.4 — the devices this user has chosen to trust. */
  @Get('trusted-devices')
  listTrustedDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listTrustedDevices(user.id);
  }

  /**
   * Part II §4.4 — revokes one trusted device, forcing the MFA prompt again on
   * it. A user may only revoke their own.
   */
  @Post('trusted-devices/:id/revoke')
  @HttpCode(200)
  revokeTrustedDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.auth.revokeTrustedDevice(user.id, id);
  }

  @Public()
  @Post('mfa/totp/challenge/verify')
  @HttpCode(200)
  @MfaRateLimit()
  async verifyMfaChallenge(
    @Body() dto: MfaChallengeVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyMfaChallenge(dto, requestMeta(req));
    return issuedSessionResponse(res, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!raw) {
      res.status(401);
      return { message: 'No refresh session present' };
    }
    const result = await this.auth.refresh(raw, requestMeta(req));
    setRefreshTokenCookie(
      res,
      result.refreshToken,
      result.refreshTokenExpiresAt,
    );
    return { accessToken: result.accessToken };
  }

  @SkipMfaRequired()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.auth.logout(user.sessionId, raw, user.id);
    clearRefreshTokenCookie(res);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @PasswordRateLimit()
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const result = await this.auth.forgotPassword(dto, req.ip);
    return {
      message: 'If that email is registered, a reset link has been sent.',
      ...result,
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @PasswordRateLimit()
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { ok: true };
  }

  @SkipMfaRequired()
  @Post('mfa/totp/enroll')
  enrollTotp(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.enrollTotp(user.id, user.email);
  }

  @SkipMfaRequired()
  @Post('mfa/totp/enroll/verify')
  @HttpCode(200)
  verifyTotpEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaEnrollVerifyDto,
  ) {
    return this.auth.verifyTotpEnrollment(user.id, dto);
  }

  @SkipMfaRequired()
  @Post('mfa/totp/disable')
  @HttpCode(200)
  disableTotp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaDisableDto,
  ) {
    return this.auth.disableTotp(user.id, dto);
  }

  @Post('step-up')
  @HttpCode(200)
  stepUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: StepUpDto) {
    return this.auth.stepUp(user.id, user.sessionId, dto);
  }

  @SkipMfaRequired()
  @Get('me')
  @ApiOkResponse({
    description:
      'The current authenticated user + session/security config info.',
    schema: meSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated, session expired, or access window ended.',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id, user.sessionId);
  }

  @SkipMfaRequired()
  @Patch('me/language')
  @ApiOkResponse({
    description:
      'The current authenticated user, with the new language preference applied.',
    schema: meSchema,
  })
  updateLanguagePreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLanguagePreferenceDto,
  ) {
    return this.auth.updateLanguagePreference(
      user.id,
      user.sessionId,
      dto.languagePreference,
    );
  }

  @SkipMfaRequired()
  @Post('session/heartbeat')
  @HttpCode(200)
  heartbeat() {
    // JwtAuthGuard already touched lastActivityAt by getting this far —
    // this endpoint exists purely so the frontend idle timer has something
    // to call during page-view-only activity between real API calls.
    return { ok: true };
  }

  @RequirePermissions('security-config.read')
  @Get('security-config')
  getSecurityConfig() {
    return this.securityConfig.get();
  }

  @RequirePermissions('security-config.manage')
  @Put('security-config')
  updateSecurityConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SecurityConfigUpdateDto,
  ) {
    return this.securityConfig.update(dto, user.id);
  }
}
