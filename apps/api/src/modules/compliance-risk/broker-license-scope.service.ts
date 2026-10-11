import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { BrokerKind, InsuranceLineCategory } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import {
  BrokerLicenseScopeRepository,
  type ScopeLineRow,
} from '../../repositories/broker-license-scope.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { pickCurrentTerm } from './broker-license.config';
import {
  assessCapital,
  branchCountByType,
  breachesNaturalPersonOneTypeRule,
  typesInScope,
} from './broker-license-scope.config';
import { formatMoney } from '../../common/money.util';
import type { AddScopeBranchDto } from './dto/add-scope-branch.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

export interface LicenseScopeView {
  brokerLicenseId: string;
  /** Derived from the branches — see `broker-license-scope.config.ts`. */
  types: InsuranceLineCategory[];
  branches: ScopeLineRow[];
  branchCountByType: Record<string, number>;
  brokerKind: BrokerKind | null;
  /** Art. 4/a. Money as fixed 3dp strings; a JOD figure never crosses the wire as a number. */
  capital: {
    requiredCapital: string;
    paidUpCapital: string | null;
    shortfall: string | null;
    meetsRequirement: boolean;
    capitalIsUnrecorded: boolean;
  };
}

/**
 * MODULE 0 ITEM (e) — what the office is licensed for.
 *
 * `license.manage` (`[COMPLIANCE_OFFICER]`) gates every route, the same code as the licence itself:
 * the scope is part of the licence record rather than a separate thing to grant.
 *
 * ## THIS SERVICE IS THE ONLY THING HOLDING ART. 3/a
 *
 * A natural person (sole establishment) may be licensed for ONE insurance type only. Deciding that
 * needs `Organization.brokerKind`, the scope rows, and the catalogue's `category` — three tables —
 * and a Postgres CHECK compares columns of ONE row of ONE table, so the database cannot express it.
 * A trigger could, but would have to fire on this table AND on `brokerKind` changing, which puts
 * one rule in two places.
 *
 * So the refusal lives here, at SERVICE grain, and is recorded as such rather than left for a
 * reader to assume a database guarantee. It is proven by an api e2e over real HTTP — not only by a
 * unit test — because the service is where the rule actually runs.
 */
@Injectable()
export class BrokerLicenseScopeService {
  private readonly logger = new Logger(BrokerLicenseScopeService.name);

