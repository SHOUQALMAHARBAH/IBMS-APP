import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { BranchRepository } from '../../../repositories/branch.repository';
import { PICKER_MAX_RESULTS } from '../../../common/picker-search.config';
import type { SearchBranchesDto } from '../../../common/picker-search.dto';
import { DepartmentRepository } from '../../../repositories/department.repository';
import type {
  CreateOrgUnitDto,
  RenameOrgUnitDto,
} from '../dto/org-structure.dto';

export interface OrgUnitView {
  id: string;
  name: string;
  nameAr: string | null;
  /**
   * When this unit was retired, or null while it is live.
   *
   * Added with the reactivate route, because without it the route is unreachable: the admin read
   * filtered retired units out, so a retired unit was invisible on the only screen that could bring
   * it back, and a screen that CAN see them must be able to tell them apart. A count would not do —
   * a reader deciding whether to reactivate wants to know when it was retired.
   */
  retiredAt: string | null;
}

/**
 * What the branch picker returns. Both name forms, so the component can translate at RENDER rather
 * than at fetch — the bug the customer picker's `DetailPart` split was built to fix.
 */
export interface OrgUnitPickerResult {
  id: string;
  name: string;
  nameAr: string | null;
}

/**
 * Part II §4.2.2 — the Branch and Department lookups the provisioning form
 * depends on.
 *
 * Both models predate this by many phases and neither had a write path: the
 * seed creates none, no endpoint created one, and every row that existed was
 * inserted by an e2e spec reaching past the API with raw Prisma. That is the
 * same shape §1's fourth finding warns about — a path the normal flow never
 * exercises is a path nothing is actually testing — so the e2e suite now
 * creates both through these endpoints instead.
 *
 * Gated by `user.manage` rather than a new permission of their own: these
 * exist to serve provisioning, the same SYSTEM_SECURITY_ADMINISTRATOR performs
 * both, and inventing a permission the 11-role seed grid has never heard of
 * would mean a seed change for no separation-of-duties gain.
 *
 * Reads and writes both go through the tenant-scoped client, so an office only
 * ever sees and creates its own units.
 */
@Injectable()
export class OrgStructureService {
  private readonly logger = new Logger(OrgStructureService.name);

