import { Injectable } from '@nestjs/common';
import type { Branch } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Part II §4.2.2 — an office's organizational locations.
 *
 * `Branch` has existed since the core schema and, like `Department` before it,
 * had no write path anywhere in the application: nothing created one, the seed
 * created none, and the only rows in existence were made by e2e specs reaching
 * past the API with raw Prisma. §4.2.2 makes Branch a required field on the
 * provisioning form, which is hollow unless an administrator can create one.
 *
 * Every read goes through the tenant-scoped client, so "does this branch
 * exist" always means "does it exist in THIS office".
 */
@Injectable()
export class BranchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Branch | null> {
    return this.prisma.client.branch.findFirst({ where: { id } });
  }

  list(): Promise<Branch[]> {
    // LIVE units only. A retired one keeps every existing assignment readable on the person's
    // record; it simply stops being offered for new ones, and this is the read every picker uses.
    return this.prisma.client.branch.findMany({
      where: { deactivatedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  create(data: { name: string; nameAr?: string | null }): Promise<Branch> {
    return this.prisma.client.branch.create({ data });
  }

  rename(id: string, data: { name?: string; nameAr?: string | null }) {
    return this.prisma.client.branch.update({ where: { id }, data });
  }

  deactivate(id: string) {
    return this.prisma.client.branch.update({
      where: { id },
      data: { deactivatedAt: new Date() },
    });
  }
}
