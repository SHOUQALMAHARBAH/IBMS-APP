import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { INSURER_IDENTITY_SELECT } from './insurer-identity';

/**
 * Insurer management — the office's OWN insurer records.
 *
 * Distinct from `InsurerMasterRepository`, which reads the global catalogue: every
 * model here carries `organizationId`, so `tenantScopeExtension` filters each
 * query and an RLS policy backs it. That is why no method below takes an
 * organization id and no create passes one — the extension stamps it, and a call
 * site that supplied its own would be the one place a caller could write into
 * another office (`tenant-scope.extension.ts`: "no call site passes
 * `organizationId`").
 *
 * The practical consequence for reads: another office's insurer id is ABSENT, not
 * forbidden. The service turns that into a 404 rather than a 403, which is what
 * keeps an id from being an oracle for what other offices deal with.
 */

/**
 * What a management read needs on top of the shared identity select.
 *
 * Built by spreading `INSURER_IDENTITY_SELECT` rather than restating it: that
 * constant exists because five private copies of the name join once drifted, and
 * a sixth copy here would be the same mistake with a different name.
 */
export const INSURER_RECORD_SELECT = {
  ...INSURER_IDENTITY_SELECT,
  // Selected as well as the joined master, so the view can say WHICH registration
  // path this row took without inferring it from whether a join came back.
  insurerMasterId: true,
  linesOffered: true,
  rfqContactName: true,
  rfqContactEmail: true,
  rfqContactPhone: true,
  claimsContactName: true,
  claimsContactEmail: true,
  underwriterContact: true,
  creditTermsDays: true,
  createdAt: true,
} as const satisfies Prisma.InsurerSelect;

export type InsurerRecord = Prisma.InsurerGetPayload<{
  select: typeof INSURER_RECORD_SELECT;
}>;

export interface InsurerListFilter {
  /** Undefined means BOTH — a management list has to show what the office
   *  deactivated, or it cannot offer to reactivate it. */
  isActive?: boolean;
  search?: string;
}

/** The relationship fields a caller may set. Deliberately not `Prisma.InsurerUpdateInput`:
 *  that would accept `organizationId`, `insurerMasterId` and `isActive`, which are
 *  respectively the tenant boundary, the identity and a workflow of its own. */
export interface InsurerRelationshipFields {
  rfqContactName?: string | null;
  rfqContactEmail?: string | null;
  rfqContactPhone?: string | null;
  claimsContactName?: string | null;
  claimsContactEmail?: string | null;
  underwriterContact?: string | null;
  creditTermsDays?: number | null;
  financialStrengthRating?: string | null;
}

@Injectable()
export class InsurerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The office's insurers, newest registration first.
   *
   * Ordered by `createdAt desc` like every other paged list here, NOT
   * alphabetically, and that is a limitation rather than a preference: an
   * insurer's name lives either on the joined `InsurerMaster` or on this row, so
   * a single SQL ordering over "the name" does not exist without a raw query, and
   * Arabic-aware ordering needs either an in-memory sort of the whole set (which
   * is what the two unpaginated pickers do) or a DB-level ICU collation. Neither
   * belongs in this commit. `search` is what makes finding a company by name work
   * meanwhile, and it is applied as a QUERY filter so the page bounds matching
   * rows rather than rows scanned.
   */
  findManyForOffice(
    filter: InsurerListFilter,
    window: { take: number; skip: number },
  ): Promise<InsurerRecord[]> {
    return this.prisma.client.insurer.findMany({
      where: this.whereFor(filter),
      select: INSURER_RECORD_SELECT,
      orderBy: { createdAt: 'desc' },
      take: window.take,
      skip: window.skip,
    });
  }

  countForOffice(filter: InsurerListFilter): Promise<number> {
    return this.prisma.client.insurer.count({ where: this.whereFor(filter) });
  }

  findById(id: string): Promise<InsurerRecord | null> {
    return this.prisma.client.insurer.findUnique({
      where: { id },
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Registers an insurer by EITHER path.
   *
   * `organizationId` is absent on purpose — see this file's header. `insurerMasterId`
   * and the local names are mutually exclusive, which the service decides and the
   * `Insurer_has_identity` CHECK enforces; this method is the narrow write.
   */
  create(input: {
    insurerMasterId: string | null;
    legalName: string | null;
    legalNameAr: string | null;
    relationship: InsurerRelationshipFields;
  }): Promise<InsurerRecord> {
    return this.prisma.client.insurer.create({
      data: {
        insurerMasterId: input.insurerMasterId,
        legalName: input.legalName,
        legalNameAr: input.legalNameAr,
        ...input.relationship,
      },
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Updates one of the office's own insurers.
   *
   * The `where` re-asserts nothing beyond the id because the tenant extension
   * already scopes it: an id from another office matches no row and Prisma raises
   * P2025, which the service has already turned into a 404 by loading the row
   * first.
   */
  update(
    id: string,
    patch: InsurerRelationshipFields & {
      legalName?: string;
      legalNameAr?: string;
    },
  ): Promise<InsurerRecord> {
    return this.prisma.client.insurer.update({
      where: { id },
      data: patch,
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Both name sources, because a company registered locally by this office and one
   * it linked from the catalogue are the same company to whoever is searching.
   * `mode: 'insensitive'` is applied to the Latin columns only — it is a no-op on
   * Arabic, which has no case.
   */
  private whereFor(filter: InsurerListFilter): Prisma.InsurerWhereInput {
    const search = filter.search?.trim();
    return {
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: 'insensitive' } },
              { legalNameAr: { contains: search } },
              {
                insurerMaster: {
                  legalName: { contains: search, mode: 'insensitive' },
                },
              },
              { insurerMaster: { legalNameAr: { contains: search } } },
            ],
          }
        : {}),
    };
  }
}
