import { Injectable } from '@nestjs/common';
import type { Department } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Part II §4.1.1 — an office's functional groupings.
 *
 * The model has existed since Phase 1 and had no consumer until now. Every read
 * goes through the tenant-scoped client, so "does this department exist" always
 * means "does it exist in THIS office" — Office A's Claims department and
 * Office B's are different rows and neither office can see the other's.
 */
@Injectable()
export class DepartmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Department | null> {
    return this.prisma.client.department.findFirst({ where: { id } });
  }

  list(): Promise<Department[]> {
    return this.prisma.client.department.findMany({ orderBy: { name: 'asc' } });
  }

  create(data: { name: string; nameAr?: string | null }): Promise<Department> {
    return this.prisma.client.department.create({ data });
  }
}
