import {
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { OrganizationResolutionService } from '../../organization/organization-resolution.service';
import { AuditService } from '../../audit/audit.service';
import { CodedForbiddenException } from '../auth.exceptions';
import type { AuthenticatedUser } from '../auth.types';

export class TenantMismatchException extends CodedForbiddenException {
  constructor() {
    super(
      'TENANT_MISMATCH',
      'This session belongs to a different office than the address it was used on.',
    );
  }
}

/**
 * Part II §4.10.3 — "the request's resolved org must match the org embedded in
 * the resolved subdomain — a mismatch is a hard 403, logged as a security
 * event".
 *
 * Runs after `JwtAuthGuard`, so `request.user.organizationId` is the office the
 * session actually belongs to, resolved from the session row rather than from
 * anything the client sent.
 *
 * ## When it does nothing, and why that is correct
 *
 * A host that names no office — `localhost`, an IP, the apex domain, `api.` —
 * resolves to null and the check is skipped. Every local, CI and e2e request
 * looks like that, and failing them would make the system unreachable outside
 * production DNS while proving nothing: with no subdomain there is no second
 * opinion to disagree with the session.
 *
 * The check bites exactly where it should — a real office subdomain that
 * resolves to a DIFFERENT office than the token's. That is either a bug or
 * someone carrying a token between offices, and both deserve the same answer.
 *
 * An unknown-but-well-formed subdomain is also skipped rather than refused:
 * refusing would turn this guard into a way to probe which labels are
 * registered, and §4.10.4 rules out exactly that inference.
 */
@Injectable()
export class TenantMatchGuard implements CanActivate {
  private readonly logger = new Logger(TenantMatchGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly resolution: OrganizationResolutionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) return true; // JwtAuthGuard already rejected this.

    const label = this.resolution.subdomainFromHost(request.headers.host);
    if (!label) return true;

    const organization = await this.resolution.findBySubdomain(label);
    if (!organization) return true;

    if (organization.id === request.user.organizationId) return true;

    this.logger.error(
      `Tenant mismatch: session belongs to ${request.user.organizationId} but the request arrived on the subdomain of ${organization.id}.`,
    );
    // Recorded against the SESSION's office — the one whose user actually did
    // this — so it lands in the audit trail of the office that can act on it.
    await this.audit.record({
      userId: request.user.id,
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: request.user.id,
      afterValue: {
        reason: 'TENANT_MISMATCH',
        subdomain: label,
        // Both ids, because which office a token was carried TO is the whole
        // point of the event.
        sessionOrganizationId: request.user.organizationId,
        requestedOrganizationId: organization.id,
      },
    });
    throw new TenantMismatchException();
  }
}
