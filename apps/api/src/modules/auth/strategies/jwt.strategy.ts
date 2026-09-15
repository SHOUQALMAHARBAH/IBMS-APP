import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtSecret } from '../../../common/crypto.util';
import { SessionService } from '../services/session.service';
import type { AccessTokenPayload } from '../services/token.service';
import type { AuthenticatedUser } from '../auth.types';
import { SessionRevokedException } from '../auth.exceptions';

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
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // `validateAndTouch` establishes the Organization itself: it resolves the
    // session unscoped (the one lookup that cannot already know the org), then
    // adopts that session's Organization for the rest of the request. Wrapping
    // the call here instead would put its audit writes inside the bypass too.
    // A token that names no session is not an access token — the short-lived
    // onboarding and MFA-challenge tokens both look like this. Rejecting them
    // here is what keeps them scoped to the one endpoint that consumes them;
    // without this the session lookup runs with an undefined id and Prisma
    // raises, surfacing as a 500 where the caller should simply be told no.
    if (!payload?.sid || !payload?.sub) {
      throw new SessionRevokedException();
    }

    const user = await this.sessionService.validateAndTouch(
      payload.sub,
      payload.sid,
    );

    // Part II §4.10.2 — the token's own Organization claim must agree with the
    // session it names. The session row is the source of truth; the claim is
    // the part the client holds, so a disagreement means the token was forged
    // or tampered with, and neither is something to serve.
    //
    // `org` is optional on the incoming payload only because a token issued
    // moments before this deploy will not carry one; those expire within the
    // access-token TTL and are then gone. Once present, it must match.
    if (payload.org !== undefined && payload.org !== user.organizationId) {
      throw new SessionRevokedException();
    }
    return user;
  }
}
