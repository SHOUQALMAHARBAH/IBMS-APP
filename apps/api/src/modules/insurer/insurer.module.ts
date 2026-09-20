import { Module } from '@nestjs/common';
import { InsurerController } from './insurer.controller';
import { InsurerService } from './insurer.service';
import { InsuranceLineController } from './insurance-line.controller';
import { InsuranceLineService } from './insurance-line.service';
import { InsurerRepository } from '../../repositories/insurer.repository';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import { InsurerDirectoryController } from './insurer-directory.controller';
import { InsurerDirectoryService } from './insurer-directory.service';
import { InsurerDirectoryRepository } from '../../repositories/insurer-directory.repository';
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
  // The vocabulary lives here rather than in a module of its own: an insurance line
  // exists so an insurer can be described by one, its only writer is the same
  // administrator, and both halves are gated on the same two permission codes. A
  // separate module would be a boundary with nothing on either side of it.
  controllers: [
    InsurerController,
    InsuranceLineController,
    InsurerDirectoryController,
  ],
  providers: [
    InsurerService,
    InsurerRepository,
    InsuranceLineService,
    InsuranceLineRepository,
    InsurerDirectoryService,
    InsurerDirectoryRepository,
  ],
  // Exported: the screens and any later insurer work (the directory, deactivation)
  // read through this service rather than reaching for the repository.
  exports: [
    InsurerService,
    InsurerRepository,
    InsuranceLineService,
    InsuranceLineRepository,
  ],
})
export class InsurerModule {}
