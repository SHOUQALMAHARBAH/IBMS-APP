import { Module } from '@nestjs/common';
import { InsurerMasterController } from './insurer-master.controller';
import { InsurerMasterService } from './insurer-master.service';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Part I §5 (multi-tenancy Phase 3 step 10) — the global insurer master
 * registry and the form mappings shared across every Organization.
 *
 * The first module in this system whose every model is global rather than
 * tenant-scoped, which is why the sharing is the thing its tests assert.
 */
@Module({
  imports: [AuditModule],
  controllers: [InsurerMasterController],
  providers: [InsurerMasterService, InsurerMasterRepository],
})
export class InsurerMasterModule {}
