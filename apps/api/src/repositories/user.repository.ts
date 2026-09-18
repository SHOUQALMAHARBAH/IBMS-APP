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
  /** Part II §4.4 — this role never skips the MFA prompt. A column on `Role`,
   *  strict by default, because the list of role NAMES it replaced matched no
   *  custom role and therefore failed OPEN. See `roleSecurityAttributes`. */
  requiresMfaAlways: boolean;
  /** Part 10.1 — this role is flagged for the WebAuthn hardware-token
   *  requirement. Same shape, same reason. */
  requiresHardwareToken: boolean;
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
      // The two security attributes ride along on a join that already existed,
      // so resolving them costs no extra query.
      select: {
        role: {
          select: {
            id: true,
            name: true,
            requiresMfaAlways: true,
            requiresHardwareToken: true,
          },
        },
      },
    });
    return assignments.map((a) => a.role);
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

  /** One page of users with their ACTIVE roles, for the admin console.
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
      /** Id AND name: the id is what a revoke addresses, the name is what a
       *  person reads. Returning only names forced the client to resolve one to
       *  the other by matching text, which is the habit this phase removes. */
      roles: { id: string; name: string }[];
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
          select: { role: { select: { id: true, name: true } } },
        },
      },
    });
    return rows.map(({ roles, ...rest }) => ({
      ...rest,
      roles: roles.map((r) => r.role),
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
  /** One role of the caller's OWN office, by id. The tenant-scoped client is
   *  what makes another office's id resolve to `null` rather than to their row —
   *  so "unknown" and "not yours" are the same answer, which is the point. */
  findRoleById(id: string): Promise<Role | null> {
    return this.prisma.client.role.findFirst({ where: { id } });
  }

  /** The caller's own roles for a set of ids. A caller passing an id from
   *  another office gets a SHORTER list back, which is how `provision` detects
   *  it without ever saying which id was the problem. */
  findRolesByIds(ids: string[]): Promise<Role[]> {
    return this.prisma.client.role.findMany({ where: { id: { in: ids } } });
  }

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
   * Every active assignment through which somebody currently holds `code`, as
   * (userId, roleId) pairs — the raw material for "would this change leave
   * nobody able to administer users?"
   *
   * ## Why pairs rather than a count
   *
   * A count cannot answer the question once a user may hold the capability
   * through more than one role. Revoking ONE administrator role from a user who
   * holds two leaves them an administrator, so a count of holders would refuse a
   * revoke that takes nothing away; and counting assignments instead of users
   * would let two roles on one person look like two administrators. Returning
   * the pairs lets the caller subtract exactly what the pending write removes —
   * one assignment for a revoke, one whole user for a deactivation.
   *
   * ## "Active" means CAN SIGN IN RIGHT NOW
   *
   * The access-validity window is part of that, not decoration: `AuthService
   * .login` and `SessionService` both refuse a user outside it. Filtering only
   * on `revokedAt: null` + `user.isActive` once counted administrators provably
   * unable to log in — a time-boxed account whose window had closed still
   * satisfied the guard, so the one genuinely usable administrator could revoke
   * their own role and reach exactly the unrecoverable state the guard exists to
   * prevent. One request, no race required.
   *
   * Scoped to the caller's own office: `RolePermission` and
   * `UserRoleAssignment` both carry `organizationId`, so the extension filters
   * the top-level query on each. The only nested filter is on `Permission`,
   * which is a deliberately global catalogue.
   */
  async findActiveHoldersOfPermission(
    code: string,
    now = new Date(),
  ): Promise<{ userId: string; roleId: string }[]> {
    const grants = await this.prisma.client.rolePermission.findMany({
      where: { permission: { code } },
      select: { roleId: true },
    });
    if (grants.length === 0) return [];

    return this.prisma.client.userRoleAssignment.findMany({
      where: {
        roleId: { in: [...new Set(grants.map((g) => g.roleId))] },
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
      select: { userId: true, roleId: true },
    });
  }

  /** Whether this role grants `code` — the question "is the role being revoked
   *  an administrator role?", which a name comparison used to answer. */
  async roleGrantsPermission(roleId: string, code: string): Promise<boolean> {
    const grant = await this.prisma.client.rolePermission.findFirst({
      where: { roleId, permission: { code } },
      select: { roleId: true },
    });
    return grant !== null;
  }

  /**
   * Runs `work` holding an exclusive lock on one CAPABILITY in one office, so a
   * "would this leave nobody able to do X?" read and the write that depends on
   * it cannot interleave with another request asking the same question.
   *
   * ## Why this replaced a row lock, which was correct until it wasn't
   *
   * The guard in `UserAdminService` was a plain count-then-act: two concurrent
   * revocations of the two remaining administrators both read `holders === 2`,
   * both passed the check, and both committed — leaving nobody holding
   * `user.manage` and no way to grant it back short of direct database access.
   * `race-safe-invariants.md` § What triggers this rule names that shape.
   *
   * The fix was `SELECT ... FOR UPDATE` on the Role row, which serialised the
   * two because there was exactly ONE role that could hold `user.manage`. Phase
   * 2 keys the guard on the capability instead of that role's name, so several
   * roles in an office can hold it — and two revocations against DIFFERENT
   * administrator roles would lock different rows, serialise against nothing,
   * both observe a surviving administrator, and both commit. The row lock did
   * not become wrong; the thing it was protecting stopped being one row.
   *
   * ## Why an advisory lock rather than locking every candidate row
   *
   * Locking all roles that grant the code, in a deterministic order, also works
   * and is deadlock-free — but it degrades as an office adds administrator roles,
   * and it has to re-derive the candidate set inside the lock it is trying to
   * take. An advisory lock keyed on the capability covers every present and
   * future role granting it, needs no row to exist, and reads as what it is.
   *
   * Keyed on (organizationId, code) so two offices never contend, and
   * transaction-scoped (`pg_advisory_xact_lock`) so it releases on commit AND on
   * rollback — a session-scoped lock leaked on a thrown guard would wedge the
   * surface for everyone.
   */
  // `async`, so the guard below REJECTS rather than throwing synchronously out
  // of a method whose signature promises a Promise. A caller using `.catch()`
  // would otherwise get an uncaught exception instead — found by the test that
  // asserts the refusal.
  async withCapabilityLocked<T>(
    code: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const organizationId = this.orgContext.currentOrNull();
    if (!organizationId) {
      // Not defensive padding: an unkeyed lock would serialise every office
      // against every other, and silently, which is worse than refusing.
      throw new Error(
        `withCapabilityLocked(${code}) requires an Organization context.`,
      );
    }
    return this.prisma.client.$transaction(async (tx) => {
      // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`,
      // and Prisma cannot deserialize a void column — `$queryRaw` fails with
      // "Failed to deserialize column of type 'void'", which would have made
      // every administrator revoke a 500. There is no result to read here
      // anyway; the lock is the effect.
      //
      // Two-argument form: `hashtext` of each part, so the key is derived from
      // both and cannot collide with another capability in the same office.
      // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`,
      // and Prisma cannot deserialize a void column — `$queryRaw` fails with
      // "Failed to deserialize column of type 'void'", which would have made
      // every administrator revoke a 500. There is no result to read here
      // anyway; the lock is the effect.
      //
      // Two-argument form: `hashtext` of each part, so the key is derived from
      // both and cannot collide with another capability in the same office.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${code}))`;
      // `work()` deliberately issues its queries on the OUTER client, not on
      // `tx` — this transaction exists only to hold the lock, and has always
      // been separate from the work it serialises.
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
