import { Module } from '@nestjs/common';
import { InsurerController } from './insurer.controller';
import { InsurerService } from './insurer.service';
import { InsurerRepository } from '../../repositories/insurer.repository';
import { InsurerMasterModule } from './insurer-master.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Insurer management — the office-scoped half.
 *
 * A separate module from `InsurerMasterModule` even though both live in this
 * directory, because the two halves differ in the one property that decides
 * everything else: the master registry is global and shared by every office, and
 * these records are tenant-scoped. Folding them together would put a module
 * docblock in the codebase that has to say "some of this is shared and some is
 * not", which is exactly the confusion the split avoids.
 *
 * `InsurerMasterModule` is imported for its repository: registering against the
 * shared catalogue has to check that the company is in it, and a cross-module read
 * goes through the other module's REPOSITORY, never its service — the rule every
 * cross-module import in this codebase already follows.
 */
@Module({
  imports: [AuditModule, InsurerMasterModule],
  controllers: [InsurerController],
  providers: [InsurerService, InsurerRepository],
  // Exported: the screens and any later insurer work (the directory, deactivation)
  // read through this service rather than reaching for the repository.
  exports: [InsurerService, InsurerRepository],
})
export class InsurerModule {}
