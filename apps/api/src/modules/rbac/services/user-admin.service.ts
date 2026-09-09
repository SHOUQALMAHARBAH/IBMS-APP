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
    // `user.manage`, so revoking the last active one would leave nobody able
    // to grant it back — an unrecoverable state short of direct DB access.
    if (roleName === RoleName.SYSTEM_SECURITY_ADMINISTRATOR) {
      const holders = await this.users.countActiveHoldersOfRole(role.id);
      if (holders <= 1) {
        throw new UnprocessableEntityException(
          'Refusing to revoke the last active SYSTEM_SECURITY_ADMINISTRATOR — nobody would be able to grant it back. Provision a second administrator first.',
        );
      }
    }

    const revoked = await this.users.revokeRole(userId, role.id);
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

    const changed = await this.users.setActive(userId, isActive);
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
