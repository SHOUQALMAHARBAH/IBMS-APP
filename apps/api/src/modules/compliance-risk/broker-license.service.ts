import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { BrokerLicense } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import {
  brokerLicenseAuditSnapshot,
  deriveBrokerLicenseView,
  pickCurrentTerm,
  type BrokerLicenseView,
} from './broker-license.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import type { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';
import type { RecordRenewalRequestDto } from './dto/record-renewal-request.dto';
import type { BrokerLicenseTermDto } from './dto/broker-license-term.dto';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { RecordRegulatoryActionDto } from './dto/record-regulatory-action.dto';
import { LicenseGateService } from './license-gate.service';
import type { DerivedLicenseStanding } from './license-standing.config';
import {
  deriveRenewalNotice,
  type RenewalNotice,
} from './license-renewal-notice.config';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** What `GET /broker-license` answers: the term that decides whether the office may practise, plus
 *  the series behind it. `current` is NULL for an office that holds no licence — which is a state
 *  the screen has to be able to render, because it is also the state that BLOCKS new business. */
export interface BrokerLicenseSeriesView {
  current: BrokerLicenseView | null;
  terms: BrokerLicenseView[];
  /**
   * THE ONE ANSWER — decision 71's six states plus `mayPractise`, the same value
   * `LicenseGateService` refuses on.
   *
   * It replaces the stored `status` the screen used to render beside `isCurrentlyLapsed`: a
   * two-value flag next to a live-derived boolean, on the same row, which was the three-answer
   * defect made visible. What a reader sees and what the system refuses are now one value.
   */
  standing: DerivedLicenseStanding;
  /**
   * PIECE 3 — THE RENEWAL NOTICE, derived on every read from the current term's own expiry.
   *
   * It rides THIS read rather than getting a route of its own, and the reason is measured:
   * `license.manage` (which gates this) and `compliance-calendar.manage` are held by the SAME
   * seeded set, so the notice already reaches exactly the people who work the regulatory calendar —
   * no new permission code, no routing table, and و.١١'s "to a permission holder, never a role
   * name" is satisfied by the code that is already here.
   *
   * Nothing is stored. A "notified at" column would be a second answer to whether the licence is in
   * fact running out, which is the defect the first half of this batch removed one layer up.
   */
  renewalNotice: RenewalNotice;
}

/**
 * Module 0 item (c) — the office's CBJ licence, as a series of terms.
 *
 * `license.manage` (`[COMPLIANCE_OFFICER]`) gates every route, unchanged. Not a
 * `WorkflowTransitionService` entity and no maker/checker — a single officer records their own
 * regulator's record.
 *
 * ## Renewal APPENDS. It used to overwrite.
 *
 * The old `renew` was an `updateMany` over one globally-keyed row, so the term being replaced was
 * erased: the office could not show a regulator what it had been licensed for in a previous period.
 * A renewal now writes a new term and leaves the old one, with its own certificate and dates.
 */
@Injectable()
export class BrokerLicenseService {
  private readonly logger = new Logger(BrokerLicenseService.name);

  constructor(
    private readonly repo: BrokerLicenseRepository,
    private readonly audit: AuditService,
    private readonly acts: RegulatoryActionRepository,
    private readonly licenseGate: LicenseGateService,
  ) {}

  /** This office's FIRST term. 409 if it already holds one — per office now, where the old 409 was
   *  effectively per platform because the row was keyed by a global constant. */
  async create(
    dto: CreateBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const existing = await this.repo.findTerms();
    if (existing.length > 0) {
      throw new ConflictException(
        'This office already holds a broker license — use renew to record the next term.',
      );
    }
    return this.appendTerm(dto, actorUserId);
  }

  /** The NEXT term. 404 if the office holds none yet. */
  async renew(
    dto: RenewBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    await this.mustFindCurrentTerm();
    return this.appendTerm(dto, actorUserId);
  }

