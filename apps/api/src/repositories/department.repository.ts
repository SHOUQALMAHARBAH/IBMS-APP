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

  /**
   * LIVE units by default. A retired one keeps every existing assignment readable on the person's
   * record; it simply stops being offered for new ones, and this is the read every picker uses.
   *
   * `includeRetired` DEFAULTS TO FALSE, which is the whole of why it is a parameter rather than a
   * second method: every existing caller is a picker or a filter, and a retired unit must not be
   * offered for new work. The ADMINISTRATIVE read is the one case that needs the other answer —
   * without it a retired department is invisible on the only screen that could bring it back, which
   * is the state the reactivate route below exists to fix. `Role` already works this way one
   * directory over: `role.repository.ts` keeps retired roles in its admin read with the reason
   * written down — "an office must be able to reactivate one".
   */
  list(includeRetired = false): Promise<Department[]> {
    return this.prisma.client.department.findMany({
      where: includeRetired ? {} : { deactivatedAt: null },
      // A TOTAL order once retired rows can be in the set: `name` alone is not one, and two units
      // may legitimately share a name when one of them is retired (the unique index is partial).
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  create(data: { name: string; nameAr?: string | null }): Promise<Department> {
    return this.prisma.client.department.create({ data });
  }

  rename(id: string, data: { name?: string; nameAr?: string | null }) {
    return this.prisma.client.department.update({ where: { id }, data });
  }

  deactivate(id: string) {
    return this.prisma.client.department.update({
      where: { id },
      data: { deactivatedAt: new Date() },
    });
  }

  /**
   * Bring a retired department back.
   *
   * The office retires a unit it has stopped using and then reorganises again; without this the
   * only way back was a hand-written UPDATE. `Role` has had `POST /roles/:id/reactivate` since
   * Phase 3 for exactly this reason, and the two sides of this system disagreed about it.
   *
   * The name collision is handled BY THE DATABASE and needs no check here:
   * `Department_one_live_name_per_org` is `UNIQUE (organizationId, lower(name)) WHERE
   * deactivatedAt IS NULL`, so clearing the stamp enters that index and a clash with a live unit
   * of the same name raises P2002 — which the service turns into the same 409 a create gets,
   * through `asNameCollision`. A check in application code would be a second answer to a question
   * the index already decides.
   */
  reactivate(id: string) {
    return this.prisma.client.department.update({
      where: { id },
      data: { deactivatedAt: null },
    });
  }
}
