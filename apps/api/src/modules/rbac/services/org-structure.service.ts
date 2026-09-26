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
import { DepartmentRepository } from '../../../repositories/department.repository';
import type {
  CreateOrgUnitDto,
  RenameOrgUnitDto,
} from '../dto/org-structure.dto';

export interface OrgUnitView {
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

  async listDepartments(): Promise<OrgUnitView[]> {
    return (await this.departments.list()).map(toOrgUnitView);
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

  async listBranches(): Promise<OrgUnitView[]> {
    return (await this.branches.list()).map(toOrgUnitView);
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
}): OrgUnitView {
  return { id: unit.id, name: unit.name, nameAr: unit.nameAr };
}
