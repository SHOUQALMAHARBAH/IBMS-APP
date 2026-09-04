import { Module } from '@nestjs/common';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import { AuditModule } from '../audit/audit.module';
import { SlaModule } from '../sla/sla.module';

/**
 * PDPL / PCMS foundations (backlog Part D, `IMPROVEMENTS.md` §5.1; the
 * backlog bundles all of Part D under Process #52 "Data Protection
 * Compliance"). Opens with M03 — Consent Management
 * (`ibms-brain/meta/context/pcms-privacy-modules.md`'s M01-M12 map);
 * `ConsentController` / `ConsentService` own the `ConsentRecord` capture +
 * two-step withdrawal flow. The other eight PCMS systems (M04 DSR, M06
 * Retention & Disposal, M07 Vendor Risk, M08 Data Sharing, M09 Incident,
 * M10 DPIA, notices, RoPA, and the DPO Workspace dashboard) are not built
 * yet — see `ibms-brain/meta/context/consent-management.md` (M03) and
 * `ibms-brain/meta/context/pcms-privacy-modules.md` (the M01-M12 map).
 *
 *   - AuditModule -> AuditService (CREATE / UPDATE audit rows)
 *   - SlaModule   -> SlaTimerService (the generic escalation engine —
 *     `consent_withdrawal`, 2 business days, `PRIV-STD-01` §6.3). `@Global()`,
 *     imported explicitly per the `RbacModule` / `CustomerServiceModule`
 *     precedent.
 *
 * The global `PermissionsGuard` / `@CurrentUser` cover `ConsentController`;
 * `AuthModule` is not imported here (no scheduler in this module needs the
 * system service account — contrast `CustomerServiceModule`'s retention
 * sweep).
 */
@Module({
  imports: [AuditModule, SlaModule],
  controllers: [ConsentController],
  providers: [ConsentService, ConsentRecordRepository],
})
export class PdplModule {}
