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
      where: { salesOwnerUserId: filter.salesOwnerUserId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
