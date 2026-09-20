import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
import {
  InsurerRepository,
  type InsurerRecord,
  type InsurerRelationshipFields,
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

    const relationship = this.relationshipFrom(dto);
    let created: InsurerRecord;
    try {
      created = await this.insurers.create({
        insurerMasterId:
          identity.path === 'MASTER' ? identity.insurerMasterId : null,
        legalName: identity.path === 'LOCAL' ? identity.legalName : null,
        legalNameAr: identity.path === 'LOCAL' ? identity.legalNameAr : null,
        relationship,
      });
    } catch (err) {
      throw this.asCollision(
        err,
        identity.path === 'LOCAL' ? 'LOCAL_NAME' : 'MASTER_LINK',
        identity.path === 'LOCAL' ? identity.legalName : '',
      );
    }

    const view = deriveInsurerView(created);
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

    const patch: InsurerRelationshipFields & {
      legalName?: string;
      legalNameAr?: string;
    } = {
      ...this.relationshipFrom(dto),
      ...(dto.legalName === undefined ? {} : { legalName: dto.legalName }),
      ...(dto.legalNameAr === undefined
        ? {}
        : { legalNameAr: dto.legalNameAr }),
    };

    const delta = auditDelta(row, patch);
    if (delta.changed.length === 0) {
      // An empty or wholly redundant body is a no-op — not an error, and not an
      // audit row. The trail records changes; "somebody pressed save" is not one.
      return deriveInsurerView(row);
    }

    let updated: InsurerRecord;
    try {
      updated = await this.insurers.update(id, patch);
    } catch (err) {
      throw this.asCollision(
        err,
        'LOCAL_NAME',
        dto.legalName ?? row.legalName ?? '',
      );
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: id,
      beforeValue: delta.before,
      afterValue: delta.after,
    });
    return deriveInsurerView(updated);
  }

  /** One of this office's insurers, or absent. See the header for why absent is a
   *  404 even when the row exists in another office. */
  private async load(id: string): Promise<InsurerRecord> {
    const row = await this.insurers.findById(id);
    if (!row) throw new NotFoundException(`Insurer ${id} not found.`);
    return row;
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
