import { Module } from '@nestjs/common';
import { BcpDrPlanController } from './bcp-dr-plan.controller';
import { BcpDrPlanService } from './bcp-dr-plan.service';
import { BcpDrPlanRepository } from '../../repositories/bcp-dr-plan.repository';
import { DocumentRepository } from '../../repositories/document.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 72-73 (backlog Part C #72-73, Domain H) — Business Continuity &
 * Disaster Recovery. `BcpDrPlan` pre-exists in the core schema with zero
 * prior application code — this module is its first real consumer. Needs
 * `DocumentRepository` only to validate an optional `planDocumentId`
 * against a real `Document` — the zero-`imports`/`exports`
 * cross-module shared-repository shape (#63/#65/#70: provide the OTHER
 * module's repository directly here, never import `DocumentModule` or
 * inject `DocumentService`).
 *
 * No new permission, no migration — `bcp-dr.manage` was already
 * pre-seeded.
 */
@Module({
  imports: [AuditModule],
  controllers: [BcpDrPlanController],
  providers: [BcpDrPlanService, BcpDrPlanRepository, DocumentRepository],
})
export class BcpDrPlanModule {}
