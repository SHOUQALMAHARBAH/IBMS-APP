import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type User } from '@ibms/db';
import { UserRepository } from '../../../repositories/user.repository';
import { PasswordService } from '../../auth/services/password.service';
import { EmployeeRepository } from '../../../repositories/employee.repository';
import { resolveDisplayName } from '../../../common/display-name.util';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { PermissionsService } from './permissions.service';
import type { ProvisionUserDto } from '../dto/provision-user.dto';
import {
  segregationSignal,
  type GrantedRole,
  type SegregationSignal,
} from '../checker-roles.config';
import { DepartmentRepository } from '../../../repositories/department.repository';
import { BranchRepository } from '../../../repositories/branch.repository';

/** A book-wide admin list is a console view, not a report — capped like every
 * other unbounded read in this codebase (`ANALYTICS_POLICY_LIMIT` et al). */
export const USER_ADMIN_PAGE_SIZE = 200;

/**
 * What makes an account an administrator, for the purposes of the lockout guard
 * below: it can administer users.
 *
 * This was a hard-coded role NAME (`SYSTEM_SECURITY_ADMINISTRATOR`) — the
 * assumption this whole project removes. An office that renamed that role, or
 * built its own administrator role instead, lost the protection SILENTLY: the
 * guard simply never fired, and the last usable administrator could revoke their
 * own access with nothing to stop them.
 *
 * `user.manage` is the right anchor because it is the capability that makes the
 * state unrecoverable: it is what grants roles back. An office may hold it on
 * several roles at once, which is what the lock below had to be redesigned for.
 */
