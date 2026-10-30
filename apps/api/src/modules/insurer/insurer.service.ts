import { parseCalendarDate } from '../../common/calendar-date.util';
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
import { officeMayEditCompanyFacts } from '../../repositories/insurer-identity';
import { pageWindow, type Paginated } from '../../common/pagination';
import { PICKER_MAX_RESULTS } from '../../common/picker-search.config';
import type { SearchInsurersDto } from '../../common/picker-search.dto';
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
import { resolveInsurerNamePair } from '../../repositories/insurer-identity';

/** What the two status endpoints answer with: the record as it now stands, and what was
 *  outstanding at the moment it changed. Two named halves rather than extra keys on the
 *  view, so the view's shape stays one thing — the property its key-set test pins. */
export interface InsurerStatusChange {
  insurer: InsurerView;
  impact: InsurerStatusImpact;
}

/**
 * What the insurer picker returns. THREE fields, and the omissions are the point — see
 * `InsurerRepository.searchForPicker` for why the relationship contacts are not here.
 *
 * Both name forms, because the component translates at RENDER: returning one already-resolved name
 * would pin the label to whatever language was active when the keystroke went out, which is the bug the
 * customer picker's `DetailPart` split was built to fix.
 */
export interface InsurerPickerResult {
  id: string;
  name: string;
  nameAr: string | null;
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

