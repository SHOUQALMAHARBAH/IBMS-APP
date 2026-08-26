import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SessionService } from '../services/session.service';
import type { AccessTokenPayload } from '../services/token.service';
import type { AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessionService: SessionService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_ACCESS_SECRET ??
        'dev-insecure-secret-change-me-32chars-minimum',
    });
  }

  // Throwing here propagates through passport as the `err` argument to
  // JwtAuthGuard#handleRequest, which re-throws it — that's how a specific
  // CodedUnauthorizedException (idle timeout vs access-window vs revoked)
  // survives instead of collapsing into a generic 401.
  validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    return this.sessionService.validateAndTouch(payload.sub, payload.sid);
  }
}