  /**
   * Records that the renewal application for the next term has been filed, against the CURRENT
   * term — because art. 11's 45-day deadline is measured from THAT term's expiry.
   */
  async recordRenewalRequest(
    dto: RecordRenewalRequestDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const current = await this.mustFindCurrentTerm();
    const supplied = dto.requestedAt !== undefined;
    const requestedAt = supplied
      ? parseCalendarDate(dto.requestedAt as string, 'requestedAt')
      : new Date();

    const res = await this.repo.recordRenewalRequest(current.id, requestedAt);
    if (res.count === 0) {
      // Already recorded. Deliberately not an error and deliberately not an overwrite: this date is
      // what art. 11 lateness is measured against, so a second call must not be able to move it.
      throw new ConflictException(
        'A renewal application is already recorded for the current term; its filing date cannot be changed.',
      );
    }

    const after = await this.mustFindCurrentTerm();
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'BrokerLicense',
      entityId: after.id,
      afterValue: {
        ...brokerLicenseAuditSnapshot(after),
        // WHICH date, and whether a human chose it. The DTO explains why a supplied date is
        // allowed; this is what makes a backdated filing answerable rather than invisible.
        renewalRequestedAtWasSupplied: supplied,
      },
    });
    return deriveBrokerLicenseView(after, new Date());
  }

  /**
   * THE OFFICE RECORDS A DECISION THE REGULATOR TOOK ABOUT ITS LICENCE.
   *
   * ## THIS REPLACES `markLapsed`, AND THE DIFFERENCE IS THE WHOLE POINT
   *
   * `markLapsed` took no body — its own comment said *"the model has no reason field to hold one"* —
   * and flipped `BrokerLicense.status` to `'lapsed'`. So the office's record of a CBJ suspension was
   * a two-value flag: no basis, no effective date, no decision reference, no letter.
   * `deriveLicenseStanding` read it as SUSPENDED with a NULL decision reference and called that null
   * "the finding", because *"a suspension nobody can cite is exactly the state `RegulatoryAction`
   * exists to end"*.
   *
   * MEASURED before replacing it, so the collapse order in `docs/deferred-register.md` entry 12 is
   * followed rather than asserted: dev held 3 terms, ALL `active`; db-test held 4 active and 3
   * lapsed, every one an e2e artefact. Nothing real was standing in for the marker, so there was
   * nothing to convert — only a capability to replace, and this is it.
   *
   * ## THERE IS NO REGULATOR IN THIS SYSTEM
   *
   * The CBJ acts on the office outside this product, on paper or electronically. This records a
   * letter the office RECEIVED. No regulator account, no regulator screen, no regulator action.
   *
   * ## AND NOTHING HERE LIFTS A BLOCK
   *
   * A REINSTATEMENT is recorded the same way, and the derivation stops folding a suspension once a
   * later reinstatement stands — so the standing follows the acts rather than a button. What lifts a
   * lapse is still what it always was: recording the new term WITH its certificate.
   */
  async recordRegulatoryAction(
    dto: RecordRegulatoryActionDto,
    /*
     * THE ACTOR, not just an id — because `RegulatoryAction.organizationId` carries NO tenancy
     * default. Measured off the schema: unlike most scoped models it has no
     * `@default(dbgenerated())`, so the office has to be named on the INSERT even though RLS scopes
     * the reads (from-empty asserts that table is ENABLEd and FORCEd). The actor is where this
     * project gets it — `insurance-company-registration.service.ts` takes the same shape for the
     * same reason.
     */
    actor: { id: string; organizationId: string },
  ): Promise<DerivedLicenseStanding> {
    const actorUserId = actor.id;
    const row = await this.acts.create({
      organizationId: actor.organizationId,
      kind: dto.kind,
      basis: dto.basis,
      effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00.000Z`),
      decisionRef: dto.decisionRef,
      documentId: dto.documentId ?? null,
      suspendedUntil:
        dto.suspendedUntil === undefined
          ? null
          : new Date(`${dto.suspendedUntil}T00:00:00.000Z`),
      recordedByUserId: actorUserId,
    });

    /*
     * AUDITED, AND NOT BEST-EFFORT for the standing itself — but the audit row is `safeAudit`,
     * matching every other write in this service: the act is already a durable, citable record of
     * its own, so a failed audit must not lose it.
     */
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RegulatoryAction',
      entityId: row.id,
      afterValue: {
        kind: row.kind,
        basis: row.basis,
        effectiveFrom: row.effectiveFrom.toISOString(),
        decisionRef: row.decisionRef,
        hasDocument: row.documentId !== null,
        suspendedUntil: row.suspendedUntil?.toISOString() ?? null,
      },
    });

    // The standing AFTER the act, returned so the caller sees what it changed to rather than being
    // told "recorded" and having to go and look.
    return this.licenseGate.standing();
  }

  /**
   * The current term and the whole series.
   *
   * NO LONGER 404s when the office holds no licence. That was defensible while a licence was one
   * global row somebody had either created or not; it is wrong now, because "this office holds no
   * licence" is a real, renderable state AND the state that blocks new business. A screen that gets
   * a 404 cannot tell the reader that.
   */
  async get(): Promise<BrokerLicenseSeriesView> {
    const now = new Date();
    const terms = await this.repo.findTerms();
    const current = pickCurrentTerm(terms);
    return {
      current: current ? deriveBrokerLicenseView(current, now) : null,
      terms: terms.map((t) => deriveBrokerLicenseView(t, now)),
      /*
       * THE STANDING — the ONE answer, and the screen's replacement for the stored `status` it used
       * to render beside `isCurrentlyLapsed`.
       *
       * That pairing was the three-answer defect made visible: a two-value stored flag next to a
       * live-derived boolean, on the same row. Now the screen shows the six-state derivation that
       * the GATE enforces, so what a reader sees and what the system refuses are the same answer.
       */
      standing: await this.licenseGate.standing(now),
      /*
       * DERIVED FROM THE SAME `current` the gate decides on — `pickCurrentTerm`, the latest expiry.
       * Warning about the term covering today would tell a renewed office that its licence is
       * running out.
       *
       * And a recorded filing does NOT quieten it: the notice carries `renewalFiled` beside the
       * stage, because a filing is not a decision and what lifts the block is the new term being
       * recorded with its certificate.
       */
      renewalNotice: deriveRenewalNotice(current, now),
    };
  }

  private async appendTerm(
    dto: BrokerLicenseTermDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const issuedAt = dto.issuedAt
      ? parseCalendarDate(dto.issuedAt, 'issuedAt')
      : null;
    const expiresAt = parseCalendarDate(dto.expiresAt, 'expiresAt');

    let row: BrokerLicense;
    try {
      row = await this.repo.createTerm({
        licenseNumber: dto.licenseNumber,
        scopeOfAuthorization: dto.scopeOfAuthorization ?? null,
        issuedAt,
        expiresAt,
        certificate: {
          fileName: dto.certificateFileName,
          storageRef: dto.certificateStorageRef,
          uploadedByUserId: actorUserId,
        },
      });
    } catch (err) {
      // `@@unique([organizationId, licenseNumber, expiresAt])`. Two officers recording the same
      // term, or one clicking twice — a 409 naming the term, not an unhandled 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `This office already holds a term for license ${dto.licenseNumber} expiring ${dto.expiresAt}.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'BrokerLicense',
      entityId: row.id,
      afterValue: brokerLicenseAuditSnapshot(row),
    });
    return deriveBrokerLicenseView(row, new Date());
  }

  private async mustFindCurrentTerm(): Promise<BrokerLicense> {
    const current = pickCurrentTerm(await this.repo.findTerms());
    if (!current) {
      throw new NotFoundException(
        'This office holds no broker license term yet — record one first.',
      );
    }
    return current;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Broker-license audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
