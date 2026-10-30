import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InformationAssetRepository } from '../../repositories/information-asset.repository';
import { UserRepository } from '../../repositories/user.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { CreateInformationAssetDto } from './dto/create-information-asset.dto';
import type { UpdateInformationAssetDto } from './dto/update-information-asset.dto';
import type { ListInformationAssetsQueryDto } from './dto/list-information-assets-query.dto';
import {
  deriveInformationAssetView,
  type InformationAssetView,
} from './information-asset.config';

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
  ): Promise<InformationAssetView> {
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

    return deriveInformationAssetView(asset, await this.ownerNames([asset]));
  }

  async list(
    query: ListInformationAssetsQueryDto,
  ): Promise<InformationAssetView[]> {
    const rows = await this.assets.findMany({
      assetType: query.assetType,
      classification: query.classification,
    });
    /* BATCHED. An asset inventory is as long as the office's systems, and one lookup per row is how
     * a register that works on a demonstration office stops working on a real one. */
    const names = await this.ownerNames(rows);
    return rows.map((r) => deriveInformationAssetView(r, names));
  }

  async get(id: string): Promise<InformationAssetView> {
    const asset = await this.assets.findById(id);
    if (!asset) throw new NotFoundException('Information asset not found');
    return deriveInformationAssetView(asset, await this.ownerNames([asset]));
  }

  /** ONE place the four projection paths get their owner names, through decision 48's resolver. */
  private ownerNames(
    rows: readonly { ownerUserId: string }[],
  ): Promise<Map<string, string>> {
    return this.users.displayNamesForUserIds(rows.map((r) => r.ownerUserId));
  }

  async update(
    id: string,
    dto: UpdateInformationAssetDto,
    actorUserId: string,
  ): Promise<InformationAssetView> {
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

    return deriveInformationAssetView(
      updated,
      await this.ownerNames([updated]),
    );
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
