import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  combinedAssignmentPerson,
  combinedDeclarationRequired,
  resolveCombinedDeclaration,
  type CombinedDeclaration,
} from './dpo-designation.config';

export interface DpoDesignationView {
  /** Who this office has assigned as its data protection officer, or null if nobody is recorded. */
  dataProtectionOfficerName: string | null;
  /**
   * The office-manager designation, read-only here: it is part of what the PROVIDER filed at
   * registration and there is no office-facing write path for it. Returned because the screen's
   * whole subject is whether the two name one person, and a screen that cannot show the other half
   * of a comparison cannot explain its own notice.
   */
  generalManagerName: string | null;
  /** The two designations name one person. */
  combinedWithManager: boolean;
  /**
   * The office is being asked, for THIS person. False once acknowledged, and true again if both
   * assignments later move to somebody else.
   */
  declarationRequired: boolean;
  /** The acknowledgement already on record, if any. */
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  /** Resolved for display. A name is a lookup; the audit row is what keeps the history. */
  acknowledgedByName: string | null;
  /** The sentence the office was shown, stored verbatim — never re-derived at read time. */
  noticeShown: string | null;
}

/**
 * MODULE 0-ب — the data-protection-officer designation, and the acknowledgement when one person
 * holds both it and the office-manager assignment.
 *
 * ## WHY THIS LIVES IN THE DUTY-SEGREGATION MODULE
 *
 * The module's subject is already *may one person perform both halves of a thing, and what must be
 * recorded when they do*. This is that question one level up: not two halves of one approval, but
 * two assignments in one office. Putting it beside `DutySegregationModeService` keeps one answer to
 * one question; a second module would be a second place somebody reads the office's posture from.
 *
 * ## THE WRITE IS GATED ON `duty-segregation.mode.declare`, AND NO CODE WAS MINTED
 *
 * Measured against the seeded grid: that code is held by `OFFICE_ADMINISTRATOR` alone. Recording a
 * designation is the same administrative act as declaring the mode, by the same person, on the same
 * screen — and the omissions behind that code are the design rather than an accident: COMPLIANCE,
 * EXECUTIVE_MANAGEMENT and EXTERNAL_AUDITOR hold `internal-controls.view`, so whoever DECLARES is
 * not whoever REVIEWS.
 *
 * Reusing it widens what the code does, which is a decision rather than a tidy-up, so it is
 * reported. The alternative was minting a code to make one field writable, which the owner's
 * standing instruction refuses.
 *
 * ## THE AUDIT ROW CARRIES THE SENTENCE, NEVER THE WORD
 *
 * Decision 28's rule. A row saying *acknowledged* records that a box was ticked; a row carrying the
 * sentence records what the office was told. Asserted in both directions, because an absence is the
 * only form of that which can fail.
 */
@Injectable()
export class DpoDesignationService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async get(actor: AuthenticatedUser): Promise<DpoDesignationView> {
    const office = await this.organizations.findById(actor.organizationId);
    if (!office) throw new NotFoundException('Organization not found');

    // Owner decision 48 — the HR record's name where the account is linked, same resolver. This
    // register records who acknowledged a legal notice about combining the DPO and manager roles,
    // so a job title in that column answers the question with nobody.
    const acknowledgedByName = await this.users.displayNameForUserId(
      office.dpoManagerCombinedAcknowledgedByUserId,
    );

    return {
      dataProtectionOfficerName: office.dataProtectionOfficerName,
      generalManagerName: office.generalManagerName,
      combinedWithManager: combinedAssignmentPerson(office) !== null,
      declarationRequired: combinedDeclarationRequired({
        generalManagerName: office.generalManagerName,
        dataProtectionOfficerName: office.dataProtectionOfficerName,
        acknowledgedPerson: office.dpoManagerCombinedAcknowledgedPerson,
      }),
      acknowledgedAt: office.dpoManagerCombinedAcknowledgedAt,
      acknowledgedByUserId: office.dpoManagerCombinedAcknowledgedByUserId,
      acknowledgedByName,
      noticeShown: office.dpoManagerCombinedNoticeShown,
    };
  }

  /**
   * Record the designation. The arrangement is never refused; what the 422 refuses is a MISSING
   * ACKNOWLEDGEMENT, and `resolveCombinedDeclaration` is the only place that decides.
   *
   * The declaration is resolved against the name being SAVED — not the one on the row — because the
   * question is about the pair the office is creating. Resolving it against the stored name would
   * ask about the previous assignment, which is the wrong person.
   */
  async record(
    dataProtectionOfficerName: string | null,
    declaration: CombinedDeclaration | undefined,
    actor: AuthenticatedUser,
  ): Promise<DpoDesignationView> {
    const office = await this.organizations.findById(actor.organizationId);
    if (!office) throw new NotFoundException('Organization not found');

    const trimmed = dataProtectionOfficerName?.trim() ?? '';
    const name = trimmed === '' ? null : trimmed;

    const toStore = resolveCombinedDeclaration(
      {
        generalManagerName: office.generalManagerName,
        dataProtectionOfficerName: name,
        acknowledgedPerson: office.dpoManagerCombinedAcknowledgedPerson,
      },
      declaration,
    );

    // WRITTEN BEFORE THE CHANGE, deliberately, on the sibling service's own reasoning: if the write
    // then fails, the trail carries an attempt that did not take effect and the office can be read
    // back to establish that. The reverse — a designation changed with no audit row — is not
    // recoverable.
    //
    // THE SNAPSHOT CARRIES THE SENTENCE AND NEVER THE WORD `acknowledged`. The field names on the
    // row contain it; these keys deliberately do not, because the snapshot is what a reader sees.
    await this.audit.record({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Organization',
      entityId: office.id,
      beforeValue: {
        dataProtectionOfficerName: office.dataProtectionOfficerName,
      },
      afterValue: {
        dataProtectionOfficerName: name,
        ...(toStore ? { combinedAssignmentNotice: toStore.noticeShown } : {}),
      },
    });

    await this.organizations.recordDpoDesignation(
      office.id,
      name,
      toStore,
      actor.id,
    );
    return this.get(actor);
  }
}
