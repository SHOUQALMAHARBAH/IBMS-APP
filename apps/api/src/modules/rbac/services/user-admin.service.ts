import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, RoleName, type User } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { PasswordService } from '../../auth/services/password.service';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { PermissionsService } from './permissions.service';
import type { ProvisionUserDto } from '../dto/provision-user.dto';
import {
  segregationSignal,
  type SegregationSignal,
} from '../checker-roles.config';

/** A book-wide admin list is a console view, not a report — capped like every
 * other unbounded read in this codebase (`ANALYTICS_POLICY_LIMIT` et al). */
export const USER_ADMIN_PAGE_SIZE = 200;

export interface AdminUserView {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  languagePreference: string;
  lastLoginAt: string | null;
  accessValidFrom: string | null;
  accessValidUntil: string | null;
  createdAt: string;
  roles: RoleName[];
}

/**
 * Backlog A.2 — "Seed the 11 roles ... Build the full permission grid ...
 * Permission-check middleware on every sensitive endpoint". Those three
 * shipped, but nothing ever granted a role to a user: `POST /auth/signup`
 * creates an account with zero roles and `RbacController` is read-only, so a
 * freshly-seeded deployment had no reachable path to any permission and
 * therefore to any of the 74 business processes. This service is that path.
 *
 * Segregation of duties: provisioning is single-actor `user.manage`
 * (SYSTEM_SECURITY_ADMINISTRATOR only). It is NOT a maker/checker pair —
 * `ibms-brain/meta/lex/maker-checker-segregation.md` scopes that rule to KYC,
 * policy checking, refunds, disposal and DSR closure. The compensating
 * control for administrator access is backlog A.2's periodic access
 * recertification, which explicitly does NOT exempt the administrator's own
 * access (`AccessRecertificationService.getAdminAccessItems`).
 */
