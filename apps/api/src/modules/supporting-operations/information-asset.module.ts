import { Module } from '@nestjs/common';
import { InformationAssetController } from './information-asset.controller';
import { InformationAssetService } from './information-asset.service';
import { InformationAssetRepository } from '../../repositories/information-asset.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Process 69 (backlog Part C #69, Domain H) — Cybersecurity. The backlog's
 * own annotation: "fully covered by Part A + `IncidentReport` +
 * `InformationAsset`." Verified, not taken at face value — Part A's
 * cybersecurity-relevant items each carry their own already-tracked gap
 * (README § Known gaps), `IncidentReport` (#55) is genuinely built as a
 * "unified security + personal-data breach workflow," but `InformationAsset`
 * (the ISO 27001 Clause 8.1 asset inventory) was completely dormant — zero
 * prior application code. This module is its first real consumer, the one
 * genuine gap #69's own coverage claim missed. See
 * `ibms-brain/meta/context/information-asset-inventory.md`.
 *
 *   - AuditModule -> AuditService (a CREATE/UPDATE row per write).
 *   - AuthModule  -> UserRepository (verifying `ownerUserId` points at a
 *     real account before creating/reassigning).
 *
 * New permission — `information-asset.manage` (unlike #66/#67, Domain H's
 * first two items, this one had NO pre-seeded grant waiting; a real seed
 * change was needed).
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [InformationAssetController],
  providers: [InformationAssetService, InformationAssetRepository],
})
export class InformationAssetModule {}
