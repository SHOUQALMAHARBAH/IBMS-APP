import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Role, RoleName, User, UserRoleAssignment } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id } });
  }

  async getRoleNames(userId: string): Promise<RoleName[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { userId, revokedAt: null },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  /** Active (non-revoked) role names for a set of users, keyed by user id,
   * in ONE query. `AccessRecertificationService.listItemsForReviewer` fired
   * one `getRoleNames` per item — for a large cycle that fanned out to N
   * concurrent queries and could exhaust the connection pool. */
  async getRoleNamesByIds(userIds: string[]): Promise<Map<string, RoleName[]>> {
    const byUser = new Map<string, RoleName[]>();
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

  create(data: {
    fullName: string;
    email: string;
    passwordHash: string;
    languagePreference?: 'AR' | 'EN';
  }): Promise<User> {
    return this.prisma.client.user.create({
      data: { ...data, passwordUpdatedAt: new Date() },
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
    roleIds: string[];
    accessValidFrom?: Date;
    accessValidUntil?: Date;
  }): Promise<User> {
    const { roleIds, ...user } = data;
    return this.prisma.client.user.create({
      data: {
        ...user,
        passwordUpdatedAt: new Date(),
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
      roles: RoleName[];
    }[]
  > {
    const rows = await this.prisma.client.user.findMany({
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      select: {
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

  findRoleByName(name: RoleName): Promise<Role | null> {
    return this.prisma.client.role.findUnique({ where: { name } });
  }

  findRolesByNames(names: RoleName[]): Promise<Role[]> {
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
      return work();
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
