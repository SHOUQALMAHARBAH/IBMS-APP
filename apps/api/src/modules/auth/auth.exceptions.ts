import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

/**
 * UnauthorizedException carrying a stable machine-readable `code` in its
 * response body so the frontend can distinguish "idle timeout, show the
 * lock screen" from "logged out, go to /login" instead of string-matching
 * a human message.
 */
export class CodedUnauthorizedException extends UnauthorizedException {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super({ code, message });
  }
}

export class SessionRevokedException extends CodedUnauthorizedException {
  constructor() {
    super('SESSION_REVOKED', 'This session has been signed out.');
  }
}

export class SessionIdleTimeoutException extends CodedUnauthorizedException {
  constructor() {
    super('SESSION_IDLE_TIMEOUT', 'Session expired due to inactivity.');
  }
}

export class AccessWindowExpiredException extends CodedUnauthorizedException {
  constructor() {
    super('ACCESS_WINDOW_EXPIRED', 'Your time-boxed access window has ended.');
  }
}

/**
 * 403, not 401 — the caller IS authenticated, they're just not permitted to
 * reach this route until they complete a required step (step-up re-auth,
 * MFA enrollment). Kept distinct from CodedUnauthorizedException so a 401
 * always means "not authenticated / session invalid, go to /login" and a
 * 403 always means "authenticated, but blocked until you do X."
 */
export class CodedForbiddenException extends ForbiddenException {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super({ code, message });
  }
}

export class StepUpRequiredException extends CodedForbiddenException {
  constructor() {
    super('STEP_UP_REQUIRED', 'Re-authentication is required for this action.');
  }
}

export class MfaRequiredException extends CodedForbiddenException {
  constructor() {
    super(
      'MFA_ENROLLMENT_REQUIRED',
      'Multi-factor authentication must be enrolled before continuing.',
    );
  }
}
