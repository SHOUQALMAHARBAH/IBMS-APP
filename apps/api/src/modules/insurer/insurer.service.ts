import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import {
  InsurerRepository,
  type InsurerCompanyFields,
  type InsurerRecord,
  type InsurerRelationshipFields,
  type InsurerStatusImpact,
} from '../../repositories/insurer.repository';
import { pageWindow, type Paginated } from '../../common/pagination';
import {
  auditDelta,
  collisionMessage,
  deriveInsurerView,
  resolveIdentityPath,
  type CollisionKind,
  type InsurerView,
} from './insurer.config';
import type {
  ListInsurersQueryDto,
  RegisterInsurerDto,
  UpdateInsurerDto,
} from './dto/insurer-crud.dto';

/** What the two status endpoints answer with: the record as it now stands, and what was
 *  outstanding at the moment it changed. Two named halves rather than extra keys on the
 *  view, so the view's shape stays one thing — the property its key-set test pins. */
export interface InsurerStatusChange {
  insurer: InsurerView;
  impact: InsurerStatusImpact;
}

/**
 * Insurer management — an office's own insurer records.
 *
 * The first point at which an office can actually register a company. Until this,
 * `Insurer` rows only ever arrived from the seed or a test fixture, which is why
 * the column saying whether the office still deals with one stayed inert for as
 * long as it did.
 *
 * ## The two registration paths, and why ONE endpoint serves both
 *
 * A company may already have a row in the shared global catalogue
 * (`InsurerMaster`), or it may be in no catalogue at all — a local mutual, a
 * regional carrier, a company this office is the first here to deal with. Both are
 * ordinary registrations to the administrator doing them, so both go through
 * `POST /insurers` and the body decides which it is. Whether our data happens to
 * already know the company is an implementation fact, not a decision somebody
 * should have to make by choosing a URL.
 *
 * Nothing here CREATES a catalogue row. An office registering a company writes
 * only its own row, because `InsurerMaster.legalName` is unique platform-wide and
 * an auto-created master would turn a name collision into an oracle for what other
 * offices deal with — the reasoning recorded on `Insurer.insurerMasterId` in the
 * schema.
 *
 * ## Cross-office reads are 404, never 403
 *
 * Every read goes through the tenant-scoped client, so another office's insurer id
 * matches nothing and this service reports it absent. A 403 would confirm the row
 * exists, which is the same disclosure by a different route.
 */
@Injectable()
export class InsurerService {
  constructor(
    private readonly insurers: InsurerRepository,
    private readonly masters: InsurerMasterRepository,
    private readonly lines: InsuranceLineRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListInsurersQueryDto): Promise<Paginated<InsurerView>> {
    const filter = { isActive: query.isActive, search: query.search };
    const window = pageWindow(query.page, query.pageSize);
    // Both halves read the SAME filter. A count over a different predicate than
    // the page is how a list reports a total it cannot deliver.
    const [rows, total] = await Promise.all([
      this.insurers.findManyForOffice(filter, window),
      this.insurers.countForOffice(filter),
    ]);
    return {
      items: rows.map(deriveInsurerView),
      total,
      page: window.page,
      pageSize: window.pageSize,
    };
  }

  async get(id: string): Promise<InsurerView> {
    return deriveInsurerView(await this.load(id));
  }

