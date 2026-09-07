import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { CrossBorderTransferRepository } from '../../repositories/cross-border-transfer.repository';
import {
  crossBorderTransferAuditSnapshot,
  deriveCrossBorderTransferView,
  type CrossBorderTransferRecordView,
} from './cross-border-transfer.config';
import type { CreateCrossBorderTransferDto } from './dto/create-cross-border-transfer.dto';
import type { ListCrossBorderTransfersQueryDto } from './dto/list-cross-border-transfers-query.dto';

const DEFAULT_LIST_TAKE = 200;

/**
 * Cross-Border Transfer (Part 6.2 — see `cross-border-transfer.config.ts`'s
 * header comment for why this doesn't map onto a named M01-M12 module).
 * `cross-border-transfer.approve` (DPO-only) gates the whole surface — see
 * that same file for why `create()` doubles as the approval act.
 */
@Injectable()
export class CrossBorderTransferService {
  private readonly logger = new Logger(CrossBorderTransferService.name);

  constructor(
    private readonly repo: CrossBorderTransferRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateCrossBorderTransferDto,
    actorUserId: string,
  ): Promise<CrossBorderTransferRecordView> {
    if (dto.destinationCountry.trim().toLowerCase() === 'jordan') {
      throw new BadRequestException(
        'destinationCountry must be outside Jordan — this record type only covers cross-border transfers.',
      );
    }

    const row = await this.repo.create({
      description: dto.description,
      destinationCountry: dto.destinationCountry,
      legalBasis: dto.legalBasis,
      legalBasisEvidenceRef: dto.legalBasisEvidenceRef ?? null,
      approvedByUserId: actorUserId,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'CrossBorderTransferRecord',
      entityId: row.id,
      afterValue: crossBorderTransferAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });

    return deriveCrossBorderTransferView(row);
  }

  async get(id: string): Promise<CrossBorderTransferRecordView> {
    return deriveCrossBorderTransferView(await this.load(id));
  }

  async list(
    query: ListCrossBorderTransfersQueryDto,
  ): Promise<CrossBorderTransferRecordView[]> {
    const rows = await this.repo.findMany(
      {
        legalBasis: query.legalBasis,
        destinationCountry: query.destinationCountry,
      },
      DEFAULT_LIST_TAKE,
    );
    return rows.map((r) => deriveCrossBorderTransferView(r));
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(
        `Cross-border transfer record ${id} not found.`,
      );
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `CrossBorderTransferRecord audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
