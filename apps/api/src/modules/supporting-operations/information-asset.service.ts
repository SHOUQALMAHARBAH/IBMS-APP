import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { InformationAsset } from '@ibms/db';
import { InformationAssetRepository } from '../../repositories/information-asset.repository';
import { UserRepository } from '../../repositories/user.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { CreateInformationAssetDto } from './dto/create-information-asset.dto';
import type { UpdateInformationAssetDto } from './dto/update-information-asset.dto';
import type { ListInformationAssetsQueryDto } from './dto/list-information-assets-query.dto';

/** Process 69 — the foundational `InformationAsset` CRUD (ISO 27001 Clause
 * 8.1 asset inventory). See `information-asset.config.ts` for why this is
 * the one genuine gap #69's own "fully covered" backlog claim missed, and
 * `ibms-brain/meta/context/information-asset-inventory.md`. */
@Injectable()
export class InformationAssetService {
  private readonly logger = new Logger(InformationAssetService.name);

  constructor(
    private readonly assets: InformationAssetRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateInformationAssetDto,
    actorUserId: string,
  ): Promise<InformationAsset> {
    const owner = await this.users.findById(dto.ownerUserId);
    if (!owner) throw new NotFoundException('Owner user not found');

    const asset = await this.assets.create({
      name: dto.name,
      assetType: dto.assetType,
      ownerUserId: dto.ownerUserId,
      classification: dto.classification,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'InformationAsset',
      entityId: asset.id,
      afterValue: {
        name: asset.name,
        assetType: asset.assetType,
        classification: asset.classification,
        ownerUserId: asset.ownerUserId,
      },
    });

    return asset;
  }

  list(query: ListInformationAssetsQueryDto): Promise<InformationAsset[]> {
    return this.assets.findMany({
      assetType: query.assetType,
      classification: query.classification,
    });
  }

  async get(id: string): Promise<InformationAsset> {
    const asset = await this.assets.findById(id);
    if (!asset) throw new NotFoundException('Information asset not found');
    return asset;
  }

  async update(
    id: string,
    dto: UpdateInformationAssetDto,
    actorUserId: string,
  ): Promise<InformationAsset> {
    const existing = await this.assets.findById(id);
    if (!existing) throw new NotFoundException('Information asset not found');

    if (dto.ownerUserId) {
      const owner = await this.users.findById(dto.ownerUserId);
      if (!owner) throw new NotFoundException('Owner user not found');
    }

    const updated = await this.assets.update(id, {
      name: dto.name,
      assetType: dto.assetType,
      ownerUserId: dto.ownerUserId,
      classification: dto.classification,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'InformationAsset',
      entityId: id,
      afterValue: {
        name: updated.name,
        assetType: updated.assetType,
        classification: updated.classification,
        ownerUserId: updated.ownerUserId,
      },
    });

    return updated;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `InformationAsset audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
