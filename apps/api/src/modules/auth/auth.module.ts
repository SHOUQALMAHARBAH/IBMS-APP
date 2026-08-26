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
import { RolesGuard } from './guards/roles.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { UserRepository } from '../../repositories/user.repository';
import { RefreshTokenRepository } from '../../repositories/refresh-token.repository';
import { UserSessionRepository } from '../../repositories/user-session.repository';
import { MfaCredentialRepository } from '../../repositories/mfa-credential.repository';
import { PasswordResetTokenRepository } from '../../repositories/password-reset-token.repository';
import { SecurityConfigRepository } from '../../repositories/security-config.repository';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, SsoController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    MfaService,
    SessionService,
    SecurityConfigService,
    JwtStrategy,
    UserRepository,
    RefreshTokenRepository,
    UserSessionRepository,
    MfaCredentialRepository,
    PasswordResetTokenRepository,
    SecurityConfigRepository,
    // Global guard chain — order matters: authenticate, then MFA-policy
    // gate, then role gate, then step-up freshness. Each is a no-op when
    // its route has no matching decorator (see each guard's canActivate).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MfaRequiredGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
  exports: [SessionService, SecurityConfigService, UserRepository],
})
export class AuthModule {}
