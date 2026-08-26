import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { RequireRoles } from './decorators/require-roles.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
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
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, requestMeta(req));
    if ('mfaRequired' in result) return result;
    return issuedSessionResponse(res, result);
  }

  @Public()
  @Post('mfa/totp/challenge/verify')
  @HttpCode(200)
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
  @Post('session/heartbeat')
  @HttpCode(200)
  heartbeat() {
    // JwtAuthGuard already touched lastActivityAt by getting this far —
    // this endpoint exists purely so the frontend idle timer has something
    // to call during page-view-only activity between real API calls.
    return { ok: true };
  }

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('security-config.read')
  @Get('security-config')
  getSecurityConfig() {
    return this.securityConfig.get();
  }

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('security-config.manage')
  @Put('security-config')
  updateSecurityConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SecurityConfigUpdateDto,
  ) {
    return this.securityConfig.update(dto, user.id);
  }
}
