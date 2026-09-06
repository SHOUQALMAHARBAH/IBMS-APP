import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentRepository } from '../../repositories/document.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 70 (backlog Part C #70, Domain H) — Document Management. Needs
 * `PolicyRepository` only to validate a `policyId` is real before computing
 * its file's classification rollup — the zero-`imports`/`exports`
 * cross-module shared-repository shape (#63/#65: provide the OTHER
 * module's repository directly here, never import `PolicyModule` or inject
 * `PolicyService`).
 */
@Module({
  imports: [AuditModule],
  controllers: [DocumentController],
  providers: [DocumentService, DocumentRepository, PolicyRepository],
})
export class DocumentModule {}
