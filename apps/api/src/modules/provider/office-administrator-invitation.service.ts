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
import { OFFICE_ADMINISTRATOR_ROLE_NAME } from './office-administrator-grants';
import type { InviteOfficeAdministratorDto } from './dto/invite-office-administrator.dto';

/**
 * MODULE 0-ب ITEM (f), BROKERAGE HALF — the provider gives a registered office its first account.
 *
 * ## THE ONLY ROUTE IN THIS PRODUCT THAT WRITES INTO ANOTHER TENANT
 *
 * Everything else is bounded by tenancy: `tenantScopeExtension` takes `organizationId` from the
 * ambient context, so a service cannot reach another office's rows even by mistake. This route has
 * to, because the office it is writing into contains nobody who could do it instead.
 *
 * It uses `OrgContextService.runAs(officeId, …)` — the SAME mechanism the registration route next
 * door uses to write the new office's administrator role — and not `runUnscoped`. The distinction
 * matters: `runAs` ADOPTS one named organization, so every write inside the block is still filtered,
 * still carries that office's `organizationId`, and still passes RLS. `runUnscoped` removes the
 * filter entirely and exists for the auth bootstrap, which has no organization to adopt yet. Reaching
 * for the stronger tool here would have turned a bounded cross-tenant write into an unbounded one.
 *
 * ## THREE REFUSALS, EACH NAMING WHY
 *
 *   1. The CALLER must be the provider. `provider.office.administrator.invite` is PLATFORM-scoped, so
 *      the office matrix never offers it and `setPermissions` refuses it for a non-provider — but a
 *      hidden control the API still honours is not a boundary, which is item (j)'s third layer.
 *   2. The TARGET must be a brokerage office. Not the provider itself (it has its own operator, from
 *      the seed) and not an insurance company — whose administrator is a DIFFERENT role with a
 *      different code set, deferred to the company half with its own screen.
 *   3. The office must have NO USER YET. This is the FIRST administrator, once. After that the office
 *      administers itself through `POST /admin/users`, which is what every other office does — and
 *      leaving this route open would give the provider a standing ability to add accounts to a live
 *      office, which is a different and much larger capability than bootstrapping an empty one.
 *
 * ## THE INVITED ADMINISTRATOR HAS NO PASSWORD, DELIBERATELY
 *
 * `randomBytes(32)` hashed — the seed's own pattern for the provider operator, whose log line says
 * the same thing: nothing here knows a password, so sign in by requesting a password reset. The
 * account is created with `mustChangePassword: true` so even a reset lands on the change-password
 * step rather than straight into a session.
 *
 * NO EMAIL IS SENT. There is no mail sender wired to anything in this product — `email.integration.*`
 * has no screen and is a recorded gap — and decision B2 put a temporary on-demand script in its place
 * rather than a half-built sender. So this route RETURNS the address it created and says how that
 * person gets in; telling the operator is the operator's job until the sender exists.
 */
