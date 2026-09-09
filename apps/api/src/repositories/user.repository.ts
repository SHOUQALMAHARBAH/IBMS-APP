import { Injectable } from '@nestjs/common';
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

  /** Grant a role. Idempotent by construction: `UserRoleAssignment` carries
   * `@@unique([userId, roleId])`, so a re-grant of a still-active assignment
   * is an `update` no-op and a re-grant of a previously REVOKED one clears
   * `revokedAt` — one upsert, no check-then-act read
   * (`race-safe-invariants.md`). */
  grantRole(userId: string, roleId: string): Promise<UserRoleAssignment> {
    return this.prisma.client.userRoleAssignment.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: { revokedAt: null, grantedAt: new Date() },
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

  /** Active holders of a role, used to refuse the last-administrator revoke
   * that would lock every admin out of the provisioning surface. */
  countActiveHoldersOfRole(roleId: string): Promise<number> {
    return this.prisma.client.userRoleAssignment.count({
      where: { roleId, revokedAt: null, user: { isActive: true } },
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