const USER_ADMIN_PERMISSION = 'user.manage';

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
  /** Id AND name. The id is what a grant or revoke addresses; the name is what a
   *  person reads. Returning names alone forced the client to match text back to
   *  an id, which is the habit this phase removes. */
  roles: { id: string; name: string }[];
  /** The HR record this account is linked to, when there is one.
   *
   * The unified User/Employee screen is one row per PERSON, so it has to know
   * which half of the pair each row already has: an account with no HR record
   * still needs onboarding, and an HR record with no account cannot sign in.
   * Before this the response carried the linked record's NAME (it still does,
   * as `fullName`) but not its id, so the two lists could not be joined. */
  employeeId: string | null;
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
    private readonly departments: DepartmentRepository,
    private readonly branches: BranchRepository,
    private readonly users: UserRepository,
    private readonly employees: EmployeeRepository,
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
    const requested = [...new Set(dto.roleIds)];
    const roles = await this.users.findRolesByIds(requested);
    if (roles.length !== requested.length) {
      const found = new Set(roles.map((r) => r.id));
      throw new UnprocessableEntityException(
        `Unknown role id(s): ${requested
          .filter((id) => !found.has(id))
          .join(
            ', ',
          )}. A role id belongs to one office; an id from another office reads as unknown here, which is deliberate.`,
      );
    }

    // Part II §4.2.2 — the Department must exist, and the tenant-scoped read
    // means it must exist in THIS office: an Office A admin naming an Office B
    // department id gets the same "unknown" answer as one naming a department
    // that does not exist anywhere, which is the only answer that leaks nothing.
    const department = await this.departments.findById(dto.departmentId);
    if (!department) {
      throw new UnprocessableEntityException(
        "Unknown department. Pick one of this office's own departments.",
      );
    }

    // §4.2.2 — Branch is validated exactly like Department, and for the same
    // reason: the tenant-scoped read means an Office A admin naming an Office B
    // branch id gets "unknown", never a hint that the row exists elsewhere.
    const branch = await this.branches.findById(dto.branchId);
    if (!branch) {
      throw new UnprocessableEntityException(
        "Unknown branch. Pick one of this office's own branches.",
      );
    }

    // The HR record, when the admin names one. Validated exactly like
    // Department and Branch above, and for the same reason: a tenant-scoped
    // read means an Office A admin naming an Office B employee gets "unknown"
    // rather than a hint that the row exists somewhere.
    //
    // Link-only. An Employee is never CREATED here: it needs a national ID,
    // which is Highly Confidential under Part 10.2, and a user-provisioning
    // form is not where that should first be typed.
    let employeeName: string | null = null;
    if (dto.employeeId) {
      const employee = await this.employees.findById(dto.employeeId);
      employeeName = employee?.fullName ?? null;
      if (!employee) {
        throw new UnprocessableEntityException(
          "Unknown employee. Pick one of this office's own employee records.",
        );
      }
      // `User.employeeId` is @unique, so the database would refuse a second
      // link with a P2002 that reads like an email collision. Answering here
      // says which constraint was actually hit, and to whom.
      const existing = await this.users.findByEmployeeId(dto.employeeId);
      if (existing) {
        throw new ConflictException(
          'That employee record is already linked to another account.',
        );
      }
      // The SAME department rule `EmployeeService.create` applies when it
      // links from the other direction. Linking is reachable both ways — HR
      // can create the employee naming an existing account, or (here) an
      // admin can create the account naming an existing employee — and a rule
      // enforced on only one of those paths is not a rule.
      if (employee.departmentId && employee.departmentId !== dto.departmentId) {
        throw new ConflictException(
          'This employee record and the account being created name different departments. ' +
            "Pick the employee's own department, or link an employee from this one.",
        );
      }
    }

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.users.provision({
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        languagePreference: dto.languagePreference,
        departmentId: department.id,
        branchId: branch.id,
        employeeId: dto.employeeId,
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
        roleIds: requested,
        // §4.2.4 names these explicitly — "who created, for whom, which
        // role(s), WHICH DEPARTMENT/BRANCH, which Organization". Both ids and
        // both names: an id alone is unreadable in an audit export years
        // later, and a rename would silently rewrite history if only the id
        // were kept. The Organization is not repeated here — every
        // AuditLogEntry row is already tenant-scoped by its own column.
        departmentId: department.id,
        departmentName: department.name,
        branchId: branch.id,
        branchName: branch.name,
        accessValidFrom: accessValidFrom?.toISOString() ?? null,
        accessValidUntil: accessValidUntil?.toISOString() ?? null,
      },
    });

    await this.recordSegregationSignal(
      segregationSignal({
        roles: await this.grantedRoles(roles),
        subjectUserId: user.id,
        actorUserId,
      }),
      { subjectUserId: user.id, actorUserId, via: 'provision' },
    );

    return {
      id: user.id,
      // Resolved, so the row the admin sees immediately after creating an
      // account matches what the list will show on the next load.
      fullName: resolveDisplayName({
        fullName: user.fullName,
        employee: employeeName ? { fullName: employeeName } : null,
      }),
      email: user.email,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      languagePreference: user.languagePreference,
      lastLoginAt: null,
      accessValidFrom: user.accessValidFrom?.toISOString() ?? null,
      accessValidUntil: user.accessValidUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
      // Link-only at provisioning — an Employee is never CREATED here, because
      // that needs a national ID. `dto.employeeId` is what was linked, or null.
      employeeId: dto.employeeId ?? null,
    };
  }

  async grantRole(
    userId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<{ userId: string; roles: { id: string; name: string }[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    // By ID. The lookup is tenant-scoped, so another office's role id resolves
    // to nothing and gets the same answer an id that never existed gets —
    // which is what stops this endpoint being a probe.
    const role = await this.users.findRoleById(roleId);
    if (!role) {
      throw new UnprocessableEntityException(`Unknown role id ${roleId}.`);
    }

    await this.users.grantRole(userId, role.id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'UserRoleAssignment',
      entityId: `${userId}:${role.id}`,
      // Both: the id is the identity, the name is what a human reading the audit
      // trail recognises — and a later rename must not rewrite history.
      afterValue: { userId, roleId: role.id, role: role.name, granted: true },
    });

    await this.recordSegregationSignal(
      segregationSignal({
        roles: await this.grantedRoles([role]),
        subjectUserId: userId,
        actorUserId,
      }),
      { subjectUserId: userId, actorUserId, via: 'grantRole' },
    );

    // The permission grid is cached for 60s per role-combination; an admin
    // must not have to wait out the TTL to see their own grant take effect.
    this.permissions.invalidateCache();
    // The same `{ id, name }` shape `AdminUserView.roles` uses: one answer to
    // "what roles does this user hold" across every response on this surface,
    // rather than names here and objects there.
    return { userId, roles: await this.heldRoles(userId) };
  }

  async revokeRole(
    userId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<{ userId: string; roles: { id: string; name: string }[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    const role = await this.users.findRoleById(roleId);
    if (!role) {
      throw new UnprocessableEntityException(`Unknown role id ${roleId}.`);
    }

    // Lockout guard: `user.manage` is what grants roles back, so removing the
    // last usable holder of it leaves nobody able to — an unrecoverable state
    // short of direct database access.
    //
    // Keyed on the capability, not on a role NAME: an office that renames its
    // administrator role, or builds its own, is protected too. Only roles that
    // actually grant it are guarded, so revoking anything else is untouched.
    //
    // The read and the write run under a lock on the capability. As a plain
    // count-then-act, two concurrent revocations of the two remaining
    // administrators both observe a survivor and both commit — exactly the state
    // this guard exists to prevent (`race-safe-invariants.md` § What triggers
    // this rule). A lock on the Role ROW is no longer enough for that, because
    // several roles in one office may grant `user.manage` and two revocations
    // against different ones would lock different rows.
    const guarded = await this.users.roleGrantsPermission(
      role.id,
      USER_ADMIN_PERMISSION,
    );
    const revoked = guarded
      ? await this.users.withCapabilityLocked(
          USER_ADMIN_PERMISSION,
          async () => {
            // What would still hold `user.manage` after THIS revoke: every
            // active holder except the one assignment being withdrawn. A count
            // of holders would refuse a revoke that takes nothing away, because
            // the same user may hold the capability through a second role.
            const holders = await this.users.findActiveHoldersOfPermission(
              USER_ADMIN_PERMISSION,
            );
            const remaining = new Set(
              holders
                .filter((h) => !(h.userId === userId && h.roleId === role.id))
                .map((h) => h.userId),
            );
            if (remaining.size === 0) {
              throw new UnprocessableEntityException(
                'Refusing to revoke the last active grant of user administration — nobody would be able to grant it back. Provision a second administrator first.',
              );
            }
            return this.users.revokeRole(userId, role.id);
          },
        )
      : await this.users.revokeRole(userId, role.id);
    if (revoked === 0) {
      throw new ConflictException(
        `User ${userId} does not hold an active ${role.name} grant.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'UserRoleAssignment',
      entityId: `${userId}:${role.id}`,
      afterValue: { userId, roleId: role.id, role: role.name, granted: false },
    });
    this.permissions.invalidateCache();
    // The same `{ id, name }` shape `AdminUserView.roles` uses: one answer to
    // "what roles does this user hold" across every response on this surface,
    // rather than names here and objects there.
    return { userId, roles: await this.heldRoles(userId) };
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
    // left with zero active administrators. Deactivating is as effective a way
    // to remove the last usable holder as revoking is — `AuthService.login`
    // refuses an inactive account outright — so it takes the same lock and asks
    // the same question.
    //
    // Deactivation removes a whole USER, so the survivors are every holder other
    // than this one, whatever roles they hold it through.
    const changed = !isActive
      ? await this.users.withCapabilityLocked(
          USER_ADMIN_PERMISSION,
          async () => {
            const holders = await this.users.findActiveHoldersOfPermission(
              USER_ADMIN_PERMISSION,
            );
            if (holders.some((h) => h.userId === userId)) {
              const remaining = new Set(
                holders.filter((h) => h.userId !== userId).map((h) => h.userId),
              );
              if (remaining.size === 0) {
                throw new UnprocessableEntityException(
                  'Refusing to deactivate the last active user administrator — nobody would be able to sign in and grant the access back. Provision a second administrator first.',
                );
              }
            }
            return this.users.setActive(userId, isActive);
          },
        )
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

  /** A user's active roles as `{ id, name }` — the id is what a later grant or
   *  revoke addresses, the name is what a person reads. */
  private async heldRoles(
    userId: string,
  ): Promise<{ id: string; name: string }[]> {
    const refs = await this.users.getRoleRefs(userId);
    return refs.map((ref) => ({ id: ref.id, name: ref.name }));
  }

  /**
   * Resolves what each role being granted actually grants.
   *
   * One lookup per role rather than one for the union, so the signal can say
   * WHICH role carried the checker permission — the union would flag the grant
   * without naming the cause. Every lookup is keyed on a role ID and cached, and
   * this runs once per provisioning call, so the cost is nil.
   */
  private async grantedRoles(
    roles: readonly { id: string; name: string }[],
  ): Promise<GrantedRole[]> {
    return Promise.all(
      roles.map(async (role) => ({
        name: role.name,
        permissions: await this.permissions.getCodesForRoles([role.id]),
      })),
    );
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
    // The permissions, not only the role names. A name is no longer an identity:
    // two offices may each define a "Reviewer" granting different things, so the
    // name alone does not tell Compliance what was actually handed over.
    const why = signal.checkerPermissions.join(', ');
    const message = signal.selfGrant
      ? `SEGREGATION OF DUTIES: administrator ${context.actorUserId} granted THEMSELVES the checker role(s) ${roles} (${why}) via ${context.via}. One identity now holds both halves of a maker/checker pair.`
      : `SEGREGATION OF DUTIES: administrator ${context.actorUserId} granted checker role(s) ${roles} (${why}) to user ${context.subjectUserId} via ${context.via}. Verify this is not a second identity for an existing maker.`;

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
        checkerPermissions: signal.checkerPermissions,
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
  roles: { id: string; name: string }[];
  employeeId?: string | null;
  employee?: { fullName: string } | null;
}): AdminUserView {
  return {
    id: row.id,
    fullName: resolveDisplayName(row),
    email: row.email,
    isActive: row.isActive,
    mfaEnabled: row.mfaEnabled,
    languagePreference: row.languagePreference,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    accessValidFrom: row.accessValidFrom?.toISOString() ?? null,
    accessValidUntil: row.accessValidUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: row.roles,
    employeeId: row.employeeId ?? null,
  };
}
