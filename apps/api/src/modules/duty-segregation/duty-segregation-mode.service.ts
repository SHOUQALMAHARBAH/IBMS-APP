import {
  ForbiddenException,
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

/**
 * THE SHIPPING GATE, AS CODE RATHER THAN A PROMISE.
 *
 * `docs/duty-segregation-mode.md` states it at the top: COMBINED mode may not ship before the self-approval
 * report exists and works. The reason is a commitment — the owner accepted uniform application, including a
 * person reviewing their own access, on the stated mitigation that every such act would surface in that
 * report, flagged. That mitigation was offered against a report which, measured, had no reader.
 *
 * A gate written only in a document is a gate somebody ships past. So while this is `false`, declaring
 * COMBINED is refused by the service with a message naming the reason. The flag and its refusal are deleted
 * in the same commit that ships the report — together, or the gate was theatre.
 */
export const SELF_APPROVAL_REPORT_EXISTS = false;

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

    if (mode === 'COMBINED' && !SELF_APPROVAL_REPORT_EXISTS) {
      // The gate. Not a validation error and not a permission problem — the control this mode relies on does
      // not exist yet, so the mode cannot be declared.
      throw new ForbiddenException(
        'COMBINED mode cannot be declared yet: the self-approval report it depends on does not exist. Every combined-duty act has to be visible to whoever reviews this office, and until that report can be opened there is nowhere for those acts to surface. See docs/duty-segregation-mode.md.',
      );
    }

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
