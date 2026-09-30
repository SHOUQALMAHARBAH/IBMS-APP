import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DutySegregationMode } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Matching every other mandatory reason in this system. */
export const MODE_DECLARATION_REASON_MIN_LENGTH = 10;

export interface DutySegregationModeView {
  mode: DutySegregationMode;
  /** Null until somebody declares a mode: the office is segregated by default, not by decision. */
  declaredAt: Date | null;
  declaredByUserId: string | null;
  /** Resolved for display. A name is a lookup, never stored — the audit row is what keeps the history. */
  declaredByName: string | null;
}

@Injectable()
export class DutySegregationModeService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async get(actor: AuthenticatedUser): Promise<DutySegregationModeView> {
    const office = await this.organizations.findById(actor.organizationId);
    if (!office) throw new NotFoundException('Organization not found');

    const declaredBy = office.dutySegregationModeDeclaredByUserId
      ? await this.users.findById(office.dutySegregationModeDeclaredByUserId)
      : null;

    return {
      mode: office.dutySegregationMode,
      declaredAt: office.dutySegregationModeDeclaredAt,
      declaredByUserId: office.dutySegregationModeDeclaredByUserId,
      declaredByName: declaredBy?.fullName ?? null,
    };
  }

  /**
   * Declare the office's mode. Audited with a reason, because a regulator asking "when did this office stop
   * segregating duties, and who decided" must get an answer from the audit trail rather than from whoever
   * remembers.
   *
   * The audit row is written BEFORE the mode changes, deliberately: if the write then fails, the trail carries
   * an attempt that did not take effect, which is recoverable by reading the office. The reverse — a mode
   * changed with no audit row — is not.
   */
  async declare(
    mode: DutySegregationMode,
    reason: string,
    actor: AuthenticatedUser,
  ): Promise<DutySegregationModeView> {
    const office = await this.organizations.findById(actor.organizationId);
    if (!office) throw new NotFoundException('Organization not found');

    const trimmed = reason.trim();
    if (trimmed.length < MODE_DECLARATION_REASON_MIN_LENGTH) {
      throw new UnprocessableEntityException(
        `Changing how this office separates duties needs a reason of at least ${MODE_DECLARATION_REASON_MIN_LENGTH} characters. It is kept permanently in the audit trail and is what answers "who decided this, and when".`,
      );
    }

    // THE SHIPPING GATE IS LIFTED, and this comment is what replaces it.
    //
    // Until the commit that shipped `GET /internal-controls/combined-duty-acts`, this method refused COMBINED
    // outright: a constant, a 403 naming the missing report, and an e2e test asserting that refusal. The gate
    // existed because the owner accepted applying the mode uniformly — including to a person reviewing their
    // own access — on the stated mitigation that every such act would surface in a report, flagged at the top.
    // That report had no reader, so the mitigation was owed rather than met.
    //
    // It is met now: the report lists every declared act with its reason and the roles worn, access
    // self-reviews sort above everything else and render flagged, and `self-approval-report.e2e-spec.ts`
    // proves the ordering by content against two acts where the transaction one is NEWER. The flag, the
    // refusal and the test that asserted it were removed in the same commit that shipped the report —
    // together, or the gate would have been theatre.

    // NO idempotent short-circuit, deliberately — and the first version of this had one.
    //
    // Declaring SEGREGATED in an office that is already SEGREGATED looks like a no-op and is not: the
    // difference between "segregated because nobody ever chose" and "segregated because the administrator
    // confirmed it on this date" is exactly what the report has to show beside every act. Skipping the write
    // would have thrown away the first explicit declaration an office ever makes, which is the one most worth
    // having. The cost is that a double-click writes two audit rows, and two declarations did happen.

    await this.audit.record({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Organization',
      entityId: office.id,
      beforeValue: {
        dutySegregationMode: office.dutySegregationMode,
        declaredAt: office.dutySegregationModeDeclaredAt?.toISOString() ?? null,
      },
      afterValue: { dutySegregationMode: mode, reason: trimmed },
    });

    await this.organizations.declareDutySegregationMode(
      office.id,
      mode,
      actor.id,
    );
    return this.get(actor);
  }
}
