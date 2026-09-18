import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { MfaMethod, Role, User, UserRoleAssignment } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { OrgContextService } from '../common/org-context/org-context.service';

/** One of a caller's active roles. `id` is what authorization resolves from;
 * `name` is office-chosen free text, for display only. */
export interface RoleRef {
  id: string;
  name: string;
}

@Injectable()
export class UserRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
  ) {}

  /**
   * Multi-tenancy Phase 2 — the real unique read Phase 1 owed.
   *
   * `User.email` is unique per Organization, not globally
   * (`@@unique([organizationId, email])`, spec §3.2/§4.1.3), so this addresses
   * the compound key directly instead of Phase 1's stopgap `findFirst`.
   * Everything that already knows its Organization uses this — authenticated
   * requests, and the schedulers, which resolve their own service account once
   * per Organization they sweep.
   */
  findByEmailInOrganization(
    organizationId: string,
    email: string,
  ): Promise<User | null> {
    return this.prisma.client.user.findUnique({
      where: { organizationId_email: { organizationId, email } },
    });
  }

  /**
   * The login/signup/password-reset path ONLY — deliberately searches across
   * every Organization, and is named so that its unscoped-ness is visible at
   * the call site rather than hidden behind an innocuous `findByEmail`.
   *
   * It has to work this way in Phase 2: the caller is anonymous, so their
   * Organization is precisely what this lookup is trying to establish. Callers
   * must therefore run it inside `runUnscoped('auth-bootstrap')` and `adopt()`
   * the resulting user's org immediately, so only the lookup is unscoped and
   * everything after it is not.
   *
   * PHASE 4 removes the need for it: once `GET /orgs/resolve` resolves the
   * Organization from the subdomain BEFORE the login form is shown (§4.10),
   * login will know its org up front and can use
   * `findByEmailInOrganization()` like everything else.
   */
  findByEmailAcrossOrganizations(email: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({ where: { email } });
  }

  /**
   * Part II §4.3.2 — enrolment is complete only once one live code verified.
   *
   * The four facts move together for the same reason `setPassword` clears
   * `mustChangePassword` in one write: a half-applied enrolment is either a
   * user who cannot get in, or a user whose second factor is not really on.
   */
  completeMfaEnrollment(id: string, method: MfaMethod): Promise<User> {
    return this.prisma.client.user.update({
      where: { id },
      data: {
        mfaEnabled: true,
        mfaMethod: method,
        mfaEnrolledAt: new Date(),
        mfaEnrollmentPending: false,
      },
    });
  }

  /** Part II §4.2 — an admin-provisioned account starts owing BOTH onboarding
   * steps: rotate the temporary password, then enrol a second factor. */
  markOnboardingRequired(id: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id },
      data: { mustChangePassword: true, mfaEnrollmentPending: true },
    });
  }

  /** Part II §4.4.3 — the password was proven, so the counter starts over even
   * when the login resolves to an onboarding step rather than a session. */
  async resetFailedLoginAttempts(id: string): Promise<void> {
    await this.prisma.client.user.updateMany({
      where: { id },
      data: { failedLoginAttempts: 0 },
    });
  }

  /**
   * Part II §4.3.1/§4.7 — stores a new password hash and closes out whatever
   * onboarding state prompted it.
   *
   * `mustChangePassword` is cleared here rather than by the caller: the flag and
   * the hash have to move together, or a crash between the two leaves the user
   * either permanently stuck on the change screen or holding a new password the
   * system still refuses to let them past.
   */
  setPassword(id: string, passwordHash: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id },
      data: {
        passwordHash,
        passwordUpdatedAt: new Date(),
        mustChangePassword: false,
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id } });
  }

  /**
   * `findById` plus the Department the user sits in.
   *
   * A sibling rather than a widening of `findById`, which has many callers
   * that want a plain `User` and would all inherit a relation none of them
   * asked for. Only /auth/me needs this — the navbar shows the department
   * under the signed-in user's name.
   */
  /** The account linked to an HR record, if any. `User.employeeId` is
   *  @unique, so this is at most one row. */
  findByEmployeeId(employeeId: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { employeeId } });
  }

  findByIdWithDepartment(id: string) {
    return this.prisma.client.user.findUnique({
      where: { id },
      // The HR record too: /auth/me resolves the DISPLAY name from it when a
      // link exists (see common/display-name.util.ts), and the department for
      // the navbar's second line.
      include: { department: true, employee: true },
    });
  }

  /**
   * A caller's active roles as `{ id, name }` pairs — the id for authorization,
   * the name for display.
   *
   * The auth path needs both and must not pay for two queries to get them:
   * `PermissionsService` resolves grants from role IDS (office-scoped custom
   * roles made names ambiguous across offices — see
   * `PermissionRepository.findCodesForRoles`), while `/auth/me` and the
   * not-yet-converted role-name checks still read names.
   */
  async getRoleRefs(userId: string): Promise<RoleRef[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      select: { role: { select: { id: true, name: true } } },
    });
    return assignments.map((a) => ({ id: a.role.id, name: a.role.name }));
  }

  async getRoleNames(userId: string): Promise<string[]> {
    return (await this.getRoleRefs(userId)).map((r) => r.name);
  }

  /** Active (non-revoked) role names for a set of users, keyed by user id,
   * in ONE query. `AccessRecertificationService.listItemsForReviewer` fired
   * one `getRoleNames` per item — for a large cycle that fanned out to N
   * concurrent queries and could exhaust the connection pool. */
  async getRoleNamesByIds(userIds: string[]): Promise<Map<string, string[]>> {
    const byUser = new Map<string, string[]>();
    if (userIds.length === 0) return byUser;
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { userId: { in: userIds }, revokedAt: null },
      select: { userId: true, role: { select: { name: true } } },
    });
    for (const assignment of assignments) {
      const list = byUser.get(assignment.userId);
      if (list) list.push(assignment.role.name);
      else byUser.set(assignment.userId, [assignment.role.name]);
    }
    return byUser;
  }

  /** Minimal display info for a set of users — e.g. rendering a
   * recertification queue without exposing full User records. */
  findSummariesByIds(
    ids: string[],
  ): Promise<{ id: string; fullName: string; email: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
  }

  /**
   * Self-service signup. Unlike `provision`, this account owes no password
   * rotation: the person who will use it is the person who chose the password,
   * so there is no admin-known secret to close out. MFA enrolment is still
   * required — `MfaRequiredGuard` enforces that for everyone.
   */
  create(data: {
    fullName: string;
    email: string;
    passwordHash: string;
    languagePreference?: 'AR' | 'EN';
  }): Promise<User> {
    return this.prisma.client.user.create({
      data: {
        ...data,
        passwordUpdatedAt: new Date(),
        // Explicit, because the column DEFAULTS to true for the provisioning
        // case. A self-service signup has no admin-known password to rotate.
        mustChangePassword: false,
      },
    });
  }

  /** Backlog A.2 — the admin provisioning surface. Unlike `create()` (used by
   * the public signup path, which grants no roles at all), this seats the
   * user's initial role grants in the SAME write, so a provisioned account is
   * never left in the unusable zero-role state signup produces.
   *
   * `accessValidFrom`/`accessValidUntil` exist for the EXTERNAL_AUDITOR role's
   * time-boxed access window (backlog A.1) — `AuthService.assertAccessWindow
   * Active` enforces them at login. */
  provision(data: {
    fullName: string;
    email: string;
    passwordHash: string;
    languagePreference?: 'AR' | 'EN';
    /** Part II §4.2.2 — separate from `roleIds`, and required by the DTO. */
    departmentId?: string;
    employeeId?: string;
    /** Part II §4.2.2 — the organizational location, likewise required by the
     * DTO and likewise distinct from both Department and Role. */
    branchId?: string;
    roleIds: string[];
    accessValidFrom?: Date;
    accessValidUntil?: Date;
  }): Promise<User> {
    const { roleIds, ...user } = data;
    return this.prisma.client.user.create({
      data: {
        ...user,
        passwordUpdatedAt: new Date(),
        // Part II §4.2.3 — an admin-provisioned account owes BOTH onboarding
        // steps. The admin knows the temporary password, which is exactly the
        // residual risk §4.3.1 exists to close, and no second factor exists yet.
        mustChangePassword: true,
        mfaEnrollmentPending: true,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
  }

  /** One page of users with their ACTIVE role names, for the admin console.
   * Never selects `passwordHash`. */
  async listWithRoles(
    take: number,
    skip: number,
  ): Promise<
    {
      id: string;
      fullName: string;
      email: string;
      isActive: boolean;
      mfaEnabled: boolean;
      languagePreference: User['languagePreference'];
      lastLoginAt: Date | null;
      accessValidFrom: Date | null;
      accessValidUntil: Date | null;
      createdAt: Date;
      roles: string[];
      employee: { fullName: string } | null;
    }[]
  > {
    const rows = await this.prisma.client.user.findMany({
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      select: {
        // The linked HR record's name, so the admin list shows the same
        // display name the person sees in their own navbar rather than the
        // free text typed at provisioning. See common/display-name.util.ts.
        employee: { select: { fullName: true } },
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        mfaEnabled: true,
        languagePreference: true,
        lastLoginAt: true,
        accessValidFrom: true,
        accessValidUntil: true,
        createdAt: true,
        roles: {
          where: { revokedAt: null },
          select: { role: { select: { name: true } } },
        },
      },
    });
    return rows.map(({ roles, ...rest }) => ({
      ...rest,
      roles: roles.map((r) => r.role.name),
    }));
  }

  countAll(): Promise<number> {
    return this.prisma.client.user.count();
  }

  /**
   * A role by name, WITHIN the caller's own office.
   *
   * `findFirst`, not `findUnique`: a role name is only unique per office now
   * (`@@unique([organizationId, name])`), and `findFirst` is one of the
   * operations `tenantScopeExtension` injects `organizationId` into — so this
   * cannot return another office's role even though the name may exist there
   * too. Spelling the compound key by hand would mean naming the organization
   * at the call site, which is the habit the extension exists to remove.
   */
  findRoleByName(name: string): Promise<Role | null> {
    return this.prisma.client.role.findFirst({ where: { name } });
  }

  findRolesByNames(names: string[]): Promise<Role[]> {
    return this.prisma.client.role.findMany({ where: { name: { in: names } } });
  }

  /**
   * Grant a role by writing a NEW assignment row, never by resurrecting a
   * revoked one.
   *
   * This used to upsert with `update: { revokedAt: null, grantedAt: new Date() }`,
   * which erased the revocation timestamp and overwrote the original grant
   * date — destroying the audit record `UserRoleAssignment.revokedAt` exists
   * to hold. "User X held FINANCE_OFFICER from A to B" then survived only in
   * AuditLogEntry.
   *
   * Race safety is unchanged in kind, only in mechanism: the partial UNIQUE
   * `UserRoleAssignment_one_active_per_user_role` (`WHERE "revokedAt" IS NULL`,
   * migration 20260920140000) is the invariant, so a concurrent double-grant
   * loses on P2002 rather than being caught by a check-then-act read
   * (`race-safe-invariants.md`). A re-grant of a still-active role is
   * idempotent: it hits that constraint and returns the existing row.
   */
  async grantRole(userId: string, roleId: string): Promise<UserRoleAssignment> {
    try {
      return await this.prisma.client.userRoleAssignment.create({
        data: { userId, roleId },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const active = await this.prisma.client.userRoleAssignment.findFirst({
          where: { userId, roleId, revokedAt: null },
        });
        if (active) return active;
      }
      throw err;
    }
  }

  /** Every grant ever made for this user+role, newest first — the history the
   * partial UNIQUE now makes it possible to keep. */
  findRoleGrantHistory(
    userId: string,
    roleId: string,
  ): Promise<UserRoleAssignment[]> {
    return this.prisma.client.userRoleAssignment.findMany({
      where: { userId, roleId },
      orderBy: { grantedAt: 'desc' },
    });
  }

  /** Revoke a role by stamping `revokedAt` — the row is kept, never deleted
   * (the schema comment on `UserRoleAssignment.revokedAt` makes this the
   * audit record of when access was withdrawn). Conditional on the grant
   * still being active, so a concurrent double-revoke reports 0 rows rather
   * than silently re-stamping a later timestamp over the first one. */
  async revokeRole(userId: string, roleId: string): Promise<number> {
    const { count } = await this.prisma.client.userRoleAssignment.updateMany({
      where: { userId, roleId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Backlog A.1/#66 — de-provisioning has a real access-control effect, not
   * just a flag: `AuthService.login` refuses an inactive account outright. */
  async setActive(userId: string, isActive: boolean): Promise<number> {
    const { count } = await this.prisma.client.user.updateMany({
      where: { id: userId, isActive: !isActive },
      data: { isActive },
    });
    return count;
  }

  /**
   * Holders of a role who can ACTUALLY SIGN IN RIGHT NOW — used to refuse the
   * last-administrator revoke that would lock everyone out of the
   * provisioning surface.
   *
   * The access-validity window is part of "can sign in", not decoration:
   * `AuthService.login` and `SessionService` both refuse a user outside it.
   * Counting only `revokedAt: null` + `user.isActive` therefore counted
   * administrators who are provably unable to log in — an EXTERNAL_AUDITOR-
   * style time-boxed account whose window has closed still satisfied the
   * guard, so the one genuinely usable administrator could revoke their own
   * role and reach exactly the unrecoverable state the guard exists to
   * prevent. One request, no race required.
   */
  countActiveHoldersOfRole(roleId: string, now = new Date()): Promise<number> {
    return this.prisma.client.userRoleAssignment.count({
      where: {
        roleId,
        revokedAt: null,
        user: {
          isActive: true,
          AND: [
            {
              OR: [
                { accessValidFrom: null },
                { accessValidFrom: { lte: now } },
              ],
            },
            {
              OR: [
                { accessValidUntil: null },
                { accessValidUntil: { gt: now } },
              ],
            },
          ],
        },
      },
    });
  }

  /**
   * Runs `work` with the Role row LOCKED, so a "is this the last holder?"
   * count and the write that depends on it cannot interleave with another
   * request doing the same thing.
   *
   * The guard in `UserAdminService` was a plain count-then-act: two concurrent
   * revocations of the two remaining SYSTEM_SECURITY_ADMINISTRATORs both read
   * `holders === 2`, both passed `holders <= 1`, and both committed — leaving
   * nobody holding `user.manage` and no way to grant it back short of direct
   * database access, which is the precise outcome the guard's own comment
   * says it exists to prevent. `race-safe-invariants.md` § What triggers this
   * rule names this shape exactly.
   *
   * Locking the Role row (rather than the assignments) is what serialises
   * revoke against deactivate: they touch different tables but share the same
   * invariant, "at least one usable holder of this role".
   */
  withRoleLocked<T>(roleId: string, work: () => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${roleId} FOR UPDATE`;
      // `work()` deliberately issues its queries on the OUTER client, not on
      // `tx` — this transaction exists only to hold the row lock, and has
      // always been separate from the work it serialises.
      //
      // Multi-tenancy Phase 2 step 8 makes that explicit. Left alone, the work
      // would inherit "a transaction is already open", skip opening its own RLS
      // session, and run on a pooled connection with no `app.current_org_id`.
      // That was not theoretical: `setActive`'s `updateMany` matched zero rows,
      // which the service reads as "already in that state" and reports as
      // success — so deactivating an account silently did nothing.
      return this.orgContext.outsideScopedTransaction(work);
    });
  }

  recordSuccessfulLogin(userId: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  async recordFailedLogin(
    userId: string,
    lockUntil: Date | null,
  ): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: { increment: 1 },
        ...(lockUntil ? { lockedUntil: lockUntil } : {}),
      },
    });
  }

  setMfaEnabled(userId: string, enabled: boolean): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { mfaEnabled: enabled },
    });
  }

  updateLanguagePreference(
    userId: string,
    languagePreference: 'AR' | 'EN',
  ): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { languagePreference },
    });
  }

  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash, passwordUpdatedAt: new Date() },
    });
  }
}