@Injectable()
export class OfficeAdministratorInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly audit: AuditService,
    /*
     * THE EXISTING HASHING SERVICE, not `bcrypt` directly — and the compiler is what said so:
     * `bcrypt` is not a dependency of `apps/api` at all (the seed's use of it is in `packages/db`).
     * Which is the better answer anyway: one hashing policy, one cost factor, changed in one place.
     */
    private readonly passwords: PasswordService,
  ) {}

  async invite(
    actor: { id: string; organizationId: string },
    officeId: string,
    dto: InviteOfficeAdministratorDto,
  ): Promise<{
    officeId: string;
    userId: string;
    email: string;
    roleName: string;
    howTheySignIn: 'PASSWORD_RESET';
  }> {
    await this.assertCallerIsTheProvider(actor.organizationId);

    // ---------------------------------------------------------------- REFUSAL 2
    /*
     * `rawPrisma` is not available here and is not wanted: the provider's own context cannot see
     * another organization's rows through the scoped client, so the office is read UNSCOPED-BY-TYPE
     * via the one model that carries no `organizationId` — `Organization` itself. That is why this
     * read works at all, and it is the same read the registration route's refusals use.
     */
    const office = await this.prisma.client.organization.findUnique({
      where: { id: officeId },
      select: { id: true, type: true, legalName: true },
    });
    if (!office) {
      // 404 and not 403: a provider asking about an id that does not exist is told so plainly. There
      // is no cross-office disclosure to protect here — the provider may read every organization's
      // type by design, which is what the office-state dashboard does.
      throw new NotFoundException(
        `No organization ${officeId} exists, so there is nobody to invite an administrator for.`,
      );
    }
    if (office.type !== 'BROKERAGE_OFFICE') {
      throw new ForbiddenException(
        `Organization ${officeId} is a ${office.type}, and this route invites the first administrator of a BROKERAGE OFFICE. ` +
          'The provider organization has its own operator, created by the seed. An insurance company administers itself through a different role with a different code set — ' +
          'that is the company half of item (f), and it ships with the company-facing screen.',
      );
    }

    const invited = await this.orgContext.runAs(officeId, async () => {
      const created = await this.prisma.client.$transaction(async (tx) => {
        // ------------------------------------------------------------ REFUSAL 3
        const existing = await tx.user.count({});
        if (existing > 0) {
          throw new ConflictException(
            `Office ${officeId} already has ${existing} account(s), so it is not waiting for its FIRST administrator. ` +
              'An office with an account administers itself: whoever holds `user.manage` there adds accounts through POST /admin/users. ' +
              'This route bootstraps an empty office once and deliberately does not become a standing provider capability to add accounts to a live one.',
          );
        }

        const role = await tx.role.findFirst({
          where: { name: OFFICE_ADMINISTRATOR_ROLE_NAME, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!role) {
          /*
           * The registration route creates this role in the same transaction as the office, so its
           * absence means the office was not created by that route — or was created and then had its
           * administrator role retired, which is the lockout `isSystem` exists to prevent. Either way
           * this route must not invent a role: it would be guessing at a grant set for somebody
           * else's office, which is the thing `OFFICE_ADMINISTRATOR_GRANTS` exists to stop.
           */
          throw new ConflictException(
            `Office ${officeId} has no ACTIVE ${OFFICE_ADMINISTRATOR_ROLE_NAME} role, so there is nothing to grant the invited administrator. ` +
              'Registration creates that role in the same transaction as the office; its absence means this office was not registered through that route, or its administrator role was retired. ' +
              'This route will not create a role — a grant set invented from outside the office is exactly what the declared catalogue exists to prevent.',
          );
        }

        // A PASSWORD NOBODY KNOWS. Not a placeholder to be replaced later — the account is reached
        // through the reset path, and a guessable interim password is an account with two doors.
        const passwordHash = await this.passwords.hash(
          randomBytes(32).toString('hex'),
        );

        const user = await tx.user.create({
          data: {
            fullName: dto.fullName,
            email: dto.email,
            passwordHash,
            // Even after a reset the first screen is the change-password step, which is the same
            // path every seeded sample account takes.
            mustChangePassword: true,
            languagePreference: 'AR',
            isActive: true,
            authProvider: 'LOCAL',
            /*
             * `DEFAULT`, not a new `INVITED` member. `RegistrationType` is `DEFAULT | WINDOWS` —
             * measured — and adding a value would need its own migration (`ALTER TYPE … ADD VALUE`
             * cannot run in the transaction that adds it) for a value NOTHING WOULD BRANCH ON. That
             * is the `brokerageKind` defect this module has just finished correcting: a field written
             * at creation, read by nobody, carrying a comment that implied it mattered. How the
             * account arrived is on its AUDIT ROW, which is where a question about provenance is
             * actually answered.
             */
            registrationType: 'DEFAULT',
          },
          select: { id: true, email: true },
        });

        /*
         * `{ userId, roleId }` ONLY — `UserRoleAssignment` carries no `grantedBy` column, which the
         * compiler caught. WHO granted it is on the audit row below, which is the right home: the
         * assignment table records the state, the log records the act. Copied from
         * `UserRepository.grantRole` rather than paraphrased.
         */
        await tx.userRoleAssignment.create({
          data: { userId: user.id, roleId: role.id },
        });

        return { userId: user.id, email: user.email };
      });

      return {
        officeId,
        userId: created.userId,
        email: created.email,
        roleName: OFFICE_ADMINISTRATOR_ROLE_NAME,
        howTheySignIn: 'PASSWORD_RESET' as const,
      };
    });

    /*
     * THE AUDIT ROW IS WRITTEN OUTSIDE `runAs`, IN THE PROVIDER'S OWN LOG — and both halves of that
     * were wrong in the first two versions, each failing differently.
     *
     * (1) INSIDE the `$transaction` callback, every invite was a 500:
     *
     *       new row violates row-level security policy for table "AuditLogEntry"
     *
     *     `AuditService.record` uses its OWN client, not the `tx` handed to the callback, so inside
     *     an interactive transaction it runs on a DIFFERENT CONNECTION — one where this
     *     transaction's `app.current_org_id` was never set, and RLS refuses the insert.
     *
     * (2) INSIDE `runAs` but after the commit, it succeeded and wrote the row into the OFFICE's
     *     tenant — and that is worse than a failure, because it works. An office carrying an audit
     *     row can NEVER BE DELETED (`AuditLogEntry_organizationId_fkey` is `ON DELETE RESTRICT`, and
     *     DELETE on the table is refused outright by `audit_log_entry_no_delete`), which stranded
     *     two offices in db-test and would have stranded one per real invitation. And the row's
     *     ACTOR is a PROVIDER user, so an office reading its own log would find a `userId` its own
     *     tenant-scoped actor lookup cannot resolve — a row naming somebody the office cannot see.
     *
     * So the act belongs where the ACTOR lives: the provider's log. This is exactly what
     * `office-registration.service.ts` does one file away — its `runAs(...)` closes and the audit
     * follows — which is why registered offices are deletable at all. Read rather than assumed: the
     * arrow body there IS the transaction, so the audit sits outside both.
     *
     * The office is not left without a record. It can see the account, its role and its creation
     * time in its own tables; what it cannot see is the provider's act, which is the provider's to
     * answer for. The REASON is recorded because this is the one cross-tenant write, and "who did
     * it" without "why" is a row nobody can review. The password hash is never recorded — there is
     * nothing to record, which is the point of generating one nobody holds.
     */
    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'User',
      entityId: invited.userId,
      afterValue: {
        officeId,
        email: invited.email,
        roleName: OFFICE_ADMINISTRATOR_ROLE_NAME,
        invitedByProviderUserId: actor.id,
        reason: dto.reason,
        howTheySignIn: 'PASSWORD_RESET',
      },
    });

    return invited;
  }

  /**
   * ITEM (j)'s THIRD LAYER, on the route that reaches furthest.
   *
   * The permission is PLATFORM-scoped, so the office matrix never offers it and `setPermissions`
   * refuses it for a non-provider organization. This is the third layer, and it is the one that
   * matters most here: the other two keep an office from HOLDING the code, and this one keeps a
   * holder from USING it if it ever got one.
   *
   * The refusal NAMES WHY rather than returning a bare 403, which would read as a missing grant and
   * send somebody asking for one that cannot help them.
   */
  private async assertCallerIsTheProvider(organizationId: string) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    if (org?.type !== 'PROVIDER') {
      throw new ForbiddenException(
        "Only the platform provider may invite an office's first administrator. This organization is " +
          `a ${org?.type ?? 'unknown type'}, and the capability creates an account inside ANOTHER office — ` +
          'which is why holding the permission is not enough on its own.',
      );
    }
  }
}