  constructor(
    private readonly scope: BrokerLicenseScopeRepository,
    private readonly licenses: BrokerLicenseRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<LicenseScopeView> {
    const term = await this.mustFindCurrentTerm();
    return this.viewFor(term.id, term.organizationId);
  }

  /**
   * Adds one licensed branch to the office's CURRENT term.
   *
   * The current term rather than any term: a historical term's scope is a record of what the office
   * was licensed for then, and editing it would rewrite history rather than describe today.
   */
  async addBranch(
    dto: AddScopeBranchDto,
    actorUserId: string,
  ): Promise<LicenseScopeView> {
    const term = await this.mustFindCurrentTerm();

    const insuranceLineId = dto.insuranceLineId ?? null;
    const officeInsuranceLineId = dto.officeInsuranceLineId ?? null;

    /*
     * EXACTLY ONE CATALOGUE — checked HERE rather than by a DTO constraint, and the DTO's header
     * says why: `@IsOptional()` skips every validator on its property when the value is absent, so
     * a class-level constraint on either of these optional fields would be silently skipped in the
     * one case it exists for (a caller who names neither). This always runs.
     *
     * The database refuses the shape too, whatever the path in —
     * `BrokerLicenseScopeLine_exactly_one_line`. This is the message a caller sees; that is the
     * control.
     */
    const named = [insuranceLineId, officeInsuranceLineId].filter(
      (v) => v !== null,
    );
    if (named.length !== 1) {
      throw new BadRequestException(
        'Name exactly one of insuranceLineId (a standard catalogue line) or officeInsuranceLineId' +
          " (this office's own line) — not both, not neither.",
      );
    }

    // The check above refuses zero or two ids; this is the "does the named line exist" half, and it
    // is also the tenancy half: another office's bespoke line reads as ABSENT because the repository
    // read is tenant-scoped, so the 404 discloses nothing about what other offices hold.
    const category = await this.scope.findCandidateCategory(
      insuranceLineId,
      officeInsuranceLineId,
    );
    if (!category) {
      throw new NotFoundException('That insurance line was not found.');
    }

    const existing = await this.scope.findForTerm(term.id);
    const organization = await this.organizations.findById(term.organizationId);
    const brokerKind = organization?.brokerKind ?? null;

    // ART. 3/a. Decided BEFORE the write, against the scope the branch WOULD produce — checking
    // afterwards would mean refusing a row already committed, which is a worse shape than refusing
    // the request.
    if (
      breachesNaturalPersonOneTypeRule(brokerKind, [...existing, { category }])
    ) {
      throw new UnprocessableEntityException(
        'This office is registered as a sole establishment (natural person), which may be licensed' +
          ' for ONE insurance type only — CBJ Instructions No. 9 of 2026, art. 3/a. It already holds' +
          ` branches in ${typesInScope(existing).join(', ')}, so a ${category} branch cannot be added.` +
          ' A corporate broker may hold both types.',
      );
    }

    let created: { id: string };
    try {
      created = await this.scope.addLine({
        brokerLicenseId: term.id,
        insuranceLineId,
        officeInsuranceLineId,
      });
    } catch (err) {
      // One of the two PARTIAL uniques. A compound unique would not have caught this, because a
      // NULL column makes every row distinct — see the migration's header.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'That branch is already part of this licence term.',
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'BrokerLicenseScopeLine',
      entityId: created.id,
      afterValue: {
        brokerLicenseId: term.id,
        insuranceLineId,
        officeInsuranceLineId,
        category,
      },
    });
    return this.viewFor(term.id, term.organizationId);
  }

  async removeBranch(
    id: string,
    actorUserId: string,
  ): Promise<LicenseScopeView> {
    const term = await this.mustFindCurrentTerm();
    const res = await this.scope.removeLine(id, term.id);
    if (res.count === 0) {
      // Covers both "no such row" and "a row belonging to another term" — one message, because
      // distinguishing them would disclose that a branch exists on a term the caller did not name.
      throw new NotFoundException(
        'That branch is not part of this licence term.',
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'BrokerLicenseScopeLine',
      entityId: id,
      beforeValue: { brokerLicenseId: term.id },
    });
    return this.viewFor(term.id, term.organizationId);
  }

  private async viewFor(
    brokerLicenseId: string,
    organizationId: string,
  ): Promise<LicenseScopeView> {
    const branches = await this.scope.findForTerm(brokerLicenseId);
    const organization = await this.organizations.findById(organizationId);
    const capital = assessCapital(
      organization?.paidUpCapital ?? null,
      branches,
    );

    return {
      brokerLicenseId,
      types: typesInScope(branches),
      branches,
      branchCountByType: Object.fromEntries(branchCountByType(branches)),
      brokerKind: organization?.brokerKind ?? null,
      capital: {
        requiredCapital: formatMoney(capital.requiredCapital),
        paidUpCapital: capital.paidUpCapital
          ? formatMoney(capital.paidUpCapital)
          : null,
        shortfall: capital.shortfall ? formatMoney(capital.shortfall) : null,
        meetsRequirement: capital.meetsRequirement,
        capitalIsUnrecorded: capital.capitalIsUnrecorded,
      },
    };
  }

  private async mustFindCurrentTerm() {
    const current = pickCurrentTerm(await this.licenses.findTerms());
    if (!current) {
      throw new NotFoundException(
        'This office holds no broker license term yet — record one before describing its scope.',
      );
    }
    return current;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Licence-scope audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
