import { Module } from '@nestjs/common';
import { AuditTrailController } from './audit-trail.controller';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailRepository } from '../../repositories/audit-trail.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 57 (backlog Part C #57's second checkbox, Domain F — closes
 * Domain F) — "Time-boxed read-only access for the External Auditor role
 * across all records, documents, and workflow history." A read-only,
 * cross-module lens over `AuditLogEntry` (plus `Document`'s own version
 * chain) — it owns neither table's writes, so it stays a separate module,
 * the `SlaDashboardModule` shape (aggregates other modules' data, is not
 * owned by any one of them).
 *
 *   - AuditModule -> AuditService (a best-effort `READ` row per read here —
 *     reading the audit log, a document's history, or a record's workflow
 *     history is itself Part 10.3 territory).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 *
 * No migration (a pure read over existing tables). No seed change —
 * `audit-log.read` / `document-history.read` / `workflow-history.read`
 * were all pre-seeded ahead of time; this module is their first real
 * consumer, the same "genuinely no seed change" shape #55's four
 * permissions had.
 */
@Module({
  imports: [AuditModule],
  controllers: [AuditTrailController],
  providers: [AuditTrailService, AuditTrailRepository],
})
export class AuditTrailModule {}
