import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Prospect } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { expandSearchTerms } from '../common/name-transliteration.config';

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
   * the full mechanism/safety rationale (identical here, including the
   * Part F item #6 remainder fuzzy-transliteration-variant expansion). */
  async searchIds(term: string): Promise<string[]> {
    const terms = [term, ...expandSearchTerms(term)];
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Prospect"
      WHERE (${Prisma.join(
        terms.map(
          (t) => Prisma.sql`"searchVector" @@ (
            websearch_to_tsquery('arabic', ${t}) ||
            websearch_to_tsquery('english', ${t})
          )`,
        ),
        ' OR ',
      )})
    `;
    return rows.map((r) => r.id);
  }
}
