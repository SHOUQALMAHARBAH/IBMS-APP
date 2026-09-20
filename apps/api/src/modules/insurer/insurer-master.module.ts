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
  // Exported for `InsurerModule`: registering an office insurer against the
  // shared catalogue has to check the company is in it, and a cross-module read
  // goes through the repository rather than this module's service.
  exports: [InsurerMasterRepository],
})
export class InsurerMasterModule {}
