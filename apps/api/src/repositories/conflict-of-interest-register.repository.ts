import { Injectable } from '@nestjs/common';
import type { ConflictOfInterestRegisterEntry } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface ConflictOfInterestRegisterRow extends ConflictOfInterestRegisterEntry {
  declaredBy: { id: string; fullName: string };
}

/**
 * THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER — decision 36.
 *
 * ## CREATE AND READ. THERE IS NO UPDATE AND NO DELETE, AND THAT IS NOT AN OMISSION
 *
 * A disclosure is a statement somebody made; a correction is a NEW entry. The database enforces it
 * with the `AuditLogEntry` trigger pair rather than with a narrower GRANT, because `pg_default_acl`
 * hands `ibms_app` all four privileges on every new table in this schema — so a method here that
 * tried to update would fail at runtime naming the table, which is the backstop existing rather
 * than being described.
 *
 * Methods are not written for capabilities nothing has: a repository method with no caller is the
 * shape the enforcement inventory refuses.
 *
 * ## THE AUTHOR'S NAME IS INCLUDED, NOT LOOKED UP PER ROW
 *
 * `declaredByUserId` alone would put a uuid in front of the manager reading the register, which is
 * the identifier-where-a-name-exists fault the screen pass is about to measure across the product.
 * One include rather than N lookups.
 */
@Injectable()
export class ConflictOfInterestRegisterRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    declaredByUserId: string;
    disclosure: string;
  }): Promise<ConflictOfInterestRegisterEntry> {
    return this.prisma.client.conflictOfInterestRegisterEntry.create({
      data: {
        declaredByUserId: input.declaredByUserId,
        disclosure: input.disclosure,
      },
    });
  }

  /**
   * This office's register, newest first — the order the dedicated index supports.
   *
   * A TOTAL ORDER, because `declaredAt` is a timestamp two entries can share when one person
   * records two conflicts in the same request cycle, and `Array.prototype.sort`'s answer for equal
   * keys is whatever the query plan returned. The recorded lesson from `findActiveUserIdsWithPermission`
   * and from `foldActs`: a consumer that reads a list in order imposes an ordering requirement
   * nothing type-checks, so the order belongs in the query.
   */
  listForOrganization(): Promise<ConflictOfInterestRegisterRow[]> {
    return this.prisma.client.conflictOfInterestRegisterEntry.findMany({
      orderBy: [{ declaredAt: 'desc' }, { id: 'desc' }],
      include: { declaredBy: { select: { id: true, fullName: true } } },
    });
  }
}