  /**
   * THE INSURER PICKER. Six dashboard and report screens typed a uuid into an `insurerId` filter.
   *
   * NOT AUDITED, and the contrast with the customer search is the decision rather than an omission.
   * That one writes a row because the record of who searched for whom IS the control over a register of
   * people. An insurer is a company: its name and both language forms are already readable across
   * offices through `GET /insurer-directory`, by design, so a row recording that somebody typed three
   * letters of a company name would record a non-event and dilute what the audit log is for.
   *
   * The RELATIONSHIP half of the row never reaches this result — see the repository's own note. That is
   * what makes the widened gate safe: ten roles can now find an insurer by name, and none of them sees
   * the named people who answer this office.
   */
  async searchForPicker(
    dto: SearchInsurersDto,
  ): Promise<InsurerPickerResult[]> {
    const rows = await this.insurers.searchForPicker(
      dto.q,
      PICKER_MAX_RESULTS.insurer,
    );
    return rows.map((r) => {
      /*
       * ITEM 3 — A FOURTH IMPLEMENTATION OF THE NAME PRECEDENCE LIVED HERE, and the new inventory
       * guard found it on its first run rather than anybody reading for it. It was worse than the
       * other three in two ways:
       *
       *   - IT IGNORED THE REGISTERED COMPANY ENTIRELY, so a placement officer choosing an
       *     insurer from this picker would see the catalogue or local name while `/insurers` and
       *     every outward document showed the company's own registered name. The picker is where
       *     an insurer gets CHOSEN, so a reader comparing it against the directory would have
       *     found two names for one company.
       *   - IT COALESCED PER FIELD (`legalName ?? master.legalName`, `legalNameAr ??
       *     master.legalNameAr`), which is the exact drift `insurerIdentity` carries a paragraph
       *     against: a row whose chosen source has no Arabic name falls through to a DIFFERENT
       *     source's Arabic name, rendering one company's Latin name beside another's Arabic.
       *     Today that is unreachable — `Insurer_has_identity` means a row carries one identity —
       *     but it stopped being unreachable the moment a registered company became a third
       *     source.
       *
       * So the SOURCE is chosen once and both names are read from it, which is `insurerIdentity`'s
       * own discipline, and the Latin half goes through the one precedence so the two cannot
       * disagree.
       */
      // THE PAIR, from the one resolver. My first fix here still spelled the master branch for
      // `nameAr` — and the new inventory guard caught that too, on the same run, which is why the
      // pair has its own home rather than three call sites each choosing a source.
      const source = resolveInsurerNamePair(r);
      return { id: r.id, name: source.name, nameAr: source.nameAr };
    });
  }

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
    // DECISION 90, on the create path: `current` is null because there is no row yet.
    this.assertRatingCarriesItsDate(relationship, null);
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
        // `canonicalName` is NOT written here, and cannot be: it is a STORED GENERATED
        // column over `canonical_name_key("legalName")`. The directory groups by it and
        // `Insurer_one_local_company_per_org` enforces uniqueness on it, so one definition
        // decides both — rather than this service computing a key the database then trusts.
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
      // deliberately cannot write it: the office-side insurer codes cover the
      // office's own record, never the platform's.
      throw new UnprocessableEntityException(
        "This insurer's name comes from the shared catalogue and cannot be changed here. Only a company this office registered itself can be renamed.",
      );
    }

    /*
     * REGISTER ENTRY 36 — THE LINK IS NOW A SERVER BOUNDARY, NOT A SCREEN ONE.
     *
     * `officeMayEditCompanyFacts` was projected onto the view and read by the screen, which greyed the
     * company fields out. The server honoured a direct `PATCH` anyway, so the read-only was one layer.
     * A hidden control the API still honours is not a boundary — the rule item (j) established with
     * three layers for a PLATFORM permission (the matrix hides the code, `setPermissions` refuses it,
     * the route checks the organization type), and this had one.
     *
     * THE SAME FUNCTION THE VIEW CALLS, deliberately. A second predicate spelling the condition again
     * would be a second answer to "may this office type over a registered company's details", and the
     * copy is the one that drifts — a screen saying read-only beside a server that permits it is the
     * defect being fixed, and its mirror image is just as wrong.
     *
     * THE TOUCHED KEYS ARE DERIVED FROM `companyFrom`, NOT LISTED. A company fact added to the DTO
     * later is covered the moment it appears there, where a hand-kept list here would admit it
     * silently. The NAME is added explicitly because it is the company's own and is not a member of
     * `InsurerCompanyFields` — it has its own column.
     *
     * THE RELATIONSHIP FIELDS STAY EDITABLE, which is the point of the link rather than a concession:
     * what this office pays, which lines it places and whom it calls are facts about the OFFICE's
     * relationship, and the registered company answers for none of them.
     */
    if (!officeMayEditCompanyFacts(row)) {
      const touched = [
        ...Object.keys(this.companyFrom(dto)),
        ...(dto.legalName === undefined ? [] : ['legalName']),
        ...(dto.legalNameAr === undefined ? [] : ['legalNameAr']),
      ].sort();
      if (touched.length > 0) {
        /*
         * The refusal NAMES the fields and the way out. "Forbidden" with no field list sends somebody
         * removing one key at a time, and a 403 would be wrong twice over: the caller holds the
         * permission, and the record is theirs — what has changed is who answers for these particular
         * columns.
         */
        throw new UnprocessableEntityException(
          `This insurer's record is linked to a registered insurance company, so the company's own details are answered by that company and cannot be edited here: ${touched.join(', ')}. The office's relationship terms are still editable. To take these details back under this office's control, unlink the record first.`,
        );
      }
    }

    const patch: InsurerCompanyFields &
      InsurerRelationshipFields & {
        legalName?: string;
        legalNameAr?: string;
      } = {
      ...this.companyFrom(dto),
      ...this.relationshipFrom(dto),
      // A rename needs no recomputation: the generated column follows `legalName` in the
      // same statement, so the directory regroups and the uniqueness re-applies without
      // this service knowing the rule.
      ...(dto.legalName === undefined ? {} : { legalName: dto.legalName }),
      ...(dto.legalNameAr === undefined
        ? {}
        : { legalNameAr: dto.legalNameAr }),
    };

    /*
     * DECISION 90, on the UPDATE path, and this is the case a DTO could never get right: the rule is
     * about the row AFTER the patch. `row` is the current state, `patch` is what this body changes,
     * and the check reads the merge of the two.
     */
    this.assertRatingCarriesItsDate(patch, row);

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
   * Gated on `insurer.deactivate` rather than `insurer.read`: this exists to
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
  /**
   * DECISION 93 — CLEARS THE FINANCIAL STRENGTH RATING AND ITS AS-OF DATE IN ONE WRITE.
   *
   * ## WHY AN ACTION AND NOT A FIELD EDIT
   *
   * They are a PAIR by `Insurer_rating_carries_its_date`: clearing one alone either violates the
   * constraint or leaves a dateless rating standing. And neither can be cleared through the ordinary
   * PATCH at all — an empty string is refused by the DTO's length rule before any service rule runs,
   * and `emptyStringToUndefined` turns an empty date into "no change" rather than into a clear. That
   * gap is PRE-EXISTING, recorded in `docs/deferred-register.md`, and is NOT repaired here: the
   * general fix (an explicit null meaning clear, absent meaning no change, an empty string refused)
   * is an API-WIDE pass, and inventing it for one field would be a third way of saying "remove a
   * value" in a codebase that already has two.
   *
   * So this is the narrow exit, scoped to one pair. The DTO's length rule is untouched,
   * `emptyStringToUndefined` is untouched, and no null-means-clear convention is introduced.
   *
   * ## NO CONFIRMATION STEP, DELIBERATELY
   *
   * Clearing an optional note is undone by retyping it. The governing decision blocks what cannot be
   * undone and warns about what can; it does not warn about what one line of typing restores. A
   * confirm step here is exactly the weight decision 90 exists to remove, and the audit row — the
   * value before and the value after — is the record.
   *
   * ## A NO-OP WHEN THERE IS NOTHING TO CLEAR, which is the OPPOSITE of the unlink's 409
   *
   * The distinction is what the operator's mistake would be. Unlinking a record that is not linked
   * suggests they targeted the wrong record, which is worth surfacing. Clearing a rating that was
   * never there is harmless and idempotent — there is no wrong-record hypothesis to raise, and no
   * audit row is written because nothing changed.
   */
  async clearFinancialStrengthRating(
    id: string,
    actorUserId: string,
  ): Promise<InsurerView> {
    const row = await this.load(id);
    if (
      row.financialStrengthRating === null &&
      row.financialStrengthRatingAsOf === null
    ) {
      // Nothing to clear — a no-op rather than a 422, because "already clear" is the state the
      // caller asked for.
      //
      // THIS COMMENT HAS NOW BEEN WRONG IN BOTH DIRECTIONS, AND BOTH CORRECTIONS ARE KEPT because
      // the pair is the lesson. It first said "the screen does not offer the action in this state
      // either", describing a screen that did not exist; corrected on 2026-10-15 to say that nothing
      // in `apps/web` called this route at all, which was true then.
      //
      // IT IS BUILT NOW — owner decision 43, 2026-10-23. `/insurers/[id]` carries a single Clear
      // control, and it is rendered ONLY where there is something to clear, so the original claim is
      // true again for the first time: the screen does not offer the action in this state. What
      // keeps the no-op branch right regardless is that "already clear" is the state the caller
      // asked for, and that does not depend on any screen.
      return deriveInsurerView(row);
    }

    await this.insurers.update(id, {
      financialStrengthRating: null,
      financialStrengthRatingAsOf: null,
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: id,
      /*
       * BOTH HALVES OF WHAT WAS THERE. After the write both columns are NULL, so without `beforeValue`
       * the trail would say a rating was cleared without saying what it was — and the rating is this
       * office's record of the care it took in choosing an insurer, which is the half an auditor asks
       * about.
       */
      beforeValue: {
        financialStrengthRating: row.financialStrengthRating,
        financialStrengthRatingAsOf:
          row.financialStrengthRatingAsOf?.toISOString() ?? null,
      },
      afterValue: {
        financialStrengthRating: null,
        financialStrengthRatingAsOf: null,
      },
    });

    return deriveInsurerView(await this.load(id));
  }

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
    if (dto.financialStrengthRatingAsOf !== undefined)
      fields.financialStrengthRatingAsOf = parseCalendarDate(
        dto.financialStrengthRatingAsOf,
        'financialStrengthRatingAsOf',
      );
    if (dto.ratingAgencyId !== undefined)
      fields.ratingAgencyId = dto.ratingAgencyId;
    return fields;
  }

  /**
   * DECISION 90 — A DATABASE CONSTRAINT MUST NEVER BE THE ERROR MESSAGE.
   *
   * `Insurer_rating_carries_its_date` refuses a rating without its as-of date and a date without its
   * rating, in both directions, from `20261125110000` onward. The CHECK is the backstop and stays
   * exactly as it is; this is the form-level equivalent, and its whole job is that nobody ever meets
   * the backstop.
   *
   * Without it, an office typing a rating into `/insurers/new` — a screen that has existed since
   * long before this module — would get a raw constraint violation surfaced as a 500. That is not a
   * hypothetical: the field is on the form, the DTO accepted it, and the service wrote it.
   *
   * ## IT READS THE MERGED STATE, NOT THE BODY, AND THAT IS WHY IT IS NOT A DECORATOR
   *
   * A PATCH carrying only the rating is CORRECT on a record that already has a date and WRONG on one
   * that does not; a PATCH clearing the date is wrong on a record that has a rating. A DTO cannot see
   * the row, so a class-level `@Validate` would be right about the body and wrong about the outcome —
   * item (e)'s own lesson, which bit when `@IsOptional()` turned out to skip every validator on an
   * absent field.
   *
   * `current` is null on the create path, where the merged state is just the body.
   */
  private assertRatingCarriesItsDate(
    fields: InsurerRelationshipFields,
    current: {
      financialStrengthRating: string | null;
      financialStrengthRatingAsOf: Date | null;
    } | null,
  ): void {
    const rating =
      fields.financialStrengthRating !== undefined
        ? fields.financialStrengthRating
        : (current?.financialStrengthRating ?? null);
    const asOf =
      fields.financialStrengthRatingAsOf !== undefined
        ? fields.financialStrengthRatingAsOf
        : (current?.financialStrengthRatingAsOf ?? null);

    const hasRating = rating !== null && rating !== '';
    const hasAsOf = asOf !== null;
    if (hasRating === hasAsOf) return;

    if (hasRating) {
      throw new UnprocessableEntityException(
        'A financial strength rating must carry the date it was as at. Enter the as-of date beside the rating, or clear the rating. A rating with no date is a claim rather than a record of the care taken in choosing this insurer.',
      );
    }
    throw new UnprocessableEntityException(
      'An as-of date was given with no financial strength rating. Enter the rating beside it, or clear the date.',
    );
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
