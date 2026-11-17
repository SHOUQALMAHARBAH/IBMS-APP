import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
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
import { LegalValueService } from './legal-value.service';
import { UserRepository } from '../../repositories/user.repository';
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
/**
 * 🔴 OWNER DECISION 133 — THE RATIFIED DECLARATION SENTENCE, SLICED AND NEVER RETYPED.
 *
 * «إقرار المدير (مرة لكل فترة ترخيص)» in her own strings table. Stored verbatim on every
 * declaration, because the hardening `DeclaredAct` already carries (module-1 paper §٨, OWNER
 * DECISION 126) is that the record testifies to what the person was SHOWN — a foreign key to a
 * dictionary that can be edited would destroy exactly that.
 *
 * `license-renewal.spec.ts` re-slices it from `docs/decision-133-strings-ratified.md` and compares
 * byte for byte, so one word changed here fails by name.
 */
export const RENEWAL_DECLARATION_SENTENCE_AR =
  'أُقرّ بأنه لم يصل المكتبَ من البنك المركزي رفضٌ لطلب التجديد ولا إشعارُ نقص.';

/** The code the declaration is made under. Recorded ON the row — decision 127's rule that
 *  authorisation resolves from a permission and never from a role name. */
export const RENEWAL_DECLARATION_PERMISSION = 'license-renewal.declare';

@Injectable()
export class BrokerLicenseService {
  private readonly logger = new Logger(BrokerLicenseService.name);