  constructor(
    private readonly departments: DepartmentRepository,
    private readonly branches: BranchRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * THE BRANCH PICKER. Eleven screens filter by branch and every one typed a uuid — the widest of the
   * six pickers by number of screens.
   *
   * ITS OWN ROUTE rather than a widened `GET /admin/branches`, and the reason is a disclosure boundary
   * rather than tidiness: that list is an administrative register which can be asked for every branch
   * INCLUDING the retired ones (`?includeRetired=true`), and widening its `branch.read` gate to the ten
   * codes these screens carry would hand nine roles an administration screen's data in order to serve a
   * dropdown. This returns live branches, two name fields, and nothing else.
   *
   * That sentence used to say the register "returns every branch including the deactivated ones" and
   * was FALSE when written — both list reads filtered live-only until the reactivate route landed, so
   * the claim described a capability nothing had. Corrected rather than deleted, because the
   * disclosure argument it supports is unchanged and is the reason this route exists.
   *
   * NOT AUDITED. A branch is the office's own structure, not a person and not a counterparty; a row
   * recording that somebody typed two letters of their own branch's name would record a non-event.
   */
  async searchBranchesForPicker(
    dto: SearchBranchesDto,
  ): Promise<OrgUnitPickerResult[]> {
    const rows = await this.branches.searchForPicker(
      dto.q,
      PICKER_MAX_RESULTS.branch,
    );
    return rows.map((b) => ({ id: b.id, name: b.name, nameAr: b.nameAr }));
  }

  /** LIVE departments unless `includeRetired`, which the administration screen passes so a retired
   *  unit can be brought back. Every other caller — pickers, filters — gets the live list. */
  async listDepartments(includeRetired = false): Promise<OrgUnitView[]> {
    return (await this.departments.list(includeRetired)).map(toOrgUnitView);
  }

  /**
   * Turn the partial UNIQUE index's P2002 into a 409 that names the collision.
   *
   * Without this it reaches the caller as a bare 500 — measured, by the spec that asserts the
   * refusal — and a 500 tells a person nothing about what to do. It is the same shape as
   * IMPROVEMENTS § 1.11: a real database invariant, correctly enforced, arriving as an
   * indistinguishable server error.
   */
  private asNameCollision(err: unknown, kind: string, name: string): unknown {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        `This office already has a ${kind.toLowerCase()} named ${name}. Retire the existing one first, or choose another name.`,
      );
    }
    return err;
  }

  async createDepartment(
    dto: CreateOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    let department: Awaited<ReturnType<DepartmentRepository['create']>>;
    try {
      department = await this.departments.create({
        name: dto.name,
        nameAr: dto.nameAr ?? null,
      });
    } catch (err) {
      throw this.asNameCollision(err, 'Department', dto.name);
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Department',
      entityId: department.id,
      afterValue: { name: department.name, nameAr: department.nameAr },
    });
    return toOrgUnitView(department);
  }

  /**
   * Rename, and refuse an empty request rather than writing nothing and reporting success.
   *
   * A rename is audited with BOTH values, because "who renamed Claims to Claims & Recoveries, and
   * when" is the only way to read an older audit row that names the old label.
   */
  async renameDepartment(
    id: string,
    dto: RenameOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.rename('Department', id, dto, actorUserId);
  }

  async renameBranch(
    id: string,
    dto: RenameOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.rename('Branch', id, dto, actorUserId);
  }

  async deactivateDepartment(
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.deactivate('Department', id, actorUserId);
  }

  async deactivateBranch(
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.deactivate('Branch', id, actorUserId);
  }

  async reactivateDepartment(
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.reactivate('Department', id, actorUserId);
  }

  async reactivateBranch(
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    return this.reactivate('Branch', id, actorUserId);
  }

  /** One implementation for both, because a department and a branch differ in what they MEAN to the
   *  business and in nothing this service does to them. */
  private async rename(
    kind: 'Department' | 'Branch',
    id: string,
    dto: RenameOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    if (dto.name === undefined && dto.nameAr === undefined) {
      throw new UnprocessableEntityException(
        `${kind} rename: give a name, an Arabic name, or both — an empty rename would report success and change nothing.`,
      );
    }
    const repo = kind === 'Department' ? this.departments : this.branches;
    const before = await repo.findById(id);
    if (!before) throw new NotFoundException(`${kind} ${id} not found.`);
    if (before.deactivatedAt) {
      throw new UnprocessableEntityException(
        `${kind} ${before.name} is retired; renaming it would change a label that existing records point at.`,
      );
    }
    let after:
      | Awaited<ReturnType<DepartmentRepository['rename']>>
      | Awaited<ReturnType<BranchRepository['rename']>>;
    try {
      after = await repo.rename(id, {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.nameAr === undefined ? {} : { nameAr: dto.nameAr }),
      });
    } catch (err) {
      // A rename ONTO an existing live name hits the same index as a create.
      throw this.asNameCollision(err, kind, dto.name ?? before.name);
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: kind,
      entityId: id,
      beforeValue: { name: before.name, nameAr: before.nameAr },
      afterValue: { name: after.name, nameAr: after.nameAr },
    });
    return toOrgUnitView(after);
  }

  private async deactivate(
    kind: 'Department' | 'Branch',
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    const repo = kind === 'Department' ? this.departments : this.branches;
    const before = await repo.findById(id);
    if (!before) throw new NotFoundException(`${kind} ${id} not found.`);
    if (before.deactivatedAt) {
      throw new UnprocessableEntityException(
        `${kind} ${before.name} is already retired.`,
      );
    }
    const after = await repo.deactivate(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: kind,
      entityId: id,
      beforeValue: { deactivatedAt: null },
      // Named for what it is. The rows pointing at this unit are untouched, deliberately.
      afterValue: {
        deactivatedAt: after.deactivatedAt,
        retained: 'existing assignments unchanged',
      },
    });
    return toOrgUnitView(after);
  }

  /** LIVE branches unless `includeRetired` — see `listDepartments`. */
  async listBranches(includeRetired = false): Promise<OrgUnitView[]> {
    return (await this.branches.list(includeRetired)).map(toOrgUnitView);
  }

  /**
   * Bring a retired unit back — the sibling `deactivate` never had, and the asymmetry was live.
   *
   * `Role` has had `POST /roles/:id/reactivate` since Phase 3, and `rbac.controller.ts` states the
   * reason in as many words: a screen that hid retired roles "would leave an office unable to
   * reactivate one". Org units were hidden AND had no way back, so the two halves of this system
   * disagreed about the same question.
   *
   * ON THE SAME PERMISSION AS `deactivate`, NOT A NEW CODE. That is the role precedent exactly
   * (`role.deactivate` gates both retire and reactivate) and it is the honest grain: retiring and
   * un-retiring are one capability — *decide whether this unit is in service* — and minting a code
   * for the second half would let an office grant the ability to retire without the ability to undo
   * it, which is the trap, not a separation.
   *
   * THE NAME COLLISION IS THE INDEX'S JOB. `<Kind>_one_live_name_per_org` is partial on
   * `deactivatedAt IS NULL`, so clearing the stamp enters it and a clash with a live unit of the
   * same name raises P2002 — turned into the same 409 a create gets, through `asNameCollision`. A
   * pre-check here would be a second answer to a question the database already decides, and it
   * would be the racy one.
   */
  private async reactivate(
    kind: 'Department' | 'Branch',
    id: string,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    const repo = kind === 'Department' ? this.departments : this.branches;
    const before = await repo.findById(id);
    if (!before) throw new NotFoundException(`${kind} ${id} not found.`);
    if (!before.deactivatedAt) {
      // Refused rather than treated as a no-op: "already in service" and "brought back into
      // service" are different facts, and a silent 200 on the first would make an administrator
      // believe they had changed something.
      throw new UnprocessableEntityException(
        `${kind} ${before.name} is not retired, so there is nothing to bring back.`,
      );
    }
    let after:
      | Awaited<ReturnType<DepartmentRepository['reactivate']>>
      | Awaited<ReturnType<BranchRepository['reactivate']>>;
    try {
      after = await repo.reactivate(id);
    } catch (err) {
      throw this.asNameCollision(err, kind, before.name);
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: kind,
      entityId: id,
      beforeValue: { deactivatedAt: before.deactivatedAt },
      afterValue: { deactivatedAt: null },
    });
    return toOrgUnitView(after);
  }

  async createBranch(
    dto: CreateOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    let branch: Awaited<ReturnType<BranchRepository['create']>>;
    try {
      branch = await this.branches.create({
        name: dto.name,
        nameAr: dto.nameAr ?? null,
      });
    } catch (err) {
      throw this.asNameCollision(err, 'Branch', dto.name);
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Branch',
      entityId: branch.id,
      afterValue: { name: branch.name, nameAr: branch.nameAr },
    });
    return toOrgUnitView(branch);
  }

  /** The `UserAdminService.safeAudit` shape — a failed audit write is logged
   * loudly but never rolls back an operation that already committed. */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Org-structure audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}

function toOrgUnitView(unit: {
  id: string;
  name: string;
  nameAr: string | null;
  deactivatedAt: Date | null;
}): OrgUnitView {
  return {
    id: unit.id,
    name: unit.name,
    nameAr: unit.nameAr,
    // An ISO string, like every other date on the wire here. REQUIRED on the view rather than
    // optional: a screen that can request retired units has to be able to tell which they are, and
    // an optional field would let one surface render a retired unit as live — the `IncidentReport`
    // defect, where a field present on one path and absent on another renders `undefined`.
    retiredAt: unit.deactivatedAt ? unit.deactivatedAt.toISOString() : null,
  };
}
