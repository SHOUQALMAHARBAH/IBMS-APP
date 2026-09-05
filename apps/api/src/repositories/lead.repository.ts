import { Injectable } from '@nestjs/common';
import type { Lead, LeadStatus } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLeadInput {
  fullName: string;
  source: string;
  ownerUserId: string;
  contactPhone?: string;
  contactEmail?: string;
  marketingConsentGranted: boolean;
}

export interface LeadFilter {
  source?: string;
  ownerUserId?: string;
  status?: LeadStatus;
}

@Injectable()
export class LeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateLeadInput): Promise<Lead> {
    return this.prisma.client.lead.create({ data: input });
  }

  findById(id: string): Promise<Lead | null> {
    return this.prisma.client.lead.findUnique({ where: { id } });
  }

  findMany(filter: LeadFilter): Promise<Lead[]> {
    return this.prisma.client.lead.findMany({
      where: {
        source: filter.source,
        ownerUserId: filter.ownerUserId,
        status: filter.status,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
