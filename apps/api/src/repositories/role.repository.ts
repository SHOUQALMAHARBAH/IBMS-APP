import { Injectable } from '@nestjs/common';
import type { Role } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Role[]> {
    return this.prisma.client.role.findMany({ orderBy: { name: 'asc' } });
  }

  /** Active (non-revoked) user ids currently holding a given role. */
  async findActiveUserIdsByRoleName(roleName: Role['name']): Promise<string[]> {
    const assignments = await this.prisma.client.userRoleAssignment.findMany({
      where: { revokedAt: null, role: { name: roleName } },
      select: { userId: true },
    });
    return assignments.map((a) => a.userId);
  }
}