  async register(
    dto: RegisterInsurerDto,
    actorUserId: string,
  ): Promise<InsurerView> {
    const identity = resolveIdentityPath(dto);
    if ('error' in identity) {
      throw new UnprocessableEntityException(identity.error);
    }

    if (identity.path === 'MASTER') {
      // Checked here rather than left to the foreign key, which would surface as a
      // P2003 and a 500. The catalogue is global, so its ids are nobody's secret
      // and refusing an unknown one discloses nothing about any office.
      const master = await this.masters.findMaster(identity.insurerMasterId);
      if (!master) {
        throw new UnprocessableEntityException(
          'That company is not in the shared catalogue. Register it with legalName and legalNameAr instead.',
        );
      }
    }

    const company = this.companyFrom(dto);
    const relationship = this.relationshipFrom(dto);
    // Resolved BEFORE the insurer is written: an unknown line id is a 422 about the
    // body, and discovering it after the insert would leave a registered company with
    // a half-applied product list and no way for the caller to tell.
    const resolvedLines = await this.resolveLineIds(dto.lineIds);
    let created: InsurerRecord;
    try {
      created = await this.insurers.create({
        insurerMasterId:
          identity.path === 'MASTER' ? identity.insurerMasterId : null,
        legalName: identity.path === 'LOCAL' ? identity.legalName : null,
        legalNameAr: identity.path === 'LOCAL' ? identity.legalNameAr : null,
        company,
        relationship,
      });
    } catch (err) {
      throw this.asCollision(
        err,
        identity.path === 'LOCAL' ? 'LOCAL_NAME' : 'MASTER_LINK',
        identity.path === 'LOCAL' ? identity.legalName : '',
      );
    }

    if (resolvedLines) {
      await this.insurers.replaceOfferedLines(created.id, resolvedLines);
    }
    // Re-read, because the row returned by the insert predates the line rows. The
    // alternative — assembling the view from the ids just written — would mean two
    // code paths producing one shape, which is how they drift.
    const withLines = resolvedLines
      ? ((await this.insurers.findById(created.id)) ?? created)
      : created;

    const view = deriveInsurerView(withLines);
    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Insurer',
      entityId: created.id,
      afterValue: {
        // Which path, explicitly: a reader of the trail should not have to infer
        // from a null whether this office named the company or linked it.
        registrationPath: identity.path,
        insurerMasterId: created.insurerMasterId,
        legalName: created.legalName,
        legalNameAr: created.legalNameAr,
        name: view.name,
        // The line CODES, not their ids: an id means nothing in another database, and
        // the audit trail is read by people reconstructing what an office decided.
        linesOffered: view.linesOffered.map((l) => l.code ?? l.nameEn),
        ...company,
        ...relationship,
      },
    });
    return view;
  }

  async update(
    id: string,
    dto: UpdateInsurerDto,
    actorUserId: string,
  ): Promise<InsurerView> {
    const row = await this.load(id);

    const renames =
      dto.legalName !== undefined || dto.legalNameAr !== undefined;
    if (renames && row.insurerMasterId !== null) {
      // The company's name belongs to the shared catalogue, and this endpoint
      // deliberately cannot write it: `insurer.relationship.manage` covers the
      // office's own record, never the platform's.
      throw new UnprocessableEntityException(
        "This insurer's name comes from the shared catalogue and cannot be changed here. Only a company this office registered itself can be renamed.",
      );
    }

    const patch: InsurerCompanyFields &
      InsurerRelationshipFields & {
        legalName?: string;
        legalNameAr?: string;
      } = {
      ...this.companyFrom(dto),
      ...this.relationshipFrom(dto),
      ...(dto.legalName === undefined ? {} : { legalName: dto.legalName }),
      ...(dto.legalNameAr === undefined
        ? {}
        : { legalNameAr: dto.legalNameAr }),
    };

    const resolvedLines = await this.resolveLineIds(dto.lineIds);
    const delta = auditDelta(row, patch);
    if (delta.changed.length === 0 && !resolvedLines) {
      // An empty or wholly redundant body is a no-op — not an error, and not an
      // audit row. The trail records changes; "somebody pressed save" is not one.
      return deriveInsurerView(row);
    }

    let updated: InsurerRecord = row;
    try {
      if (delta.changed.length > 0) {
        updated = await this.insurers.update(id, patch);
      }
    } catch (err) {
      throw this.asCollision(
        err,
        'LOCAL_NAME',
        dto.legalName ?? row.legalName ?? '',
      );
    }

    if (resolvedLines) {
      await this.insurers.replaceOfferedLines(id, resolvedLines);
      updated = (await this.insurers.findById(id)) ?? updated;
    }

    const before = deriveInsurerView(row);
    const after = deriveInsurerView(updated);
    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: id,
      beforeValue: {
        ...delta.before,
        ...(resolvedLines
          ? { linesOffered: before.linesOffered.map((l) => l.code ?? l.nameEn) }
          : {}),
      },
      afterValue: {
        ...delta.after,
        ...(resolvedLines
          ? { linesOffered: after.linesOffered.map((l) => l.code ?? l.nameEn) }
          : {}),
      },
    });
    return after;
  }

  /**
   * What is outstanding with this insurer RIGHT NOW, without changing anything.
   *
   * The confirmation an administrator sees before pressing deactivate. Same method, same
   * two named status sets, same four other counts as the audit row the act writes — one
   * meaning read from two call sites, rather than a screen figure and a record figure
   * that can drift apart. If the preview and the trail ever disagreed, nobody could tell
   * which was right.
   *
   * Gated on `insurer.relationship.manage` rather than `insurer.read`: this exists to
   * inform a decision, and only somebody who can take that decision needs it.
   */
  async statusImpact(id: string): Promise<InsurerStatusImpact> {
    await this.load(id);
    return this.insurers.countStatusImpact(id);
  }

  /**
   * Stops the office dealing with this insurer — ALLOW AND RECORD.
   *
   * Nothing about an existing obligation changes, and nothing here refuses on account
   * of one. An office that has stopped dealing with a company still owes what it owes:
   * in-force policies stay in force, claims keep running, invoices keep their schedule,
   * and a quotation that arrives late can still be captured. What stops is NEW use —
   * the RFQ picker will not offer them, an existing RFQ will not take them, and a
   * placement against their quotation is refused. Those three guards were built with
   * the column; this is the act that sets it.
   *
   * So the impact counts are a RECORD, not a gate. Refusing the deactivation would not
   * settle a single invoice; what an administrator needs is for the decision to be
   * attributable, reasoned, and accompanied by what was outstanding when it was made.
   *
   * Counted BEFORE the write and with no transaction around the pair, deliberately. A
   * count taken after the flip would answer a question nobody asked, and wrapping both
   * in one transaction would buy nothing: these figures are about other aggregates that
   * go on moving regardless, so the honest claim is "as at the moment of the change",
   * which is what a pre-write read gives.
   */
  async deactivate(
    id: string,
    reason: string,
    actorUserId: string,
  ): Promise<InsurerStatusChange> {
    return this.setStatus(id, false, reason, actorUserId);
  }

  /** Puts the insurer back in play. The impact counts come back here too — after a
   *  spell of being deactivated, what is still open with this company is exactly what
   *  somebody reactivating them wants to see. */
  async reactivate(
    id: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<InsurerStatusChange> {
    return this.setStatus(id, true, reason, actorUserId);
  }

  private async setStatus(
    id: string,
    isActive: boolean,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<InsurerStatusChange> {
    const row = await this.load(id);
    const impact = await this.insurers.countStatusImpact(id);

    if (row.isActive === isActive) {
      // Already in this state: the current record and the live counts, and NO audit
      // row. The trail records changes — pressing deactivate twice is one decision,
      // and a second entry claiming otherwise would be false.
      return { insurer: deriveInsurerView(row), impact };
    }

    const updated = await this.insurers.setActive(id, isActive);
    await this.audit.record({
      userId: actorUserId,
      // UPDATE, not a new action value. Deactivation is a field on this record
      // changing; inventing `DEACTIVATE` would make every existing audit reader
      // choose between two vocabularies for one idea.
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: id,
      beforeValue: { isActive: row.isActive },
      afterValue: {
        isActive,
        reason: reason ?? null,
        // The counts, inline rather than nested, so a reader scanning the trail sees
        // what was outstanding without having to know this shape.
        ...impact,
      },
    });
    return { insurer: deriveInsurerView(updated), impact };
  }

  /** One of this office's insurers, or absent. See the header for why absent is a
   *  404 even when the row exists in another office. */
  private async load(id: string): Promise<InsurerRecord> {
    const row = await this.insurers.findById(id);
    if (!row) throw new NotFoundException(`Insurer ${id} not found.`);
    return row;
  }

  /**
   * Splits a mixed array of line ids into the two tables they belong to, refusing any
   * it cannot place.
   *
   * ONE array on the wire, because whether a line came from the standard 32 or from
   * this office's own additions is our data model, not a distinction the person
   * picking should have to make. Resolving it costs two bounded reads.
   *
   * `undefined` means "leave the set alone" and returns null; an EMPTY array means
   * "clear it" and returns empty lists — the distinction a PATCH needs, and the
   * reason this cannot collapse into a falsiness check.
   *
   * An unknown id is a 422 naming the ids, not a silent drop. Another office's
   * addition lands here too: its id is invisible through the tenant-scoped read, so it
   * is reported unknown rather than refused — which tells the caller nothing about
   * whether it exists elsewhere.
   */
  private async resolveLineIds(
    lineIds: string[] | undefined,
  ): Promise<{ standardIds: string[]; officeIds: string[] } | null> {
    if (lineIds === undefined) return null;
    const unique = [...new Set(lineIds)];
    if (unique.length === 0) return { standardIds: [], officeIds: [] };

    const [standard, office] = await Promise.all([
      this.lines.findStandardByIds(unique),
      this.lines.findOfficeByIds(unique),
    ]);
    const standardIds = new Set(standard.map((l) => l.id));
    const officeIds = new Set(office.map((l) => l.id));
    const unknown = unique.filter(
      (id) => !standardIds.has(id) && !officeIds.has(id),
    );
    if (unknown.length > 0) {
      throw new UnprocessableEntityException(
        `These insurance line ids do not exist: ${unknown.join(', ')}. Pick from GET /insurance-lines, or add the type first.`,
      );
    }
    return {
      // Filtered from the ORIGINAL list so the two sets partition it: a uuid present
      // in both tables would otherwise be written twice and hit the CHECK.
      standardIds: unique.filter((id) => standardIds.has(id)),
      officeIds: unique.filter(
        (id) => officeIds.has(id) && !standardIds.has(id),
      ),
    };
  }

  /**
   * The COMPANY-level fields the caller actually sent.
   *
   * A separate method from `relationshipFrom` rather than one that returns
   * everything, for the same reason the two interfaces are separate: these four
   * cross an office boundary in the directory and the others must not, so a field
   * added to the wrong extractor is a disclosure rather than a typo. Two functions
   * means the mistake has to be made twice.
   */
  private companyFrom(
    dto: RegisterInsurerDto | UpdateInsurerDto,
  ): InsurerCompanyFields {
    const fields: InsurerCompanyFields = {};
    if (dto.companyPhone !== undefined) fields.companyPhone = dto.companyPhone;
    if (dto.companyEmail !== undefined) fields.companyEmail = dto.companyEmail;
    if (dto.companyWebsite !== undefined)
      fields.companyWebsite = dto.companyWebsite;
    if (dto.companyCorrespondenceAddress !== undefined)
      fields.companyCorrespondenceAddress = dto.companyCorrespondenceAddress;
    if (dto.structure !== undefined) fields.structure = dto.structure;
    return fields;
  }

  /**
   * The relationship fields the caller actually sent.
   *
   * Keyed on PRESENCE, not truthiness: an absent key leaves the stored value
   * alone, which is what a PATCH of one field has to mean. There is deliberately no
   * way to CLEAR a contact yet — the DTOs refuse an empty string and JSON null —
   * because clearing is a real need that deserves one answer for the whole contact
   * set rather than a per-field convention invented here.
   */
  private relationshipFrom(
    dto: RegisterInsurerDto | UpdateInsurerDto,
  ): InsurerRelationshipFields {
    const fields: InsurerRelationshipFields = {};
    if (dto.rfqContactName !== undefined)
      fields.rfqContactName = dto.rfqContactName;
    if (dto.rfqContactEmail !== undefined)
      fields.rfqContactEmail = dto.rfqContactEmail;
    if (dto.rfqContactPhone !== undefined)
      fields.rfqContactPhone = dto.rfqContactPhone;
    if (dto.claimsContactName !== undefined)
      fields.claimsContactName = dto.claimsContactName;
    if (dto.claimsContactEmail !== undefined)
      fields.claimsContactEmail = dto.claimsContactEmail;
    if (dto.underwriterContact !== undefined)
      fields.underwriterContact = dto.underwriterContact;
    if (dto.creditTermsDays !== undefined)
      fields.creditTermsDays = dto.creditTermsDays;
    if (dto.financialStrengthRating !== undefined)
      fields.financialStrengthRating = dto.financialStrengthRating;
    return fields;
  }

  /**
   * Turns a unique-constraint violation into the 409 it is.
   *
   * The DATABASE decides, not a preceding read: two administrators registering the
   * same company in the same moment both pass any check-then-act
   * (`ibms-brain/meta/lex/race-safe-invariants.md`), and only the unique index
   * refuses the second.
   *
   * ## The KIND comes from the write path, not from the error
   *
   * The first version of this read `err.meta.target` to decide which constraint had
   * fired. It could never work, and the e2e is what showed it: Prisma 6.19.3 reports
   * `meta: { modelName: 'Insurer', target: null }` with the message "Unique
   * constraint failed on the (not available)" for BOTH of these — the partial index
   * (created in raw SQL, so Prisma has no model for it) and the schema-declared
   * `@@unique([organizationId, insurerMasterId])` alike. Every collision was a 500.
   *
   * The write path is a sounder discriminator anyway, because it is exhaustive by
   * construction rather than by string matching. `Insurer` carries exactly three
   * unique constraints, and only ONE of them can fire on a given write:
   *
   *  - a LOCAL registration or a rename writes `legalName` with a NULL master, so
   *    only `Insurer_one_local_name_per_org` applies — and it cannot trip the
   *    master-link unique, because Postgres treats NULLs as distinct;
   *  - a MASTER registration leaves `legalName` NULL, which is outside the partial
   *    index's `WHERE` clause, so only the master-link unique applies;
   *  - the primary key is a generated uuid.
   *
   * That exhaustiveness is what makes this safe, so it is pinned:
   * `insurer-schema-constraints.e2e-spec.ts` asserts the full inventory of unique
   * constraints on the table, and a fourth one breaks that test rather than quietly
   * producing a message about the wrong constraint.
   */
  private asCollision(
    err: unknown,
    kind: CollisionKind,
    name: string,
  ): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(collisionMessage(kind, name));
    }
    return err;
  }
}
