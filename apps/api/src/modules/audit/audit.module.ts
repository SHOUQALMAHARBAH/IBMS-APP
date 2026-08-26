import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditAnomalyDetectionService } from './audit-anomaly-detection.service';
import { AccessAnomalyAlertRepository } from '../../repositories/access-anomaly-alert.repository';

@Global()
@Module({
  providers: [
    AuditService,
    AuditAnomalyDetectionService,
    AccessAnomalyAlertRepository,
  ],
  exports: [AuditService, AuditAnomalyDetectionService],
})
export class AuditModule {}
