import { PermissionsModule } from '../rbac/permissions.module';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { SsoController } from './sso/sso.controller';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { MfaService } from './services/mfa.service';
import { SessionService } from './services/session.service';
import { SecurityConfigService } from './services/security-config.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MfaRequiredGuard } from './guards/mfa-required.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { UserRepository } from '../../repositories/user.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { RefreshTokenRepository } from '../../repositories/refresh-token.repository';
import { UserSessionRepository } from '../../repositories/user-session.repository';
import { MfaCredentialRepository } from '../../repositories/mfa-credential.repository';
import { PasswordResetTokenRepository } from '../../repositories/password-reset-token.repository';
import { SecurityConfigRepository } from '../../repositories/security-config.repository';
import { EmailModule } from '../email/email.module';
import { TrustedDeviceService } from './services/trusted-device.service';
import { TrustedDeviceRepository } from '../../repositories/trusted-device.repository';
import { PasswordHistoryRepository } from '../../repositories/password-history.repository';
import { TenantMatchGuard } from './guards/tenant-match.guard';
import { OrganizationModule } from '../organization/organization.module';

@Module({
  imports: [
    OrganizationModule,
    EmailModule,
    PassportModule,
    JwtModule.register({}),
    PermissionsModule,
  ],
  controllers: [AuthController, SsoController],
  providers: [
    TrustedDeviceService,
    TrustedDeviceRepository,
    PasswordHistoryRepository,
    AuthService,
    PasswordService,
    TokenService,
    MfaService,
    SessionService,
    SecurityConfigService,
    JwtStrategy,
    UserRepository,
    OrganizationRepository,
    RefreshTokenRepository,
    UserSessionRepository,
    MfaCredentialRepository,
    PasswordResetTokenRepository,
    SecurityConfigRepository,
    // Global guard chain — order matters: authenticate, then MFA-policy
    // gate, then step-up freshness. Each is a no-op when its route has no
    // matching decorator (see each guard's canActivate).
    //
    // There is no role guard. Phase 2 removed `RolesGuard` and
    // `@RequireRoles` entirely: a role NAME is only unique within one office,
    // so a name gate cannot express "an administrator of THIS office" and
    // hard-blocked any custom role from the 19 routes that carried it. Every
    // one of those routes already carried an equivalent `@RequirePermissions`,
    // which is now the only authorization gate there is.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Part II §4.10.3 — immediately after the JWT guard, so the session's
    // Organization is known, and BEFORE the onboarding/role guards: a token
    // used on another office's address is refused regardless of what it is
    // otherwise entitled to do.
    { provide: APP_GUARD, useClass: TenantMatchGuard },
    { provide: APP_GUARD, useClass: MfaRequiredGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
  exports: [
    SessionService,
    SecurityConfigService,
    UserRepository,
    // RbacModule's UserAdminService hashes the provisioned account's password
    // with the same Part 10.1 policy + bcrypt cost signup and reset use.
    PasswordService,
  ],
})
export class AuthModule {}
