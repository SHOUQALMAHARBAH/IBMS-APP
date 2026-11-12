import { Injectable } from '@nestjs/common';
import type { DeclaredAct, DeclaredActSite } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Everything a declared act records. Every field is REQUIRED except the network address, which is
 *  nullable because a request can genuinely arrive without a resolvable one — see
 *  `clientIpForRecord`, which returns NULL rather than the string `'unknown'` for exactly that. */
export interface CreateDeclaredActInput {
  site: DeclaredActSite;
  articleRef: string;
  articleTextShown: string;
  acknowledgementTextShown: string;
  responsibilitySentence: string;
  reason: string;
  permissionCode: string;
  entity: string;
  entityId: string;
  transactionRef: string;
  actorUserId: string;
  actorNameShown: string;
  networkAddress: string | null;
}

/**
 * THE DECLARED-ACT RECORD — module-1 paper §٨, OWNER DECISION 126.
 *
 * ## THERE IS NO `update`, NO `delete`, AND THAT IS NOT AN OVERSIGHT
 *
 * Element 7: «السجلُّ إضافةٌ فقط: لا يُحذَف ولا يُعدَّل بأيِّ صلاحية». Two BEFORE triggers in
 * migration `20261217100000` refuse UPDATE and DELETE at the database, under every permission,
 * including the owner's — so a method here would fail at runtime rather than compile-time. Not
 * writing one is the weaker half of that guarantee; the triggers are the real one. Both exist
 * because a reader of this file should not have to find the migration to learn the rule.
 *
 * `organizationId` is deliberately absent from the input: it carries
 * `DEFAULT current_setting('app.current_org_id', true)` and `tenantScopeExtension` supplies it.
 * Passing it by hand would be a second answer to which office is acting.
 */
@Injectable()
export class DeclaredActRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateDeclaredActInput): Promise<DeclaredAct> {
    return this.prisma.client.declaredAct.create({ data: input });
  }

  /** Every declaration on one record, newest first — element 5's *«والسجلُّ المتعلّق»*, so the act
   *  can be shown ON the record and not only in the office's compliance report. */
  findForRecord(entity: string, entityId: string): Promise<DeclaredAct[]> {
    return this.prisma.client.declaredAct.findMany({
      where: { entity, entityId },
      orderBy: { actedAt: 'desc' },
    });
  }

  /**
   * ELEMENT 8's TWO READINGS, from one table.
   *
   * «يظهر في تقريرِ امتثالِ المكتبِ مفصَّلاً، وعند المزوّدِ رقماً مجمَّعاً فقط» — detailed in the
   * office's own compliance report, and at the provider an AGGREGATE NUMBER ONLY. This is the
   * aggregate half: counts per site, never rows. The provider surface that consumes it is NOT in
   * this batch (message 36 §3 is server and database only), and the method is written now because
   * the shape of the answer is what element 8 constrains — a provider endpoint that could return
   * rows would be the wrong shape however carefully it was then filtered.
   */
  async countBySite(): Promise<{ site: DeclaredActSite; count: number }[]> {
    const grouped = await this.prisma.client.declaredAct.groupBy({
      by: ['site'],
      _count: { _all: true },
    });
    return grouped.map((row) => ({ site: row.site, count: row._count._all }));
  }
}
