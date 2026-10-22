import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConflictOfInterestRegisterRepository } from '../../repositories/conflict-of-interest-register.repository';
import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';
import { UserRepository } from '../../repositories/user.repository';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface ConflictOfInterestRegisterEntryView {
  id: string;
  /** The person who declared it — who is also its subject. */
  declaredByUserId: string;
  declaredByName: string;
  disclosure: string;
  declaredAt: Date;
}

/**
 * THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER — decision 36, the owner's answer to *to whom is a
 * conflict disclosed*.
 *
 * ## A PERSON RECORDS THEIR OWN CONFLICT. THERE IS NO DETECTION AND NO TRIGGER
 *
 * Which is why DECLARING IS NOT A PERMISSION: the discloser is the SUBJECT. That is the same
 * reasoning that leaves `AccessRecertificationItem`'s maker permission empty — no permission exists
 * for it or can — and it matters more here than there, because a permission to declare your own
 * conflict is one an office could withhold, and withholding it would leave the person who HAS the
 * conflict as the one person unable to say so.
 *
 * READING the register is `conflict-of-interest.register.read`, granted by the office to whoever it
 * chooses. Its seeded holder is a TEMPLATE DEFAULT and not a lock (decision 80).
 *
 * ## THIS IS NOT `ConflictOfInterestDisclosure`
 *
 * That model — live, in the recommendation module — is one row per RECOMMENDATION, written when a
 * commission heuristic FLAGS one, and acknowledged by somebody who must DIFFER from the officer who
 * drafted it. Measured before this was built, because reaching for a near neighbour is how
 * `refund.raise` came to be recorded as a maker code that reads no route. The two are opposite on
 * all three axes that matter: subject, origin, and who the actor must be.
 *
 * ## NO SECOND ACTOR, AND NO REVIEW STEP
 *
 * Nothing here is approved, countersigned or cleared. Adding a reviewer would make this the
 * per-recommendation model above rather than a register — and the register's purpose is that the
 * office KNOWS, not that somebody signed off.
 */
@Injectable()
export class ConflictOfInterestRegisterService {
  constructor(
    private readonly entries: ConflictOfInterestRegisterRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async declare(
    disclosure: string,
    actor: AuthenticatedUser,
  ): Promise<ConflictOfInterestRegisterEntryView> {
    const trimmed = disclosure.trim();
    if (trimmed.length < DECLARATION_REASON_MIN_LENGTH) {
      throw new UnprocessableEntityException(
        `A disclosure must be at least ${DECLARATION_REASON_MIN_LENGTH} characters. It is kept permanently and is what answers "what was this office told, and when" — a word does not answer it.`,
      );
    }

    const row = await this.entries.create({
      declaredByUserId: actor.id,
      disclosure: trimmed,
    });

    // AFTER the write here, and that is the opposite of the designation service's order on purpose.
    // There the audit row precedes the change because a changed designation with no trail is
    // unrecoverable. Here the ENTRY IS ITSELF the permanent record — immutable by trigger — so an
    // audit row written first for an entry that then failed to insert would assert a disclosure
    // nobody made.
    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'ConflictOfInterestRegisterEntry',
      entityId: row.id,
      afterValue: { disclosure: trimmed },
    });

    // A NAME IS A LOOKUP, never stored — `DutySegregationModeService`'s own rule, and the session
    // carries no name: `AuthenticatedUser` has an id, an email and role ids, measured. Falling back
    // to the email rather than to the id, because an email identifies a colleague and a uuid does
    // not, which is the identifier-where-a-name-exists fault one screen away.
    const declaredBy = await this.users.findById(actor.id);
    return {
      id: row.id,
      declaredByUserId: row.declaredByUserId,
      declaredByName: declaredBy?.fullName ?? actor.email,
      disclosure: row.disclosure,
      declaredAt: row.declaredAt,
    };
  }

  /**
   * The office's register. READING IT IS AUDITED, because who read the office's conflict register is
   * itself worth recording — the `GET /internal-controls/combined-duty-acts` precedent — and the row
   * carries the COUNT rather than the contents, so that a read does not copy what is being searched
   * into the log.
   */
  async list(
    actor: AuthenticatedUser,
  ): Promise<ConflictOfInterestRegisterEntryView[]> {
    const rows = await this.entries.listForOrganization();

    await this.audit.record({
      userId: actor.id,
      action: 'READ',
      entityType: 'ConflictOfInterestRegisterEntry',
      entityId: actor.organizationId,
      afterValue: { entryCount: rows.length },
    });

    return rows.map((row) => ({
      id: row.id,
      declaredByUserId: row.declaredByUserId,
      declaredByName: row.declaredBy.fullName,
      disclosure: row.disclosure,
      declaredAt: row.declaredAt,
    }));
  }
}
