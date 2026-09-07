import { Injectable } from '@nestjs/common';
import type { Prisma, Prospect } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProspectInput {
  leadId: string;
  companyName: string;
  sector?: string;
  activity?: string;
  employeeCount?: number;
  businessSize?: string;
  location?: string;
  contactPerson?: string;
  productsOfInterest?: string[];
  expectedPremium?: Prisma.Decimal;
  salesOwnerUserId: string;
}

export interface ProspectFilter {
  salesOwnerUserId?: string;
  /** Part F item #6 — pre-resolved ids from a full-text search
   * (searchIds()); undefined means no search filter is active. */
  id?: string[];
}

@Injectable()
export class ProspectRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProspectInput): Promise<Prospect> {
    return this.prisma.client.prospect.create({ data: input });
  }

  findById(id: string): Promise<Prospect | null> {
    return this.prisma.client.prospect.findUnique({ where: { id } });
  }

  findMany(filter: ProspectFilter): Promise<Prospect[]> {
    return this.prisma.client.prospect.findMany({
      where: {
        salesOwnerUserId: filter.salesOwnerUserId,
        id: filter.id ? { in: filter.id } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Part F item #6 — bilingual full-text search over companyName +
   * contactPerson. See CustomerRepository.searchIds()'s own comment for
   * the full mechanism/safety rationale (identical here). */
  async searchIds(term: string): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Prospect"
      WHERE "searchVector" @@ (
        websearch_to_tsquery('arabic', ${term}) ||
        websearch_to_tsquery('english', ${term})
      )
    `;
    return rows.map((r) => r.id);
  }
}
