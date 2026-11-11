import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { LegalValue } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * OWNS `LegalValue` — the legal-values table (module 1, OWNER DECISION 123).
 *
 * ## THE EFFECTIVE DATING IS APPLIED HERE, SO NO CALLER CAN FORGET IT
 *
 * The same reasoning as `SlaPolicyRepository.findActiveFor`, and the same reasoning that made
 * `sla-timer.service.ts`'s stage lookup a defect: it omitted the date and silently read TODAY's
 * row. Criterion 3 — *read an old transaction and it computes at the value in force on its own
 * day* — is a property of this repository, not of a caller remembering a parameter. `at` is
 * therefore REQUIRED with no default: a default of `new Date()` compiles at every call site and
 * reintroduces exactly that defect.
 *
 * ## WHAT THE TENANT EXTENSION DOES TO THESE READS
 *
 * `LegalValue.organizationId` is NULLABLE and NULL means provider-owned.
 * `PROVIDER_OWNED_NULL_ORG_MODELS` in `tenant-scope.extension.ts` widens READS on this model to
 * *this office's rows OR the provider's* — and widens nothing else. So a read here returns both
 * kinds and the methods below have to say which one wins.
 *
 * ## AND WHEN BOTH EXIST FOR ONE CODE, THE READ REFUSES
 *
 * Decision 123's third form splits by CODE: a figure the instrument states is the provider's, a
 * figure it defers to an unissued ruling is the office's. So for any one code there should be
 * exactly one owner, and the two partial uniques make "one current row per code per owner" true.
 *
 * What the database cannot know is WHICH codes belong to which side — that is the catalogue's
 * knowledge, and `packages/db` cannot be imported from here. So the remaining hole in criterion 7
 * (an office declaring a value for a code the instrument states) is made LOUD instead of silent:
 * if a code has both a provider row and an office row in force on the same day, the read throws
 * and names the code. Preferring either one quietly would make a figure's authority depend on
 * which table row happened to exist, which is the one thing this table exists to prevent.
 */
@Injectable()
export class LegalValueRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every row in force on `at`, for any code. One query, because the licence derivation needs
   * five of them at once and five round trips for one answer is five chances to read two different
   * days.
   */
  async findAllInForce(at: Date): Promise<LegalValue[]> {
    return this.prisma.client.legalValue.findMany({
      where: {
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /**
   * Every row this office can see for one code, newest window first. The dated HISTORY, which is
   * what `legal-value.read`'s description promises: an old transaction was computed at the value
   * in force on its own day, and the record has to be able to show which row that was.
   */
  async findHistory(code: string): Promise<LegalValue[]> {
    return this.prisma.client.legalValue.findMany({
      where: { code },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * DECLARE an office value — APPEND, never edit.
   *
   * The office's current row for this code (if any) gets an `effectiveTo` of the new row's
   * `effectiveFrom`, and a new row is inserted. Both in ONE transaction, because the partial
   * unique allows exactly one open window per code per office: doing it in two statements leaves
   * a moment where either two rows are open (the insert first) or none is (the close first), and
   * the second is the state in which a running transaction reads NO legal value at all.
   *
   * The PROVIDER's row for the same code is never touched, and cannot be: RLS refuses this role
   * any write to a NULL-org row, and the `where` below names the office's own rows explicitly
   * rather than relying on that alone.
   */
  async declare(input: {
    code: string;
    name: string;
    kind: LegalValue['kind'];
    numericValue: string | null;
    dateValue: Date | null;
    sourceReference: string;
    effectiveFrom: Date;
    note: string | null;
    actorUserId: string;
  }): Promise<LegalValue> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.legalValue.updateMany({
        where: { code: input.code, effectiveTo: null },
        data: {
          effectiveTo: input.effectiveFrom,
          updatedByUserId: input.actorUserId,
        },
      });
      return tx.legalValue.create({
        data: {
          code: input.code,
          name: input.name,
          kind: input.kind,
          numericValue: input.numericValue,
          dateValue: input.dateValue,
          // Always the office's. A CHECK ties this to `organizationId` in both directions, so a
          // caller cannot claim the instrument's authority here.
          sourceType: 'OFFICE_DECLARATION',
          sourceReference: input.sourceReference,
          effectiveFrom: input.effectiveFrom,
          note: input.note,
          createdByUserId: input.actorUserId,
        },
      });
    });
  }

  /**
   * THE row in force for one code on `at`, or null when none is.
   *
   * Null is a real answer and must stay one: it is how a DORMANT office-supplied value reads
   * (criterion 6 — an empty field is dormant, so nothing rests on it), and how a code with no row
   * at all reads. A caller that needs a figure must say what it does with null; a caller that
   * treats null as zero has turned an absent legal value into a stated one.
   */
  async findInForce(code: string, at: Date): Promise<LegalValue | null> {
    const rows = await this.prisma.client.legalValue.findMany({
      where: {
        code,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
    });
    return pickOneOwner(code, rows);
  }
}

/**
 * One row per code, or a refusal — exported so the rule is unit-testable without a database, the
 * same split `license-standing.config.ts` keeps between its derivation and its gate.
 */
export function pickOneOwner(
  code: string,
  rows: readonly LegalValue[],
): LegalValue | null {
  if (rows.length === 0) return null;
  const office = rows.filter((r) => r.organizationId !== null);
  const provider = rows.filter((r) => r.organizationId === null);

  if (office.length > 0 && provider.length > 0) {
    throw new UnprocessableEntityException(
      `Legal value "${code}" has BOTH an office-declared row and a provider row in force on the ` +
        `same day. Decision 123 splits these by code — a figure the instrument states is the ` +
        `provider's, and only a figure it defers to an unissued ruling is the office's — so one ` +
        `of these two rows should not exist. The read is refused rather than picking a winner: a ` +
        `figure whose authority depends on which row happened to exist is worse than no figure.`,
    );
  }

  const side = office.length > 0 ? office : provider;
  if (side.length > 1) {
    // The partial uniques make this unreachable for CURRENT rows; it is reachable for a pair of
    // historical rows whose windows were entered overlapping. Refusing names the data fault
    // instead of letting `[0]` decide — the recorded `findActiveUserIdsWithPermission` shape,
    // where a missing `orderBy` passed at 46,153 rows and failed at 23.
    throw new UnprocessableEntityException(
      `Legal value "${code}" has ${side.length} rows in force on the same day for one owner — ` +
        `their effective windows overlap. A value is appended with a new effective date and the ` +
        `row it supersedes gets an \`effectiveTo\`; two open windows for one code is a data fault.`,
    );
  }
  return side[0];
}
