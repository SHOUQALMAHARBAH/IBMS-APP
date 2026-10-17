import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgContextService } from '../../common/org-context/org-context.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/services/password.service';
import { INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME } from './insurance-company-administrator-grants';
import type { InviteOfficeAdministratorDto } from './dto/invite-office-administrator.dto';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — the provider gives a registered insurance company its first
 * account.
 *
 * ## THE SAME MECHANISM AS THE OFFICE HALF, AND DELIBERATELY NOT A SHARED ONE
 *
 * This is the SECOND route in this product that writes into another tenant, and it uses the same
 * `OrgContextService.runAs(companyId, …)` for the same reason: `runAs` ADOPTS one named organization,
 * so every write inside stays filtered, carries that organization's `organizationId` and passes RLS,
 * where `runUnscoped` would remove the filter entirely. Read
 * `office-administrator-invitation.service.ts` for the full argument — it is not repeated here,
 * because two copies of one argument is how the two drift apart.
 *
 * WHAT IS NOT SHARED IS THE SERVICE ITSELF, and that is a decision. Folding both into one
 * `inviteFirstAdministrator(organizationId)` would need a parameter naming which type is permitted
 * and which role to look up — and the refusal that matters here is precisely "this organization is
 * the wrong KIND". A generic version would take that refusal as configuration, which is the shape
 * that lets a future caller pass the wrong value and bootstrap an account inside a brokerage office
 * through the company route. Two services, two permission codes, two refusals naming their own type.
 *
 * ## THE COMPANY ADMINISTRATOR RECEIVES SIX CODES, NOT 47
 *
 * `INSURANCE_COMPANY_ADMINISTRATOR_GRANTS` is self-administration only, and the shortness is the
 * honest answer rather than something to pad: an insurance company has nothing else to do in this
 * product yet. It reads its own registry record — gated on organization TYPE, not on a code — and
 * has no other capability. That was raised as a stop condition before this was built and the owner's
 * decision was to ship the honest six.
 *
 * ## THE DTO IS SHARED AND THE ROUTE IS NOT
 *
 * `InviteOfficeAdministratorDto` is three fields — email, full name, and a reason of at least ten
 * characters — and an invitation into a company needs exactly the same three. Copying it to rename
 * the type would give the same validation two homes.
 */
@Injectable()
export class CompanyAdministratorInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async invite(
    actor: { id: string; organizationId: string },
    companyId: string,
    dto: InviteOfficeAdministratorDto,
  ) {
    // ---------------------------------------------------------------- REFUSAL 1
    // The caller must be the provider. The PLATFORM-scoped code is the first gate and this is the
    // second: a hidden control the API still honours is not a boundary, which is the rule module 0
    // item (j) established with three layers for exactly this class of route.
    await this.assertCallerIsTheProvider(actor.organizationId);

    // ---------------------------------------------------------------- REFUSAL 2
    const company = await this.prisma.client.organization.findUnique({
      where: { id: companyId },
      select: { id: true, type: true, legalName: true },
    });
    if (!company) {
      throw new NotFoundException(
        `No organization ${companyId} exists, so there is nobody to invite an administrator for.`,
      );
    }
    if (company.type !== 'INSURANCE_COMPANY') {
      throw new ForbiddenException(
        `Organization ${companyId} is a ${company.type}, and this route invites the first administrator of an INSURANCE COMPANY. ` +
          'A brokerage office is bootstrapped by POST /provider/brokerage-offices/:id/administrator, which grants that office its own 47-code administrator role. ' +
          'The two are separate routes with separate codes because they hand over different things.',
      );
    }

    const invited = await this.orgContext.runAs(companyId, async () => {
      const created = await this.prisma.client.$transaction(async (tx) => {
        // ------------------------------------------------------------ REFUSAL 3
        const existing = await tx.user.count({});
        if (existing > 0) {
          throw new ConflictException(
            `Insurance company ${companyId} already has ${existing} account(s), so it is not waiting for its FIRST administrator. ` +
              'A company with an account administers itself: whoever holds `user.manage` there adds accounts through POST /admin/users. ' +
              'This route bootstraps an empty company once and is deliberately not a standing provider capability to add accounts to a live one.',
          );
        }

        const role = await tx.role.findFirst({
          where: {
            name: INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!role) {
          throw new ConflictException(
            `Insurance company ${companyId} has no ACTIVE ${INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME} role, so there is nothing to grant the invited administrator. ` +
              'Registration creates that role in the same transaction as the company; its absence means this company predates that step or had its administrator role retired. ' +
              'This route will not create a role — a grant set invented from outside is what the declared catalogue exists to prevent.',
          );
        }

        // A password nobody knows, reached only through the reset path. Same as the office half.
        const passwordHash = await this.passwords.hash(
          randomBytes(32).toString('hex'),
        );

        const user = await tx.user.create({
          data: {
            fullName: dto.fullName,
            email: dto.email,
            passwordHash,
            mustChangePassword: true,
            languagePreference: 'AR',
            isActive: true,
            authProvider: 'LOCAL',
            // `DEFAULT` rather than a new `INVITED` member, for the reason the office half records:
            // a value nothing branches on is the `brokerageKind` defect. Provenance is on the audit row.
            registrationType: 'DEFAULT',
          },
          select: { id: true, email: true },
        });

        await tx.userRoleAssignment.create({
          data: { userId: user.id, roleId: role.id },
        });

        return { userId: user.id, email: user.email };
      });

      return {
        companyId,
        userId: created.userId,
        email: created.email,
        roleName: INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME,
        howTheySignIn: 'PASSWORD_RESET' as const,
      };
    });

    /*
     * OUTSIDE `runAs`, IN THE PROVIDER'S OWN LOG — and both halves of that placement were learned the
     * hard way on the office half, which is why this one is written correctly the first time:
     *
     *   INSIDE the `$transaction` callback  -> `AuditService.record` uses its OWN client, so it runs
     *                                          on a connection where `app.current_org_id` was never
     *                                          set and RLS refuses the insert. Every invite a 500.
     *   INSIDE `runAs`                      -> it succeeds, and writes the row into the COMPANY's log,
     *                                          where `AuditLogEntry`'s FKs are ON DELETE RESTRICT and
     *                                          an append-only trigger forbids deletion. One row makes
     *                                          that organization permanently undeletable. Two offices
     *                                          were stranded in db-test learning this.
     *
     * So: the provider did this, and it belongs in the provider's log.
     */
    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'User',
      entityId: invited.userId,
      afterValue: {
        insuranceCompanyId: companyId,
        companyLegalName: company.legalName,
        email: dto.email,
        roleName: invited.roleName,
        invitedByProviderUserId: actor.id,
        // The reason is MANDATORY on the DTO and recorded here. This is the only class of write that
        // crosses a tenancy boundary, and "who did it" without "why" is a row nobody can review.
        reason: dto.reason,
        howTheySignIn: invited.howTheySignIn,
      },
    });

    return invited;
  }

  private async assertCallerIsTheProvider(organizationId: string) {
    const caller = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    if (caller?.type !== 'PROVIDER') {
      throw new ForbiddenException(
        'Only the platform provider may invite an insurance company administrator. ' +
          'This is the second of two routes in this product that write into another tenant, and the provider is the only organization that may.',
      );
    }
  }
}