  constructor(
    private readonly repo: BrokerLicenseRepository,
    private readonly audit: AuditService,
    private readonly acts: RegulatoryActionRepository,
    private readonly licenseGate: LicenseGateService,
    /** OWNER DECISION 123 — art. 11's filing span is a `LegalValue` row. */
    private readonly legalValues: LegalValueService,
    /** OWNER DECISION 48 — the name AS IT STANDS on a declaration, through
     *  `displayNameForUserId` and never `User.fullName`. */
    private readonly users: UserRepository,
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

    /*
     * 🔴 OWNER DECISION 128 — THE PROOF AND ITS REFERENCE TRAVEL TOGETHER, OR NEITHER DOES.
     *
     * Decision 128 §3 asks for the file, the filing date and the Central Bank's number as ONE act.
     * Half of it proves nothing: a document nobody can cite is not evidence an inspector can
     * follow, and a number with no document behind it is the very "a date in a field" this
     * decision exists to stop being sufficient.
     *
     * Refused HERE as well as by a CHECK constraint, deliberately: the CHECK is what makes the
     * state unreachable, and this is what makes the refusal legible to the person who typed it.
     */
    const proofDocumentId = dto.proofDocumentId;
    const referenceNumber = dto.referenceNumber;
    if ((proofDocumentId === undefined) !== (referenceNumber === undefined)) {
      throw new UnprocessableEntityException(
        'A filing proof needs BOTH the document and the Central Bank reference number ' +
          '(art. 11 / owner decision 128): one without the other is not evidence of a filing.',
      );
    }
    const proof =
      proofDocumentId !== undefined && referenceNumber !== undefined
        ? { documentId: proofDocumentId, referenceNumber }
        : undefined;

    const res = await this.repo.recordRenewalRequest(
      current.id,
      requestedAt,
      proof,
    );
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
    const now = new Date();
    return deriveBrokerLicenseView(
      after,
      now,
      await this.legalValues.licenceFigures(now),
    );
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
      /*
       * ART. 21/b/5 — the scope lines are created IN THE SAME STATEMENT as the act.
       *
       * Nested, not a second write, and that is the invariant rather than a style choice: zero
       * scope lines MEANS the whole licence, so an act that committed and then failed to write its
       * lines would be a motor-only suspension recorded as an office-wide one — the widening
       * direction, blocking lawful business in every other branch. One statement, so the act and
       * its limit arrive together or neither does.
       */
      scopeLines: {
        create: [
          ...(dto.scopeInsuranceLineIds ?? []).map((insuranceLineId) => ({
            organizationId: actor.organizationId,
            insuranceLineId,
          })),
          ...(dto.scopeOfficeInsuranceLineIds ?? []).map(
            (officeInsuranceLineId) => ({
              organizationId: actor.organizationId,
              officeInsuranceLineId,
            }),
          ),
        ],
      },
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
    // ONE read of art. 11's figure for the whole series, at the same instant the views are
    // derived at — two terms on one screen must not be judged against two figures any more than
    // against two clocks.
    const figures = await this.legalValues.licenceFigures(now);
    return {
      current: current ? deriveBrokerLicenseView(current, now, figures) : null,
      terms: terms.map((t) => deriveBrokerLicenseView(t, now, figures)),
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
      renewalNotice: deriveRenewalNotice(current, now, figures),
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
    const asAt = new Date();
    return deriveBrokerLicenseView(
      row,
      asAt,
      await this.legalValues.licenceFigures(asAt),
    );
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

  /**
   * 🔴 OWNER DECISION 128 — THE STANDING DECLARATION. Made ONCE for a term, by a holder of
   * `license-renewal.declare`, in the ratified sentence.
   *
   * ## WHAT IT IS NOT
   *
   * It is not a tick and it is not an excuse. Nothing is being declared about a breach: the office
   * states that no refusal and no deficiency notice has arrived from the Central Bank. That is why
   * it is not a `DeclaredAct` row — see `LicenseRenewalDeclaration`'s model comment for the four
   * measured reasons its CHECKs refuse this record.
   *
   * ## THE SENTENCE COMES FROM HERE, NEVER FROM THE CALLER
   *
   * Same rule as `declared-act.config.ts`'s article texts: a caller that could pass its own
   * wording could record a sentence nobody was shown. The constant is SLICED byte-for-byte from
   * decision 133 and `license-renewal.spec.ts` re-slices it.
   *
   * ## ONE PER TERM, ENFORCED BY THE DATABASE
   *
   * `@unique` on `brokerLicenseId`, so a second attempt raises P2002 and becomes a 409. ⛔ Not a
   * read-then-write — that is `race-safe-invariants.md`'s subject exactly, and two administrators
   * declaring at once would both pass the read.
   */
  async declareRenewalStanding(
    /** Only the id is read. The PERMISSION is recorded as a constant, because the route's own
     *  guard is what proved it — re-reading the caller's set here would be a second answer. */
    actor: { id: string },
    networkAddress: string | null,
  ): Promise<{ declaredAt: Date; actorNameShown: string }> {
    const current = await this.mustFindCurrentTerm();

    /*
     * THE NAME THROUGH `displayNameForUserId`, NEVER `User.fullName` — OWNER DECISION 48.
     *
     * `Employee.fullName` is composed from the four Jordanian name parts and is the real identity;
     * `User.fullName` is free text and only the fallback for an account with no HR record. In the
     * demo data all sixteen linked accounts disagree, the user row holding an English ROLE LABEL.
     * This is a register of who swore the regulator had sent nothing, so a role label here would
     * be a record naming nobody.
     */
    const actorNameShown =
      (await this.users.displayNameForUserId(actor.id)) ?? actor.id;

    try {
      const row = await this.repo.createRenewalDeclaration({
        brokerLicenseId: current.id,
        declarationTextShown: RENEWAL_DECLARATION_SENTENCE_AR,
        permissionCode: RENEWAL_DECLARATION_PERMISSION,
        actorUserId: actor.id,
        actorNameShown,
        networkAddress,
      });
      await this.safeAudit({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'LicenseRenewalDeclaration',
        entityId: row.id,
        afterValue: {
          brokerLicenseId: current.id,
          actorNameShown,
          // ⛔ The sentence is NOT repeated into the audit row. It is already stored verbatim on
          // the record itself, which is append-only; a second copy in a second table is a second
          // thing to disagree.
          declaredAt: row.declaredAt.toISOString(),
        },
      });
      return { declaredAt: row.declaredAt, actorNameShown };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A renewal declaration is already recorded for the current licence term. It is made ' +
            'once per term and cannot be replaced — the record is append-only.',
        );
      }
      throw err;
    }
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
