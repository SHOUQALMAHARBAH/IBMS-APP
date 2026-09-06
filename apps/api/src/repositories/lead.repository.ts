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
  /** Part D §5.1 (touchpoint #1, lead capture) — which approved privacy
   * notice wording was shown at intake (`PRIV-FRM-04/05`'s consent-text
   * versioning; `PrivacyNotice`, Part D's own version-controlled register,
   * is not built yet, so this stays a caller-supplied label, the same shape
   * `CreateConsentRecordDto.consentTextVersion` already uses everywhere
   * else). */
  consentTextVersion: string;
}

export interface LeadFilter {
  source?: string;
  ownerUserId?: string;
  status?: LeadStatus;
}

@Injectable()
export class LeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Lead + its lead-capture marketing `ConsentRecord` in ONE interactive
   * transaction — the `EmployeeRepository.terminate()` /
   * `retention-case.repository.ts#escalateAndCreateRetentionCase`
   * "create-together" shape, a deliberate local exception to this
   * codebase's no-`$transaction` convention. `Lead.marketingConsentGranted`
   * stays the fast, denormalized read the Lead list/detail views already
   * use; the `ConsentRecord` row (owned via `leadId`, not
   * `customerId`/`insuredPersonId` — a Lead pre-dates a Customer) is what
   * makes this decision visible in the DPO's unified consent register and
   * withdrawable through the normal 2-business-day SLA flow, neither of
   * which a plain boolean column can do. */
  async create(input: CreateLeadInput): Promise<Lead> {
    return this.prisma.client.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          fullName: input.fullName,
          source: input.source,
          ownerUserId: input.ownerUserId,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          marketingConsentGranted: input.marketingConsentGranted,
        },
      });
      await tx.consentRecord.create({
        data: {
          leadId: lead.id,
          purpose: 'MARKETING',
          isMarketing: true,
          granted: input.marketingConsentGranted,
          consentTextVersion: input.consentTextVersion,
          grantedAt: input.marketingConsentGranted ? new Date() : null,
        },
      });
      return lead;
    });
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