@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async list(page = 0): Promise<{ users: AdminUserView[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.users.listWithRoles(
        USER_ADMIN_PAGE_SIZE,
        page * USER_ADMIN_PAGE_SIZE,
      ),
      this.users.countAll(),
    ]);
    return { users: rows.map((row) => toAdminUserView(row)), total };
  }

  async provision(
    dto: ProvisionUserDto,
    actorUserId: string,
  ): Promise<AdminUserView> {
    const violations = this.passwords.validatePolicy(dto.password);
    if (violations.length > 0) throw new BadRequestException(violations);

    const accessValidFrom = dto.accessValidFrom
      ? new Date(dto.accessValidFrom)
      : undefined;
    const accessValidUntil = dto.accessValidUntil
      ? new Date(dto.accessValidUntil)
      : undefined;
    if (
      accessValidFrom &&
      accessValidUntil &&
      accessValidFrom.getTime() >= accessValidUntil.getTime()
    ) {
      throw new UnprocessableEntityException(
        'accessValidUntil must be after accessValidFrom.',
      );
    }

    // De-duplicate before resolving so ["SALES","SALES"] does not become two
    // `UserRoleAssignment` creates and trip the @@unique inside our own write.
    const requested = [...new Set(dto.roles)];
    const roles = await this.users.findRolesByNames(requested);
    if (roles.length !== requested.length) {
      const found = new Set(roles.map((r) => r.name));
      throw new UnprocessableEntityException(
        `Unknown role(s): ${requested.filter((r) => !found.has(r)).join(', ')}. Run \`npm run db:seed\` to install the 11-role catalogue.`,
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.users.provision({
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        languagePreference: dto.languagePreference,
        roleIds: roles.map((r) => r.id),
        accessValidFrom,
        accessValidUntil,
      });
    } catch (err) {
      // `User.email @unique` is the real invariant; this only turns the P2002
      // into the 409 the signup path already returns for the same collision.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw err;
    }

    // Never the password or its hash (sensitive-data-handling.md — identifiers
    // and the granted authority, not the credential).
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      afterValue: {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: requested,
        accessValidFrom: accessValidFrom?.toISOString() ?? null,
        accessValidUntil: accessValidUntil?.toISOString() ?? null,
      },
    });

    await this.recordSegregationSignal(
      segregationSignal({
        roles: requested,
        subjectUserId: user.id,
        actorUserId,
      }),
      { subjectUserId: user.id, actorUserId, via: 'provision' },
    );

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      languagePreference: user.languagePreference,
      lastLoginAt: null,
      accessValidFrom: user.accessValidFrom?.toISOString() ?? null,
      accessValidUntil: user.accessValidUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      roles: requested,
    };
  }

  async grantRole(
    userId: string,
    roleName: RoleName,
    actorUserId: string,
  ): Promise<{ userId: string; roles: RoleName[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    const role = await this.users.findRoleByName(roleName);
    if (!role) {
      throw new UnprocessableEntityException(
        `Unknown role ${roleName}. Run \`npm run db:seed\` to install the 11-role catalogue.`,
      );
    }

    await this.users.grantRole(userId, role.id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'UserRoleAssignment',
      entityId: `${userId}:${role.id}`,
      afterValue: { userId, role: roleName, granted: true },
    });

    await this.recordSegregationSignal(
      segregationSignal({
        roles: [roleName],
        subjectUserId: userId,
        actorUserId,
      }),
      { subjectUserId: userId, actorUserId, via: 'grantRole' },
    );

    // The permission grid is cached for 60s per role-combination; an admin
    // must not have to wait out the TTL to see their own grant take effect.
    this.permissions.invalidateCache();
    return { userId, roles: await this.users.getRoleNames(userId) };
  }

  async revokeRole(
    userId: string,
    roleName: RoleName,
    actorUserId: string,
  ): Promise<{ userId: string; roles: RoleName[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    const role = await this.users.findRoleByName(roleName);
    if (!role) {
      throw new UnprocessableEntityException(`Unknown role ${roleName}.`);
    }

    // Lockout guard: SYSTEM_SECURITY_ADMINISTRATOR is the only role holding
    // `user.manage`, so revoking the last usable one leaves nobody able to
    // grant it back — an unrecoverable state short of direct DB access.
    //
    // The count and the revoke run under a LOCK on the Role row. As a plain
    // count-then-act, two concurrent revocations of the two remaining
    // administrators both read `holders === 2`, both passed `holders <= 1`,
    // and both committed — producing exactly the state this guard exists to
    // prevent (`race-safe-invariants.md` § What triggers this rule: "any
    // 'has this already happened?' guard before a state change that is not a
    // status-conditional updateMany").
    const revoked =
      roleName === RoleName.SYSTEM_SECURITY_ADMINISTRATOR
        ? await this.users.withRoleLocked(role.id, async () => {
            const holders = await this.users.countActiveHoldersOfRole(role.id);
            if (holders <= 1) {
              throw new UnprocessableEntityException(
                'Refusing to revoke the last active SYSTEM_SECURITY_ADMINISTRATOR — nobody would be able to grant it back. Provision a second administrator first.',
              );
            }
            return this.users.revokeRole(userId, role.id);
          })
        : await this.users.revokeRole(userId, role.id);
    if (revoked === 0) {
      throw new ConflictException(
        `User ${userId} does not hold an active ${roleName} grant.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'UserRoleAssignment',
      entityId: `${userId}:${role.id}`,
      afterValue: { userId, role: roleName, granted: false },
    });
    this.permissions.invalidateCache();
    return { userId, roles: await this.users.getRoleNames(userId) };
  }

  /** Backlog A.1/#66 — de-provisioning. `AuthService.login` refuses an
   * inactive account, so this has a real access-control effect immediately;
   * existing sessions still hold a valid access token until it expires, the
   * same posture `#66`'s termination checklist already documents. */
  async setActive(
    userId: string,
    isActive: boolean,
    actorUserId: string,
  ): Promise<{ userId: string; isActive: boolean }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    if (!isActive && userId === actorUserId) {
      throw new UnprocessableEntityException(
        'Refusing to deactivate your own administrator account.',
      );
    }

    // The SAME lockout invariant as revokeRole, which this path could reach by
    // a different route. The self-deactivation guard above is NOT sufficient:
    // two administrators deactivating EACH OTHER concurrently are neither of
    // them deactivating themselves, so both calls passed and the system was
    // left with zero active administrators. Deactivating is as effective a
    // way to remove the last usable holder as revoking is — `AuthService.login`
    // refuses an inactive account outright — so it takes the same Role lock
    // and the same count.
    const adminRole = await this.users.findRoleByName(
      RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
    );
    const changed =
      !isActive && adminRole
        ? await this.users.withRoleLocked(adminRole.id, async () => {
            const holdsAdmin = (await this.users.getRoleNames(userId)).includes(
              RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
            );
            if (holdsAdmin) {
              const holders = await this.users.countActiveHoldersOfRole(
                adminRole.id,
              );
              if (holders <= 1) {
                throw new UnprocessableEntityException(
                  'Refusing to deactivate the last active SYSTEM_SECURITY_ADMINISTRATOR — nobody would be able to sign in and grant the role back. Provision a second administrator first.',
                );
              }
            }
            return this.users.setActive(userId, isActive);
          })
        : await this.users.setActive(userId, isActive);
    if (changed === 0) {
      // Already in the requested state — idempotent, not an error.
      return { userId, isActive };
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      beforeValue: { isActive: !isActive },
      afterValue: { isActive },
    });
    return { userId, isActive };
  }

  /**
   * Emits a distinct, queryable record when an administrator hands out the
   * CHECKER half of a maker/checker pair.
   *
   * `assertDifferentActors` enforces maker != checker on one identity. It
   * cannot see that one human holds two. A `user.manage` holder can provision
   * a second account carrying the other half of any pair and work both sides
   * single-handed — no dual control, and nothing that looks unusual in any
   * existing record.
   *
   * `maker-checker-segregation.md` is explicit that "admin consoles and
   * back-office override tools" are NOT exempt from that rule, so this is not
   * a gap in the lex; it is a gap in what the system can SEE. This closes the
   * visibility half. It deliberately does not BLOCK: requiring a second
   * administrator to provision would invent a dual-control policy for
   * provisioning that the business has not agreed to, which is not a call to
   * make unilaterally on a regulated control. A detective control is a real
   * control; a silent one is not.
   *
   * Never throws — a grant that has already committed must not be reported as
   * a failure because its signal could not be written.
   */
  private async recordSegregationSignal(
    signal: SegregationSignal | null,
    context: { subjectUserId: string; actorUserId: string; via: string },
  ): Promise<void> {
    if (!signal) return;

    const roles = signal.checkerRoles.join(', ');
    const message = signal.selfGrant
      ? `SEGREGATION OF DUTIES: administrator ${context.actorUserId} granted THEMSELVES the checker role(s) ${roles} via ${context.via}. One identity now holds both halves of a maker/checker pair.`
      : `SEGREGATION OF DUTIES: administrator ${context.actorUserId} granted checker role(s) ${roles} to user ${context.subjectUserId} via ${context.via}. Verify this is not a second identity for an existing maker.`;

    // Self-grant is the shape that needs no second account at all, so it is
    // the stronger signal and is logged as an error rather than a warning.
    if (signal.selfGrant) this.logger.error(message);
    else this.logger.warn(message);

    await this.safeAudit({
      userId: context.actorUserId,
      action: 'UPDATE',
      entityType: 'SegregationOfDutiesSignal',
      entityId: context.subjectUserId,
      afterValue: {
        checkerRoles: signal.checkerRoles,
        selfGrant: signal.selfGrant,
        grantedByUserId: context.actorUserId,
        grantedToUserId: context.subjectUserId,
        via: context.via,
      },
    });
  }

  /** Audit failures never fail the request — the write has already committed
   * (the `safeAudit` pattern used across this codebase). */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `User-admin audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}

function toAdminUserView(row: {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  languagePreference: string;
  lastLoginAt: Date | null;
  accessValidFrom: Date | null;
  accessValidUntil: Date | null;
  createdAt: Date;
  roles: RoleName[];
}): AdminUserView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    isActive: row.isActive,
    mfaEnabled: row.mfaEnabled,
    languagePreference: row.languagePreference,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    accessValidFrom: row.accessValidFrom?.toISOString() ?? null,
    accessValidUntil: row.accessValidUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: row.roles,
  };
}
