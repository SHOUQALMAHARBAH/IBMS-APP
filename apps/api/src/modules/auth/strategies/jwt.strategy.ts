import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtSecret } from '../../../common/crypto.util';
import { SessionService } from '../services/session.service';
import type { AccessTokenPayload } from '../services/token.service';
import type { AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessionService: SessionService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  // Throwing here propagates through passport as the `err` argument to
  // JwtAuthGuard#handleRequest, which re-throws it — that's how a specific
  // CodedUnauthorizedException (idle timeout vs access-window vs revoked)
  // survives instead of collapsing into a generic 401.
  validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // `validateAndTouch` establishes the Organization itself: it resolves the
    // session unscoped (the one lookup that cannot already know the org), then
    // adopts that session's Organization for the rest of the request. Wrapping
    // the call here instead would put its audit writes inside the bypass too.
    return this.sessionService.validateAndTouch(payload.sub, payload.sid);
  }
}
