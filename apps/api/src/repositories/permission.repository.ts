import { Injectable } from '@nestjs/common';
import type { Permission, RoleName } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Permission[]> {
    return this.prisma.client.permission.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /** Every distinct permission code granted to any of the given roles. */
  async findCodesForRoles(roles: RoleName[]): Promise<string[]> {
    if (roles.length === 0) return [];
    const links = await this.prisma.client.rolePermission.findMany({
      where: { role: { name: { in: roles } } },
      select: { permission: { select: { code: true } } },
    });
    return [...new Set(links.map((l) => l.permission.code))];
  }
}
