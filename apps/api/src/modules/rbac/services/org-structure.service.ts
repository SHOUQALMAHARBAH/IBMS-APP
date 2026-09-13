import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { RecordAuditEntryInput } from '../../audit/audit.service';
import { BranchRepository } from '../../../repositories/branch.repository';
import { DepartmentRepository } from '../../../repositories/department.repository';
import type { CreateOrgUnitDto } from '../dto/org-structure.dto';

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

  async createDepartment(
    dto: CreateOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    const department = await this.departments.create({
      name: dto.name,
      nameAr: dto.nameAr ?? null,
    });
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Department',
      entityId: department.id,
      afterValue: { name: department.name, nameAr: department.nameAr },
    });
    return toOrgUnitView(department);
  }

  async listBranches(): Promise<OrgUnitView[]> {
    return (await this.branches.list()).map(toOrgUnitView);
  }

  async createBranch(
    dto: CreateOrgUnitDto,
    actorUserId: string,
  ): Promise<OrgUnitView> {
    const branch = await this.branches.create({
      name: dto.name,
      nameAr: dto.nameAr ?? null,
    });
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
