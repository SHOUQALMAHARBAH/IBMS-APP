import { Module } from '@nestjs/common';
import { PlanningExportController } from './planning-export.controller';
import { PlanningExportService } from './planning-export.service';
import { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import { InsurerPerformanceRepository } from '../../repositories/insurer-performance.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 65 (backlog Part C #65, Domain G — closes Domain G's build order,
 * #64 Executive Management Reporting deliberately not yet built) —
 * "Strategic Planning Inputs: export portfolio/market data for planning
 * cycles." No new model, migration, or scheduler — a live, composed export.
 * See `ibms-brain/meta/context/planning-export.md`.
 *
 * `PortfolioAnalysisRepository` and `InsurerPerformanceRepository` are ALSO
 * each provided by their own existing module (#62, #60) — the SAME classes
 * independently instantiated here, both wrapping the singleton
 * `PrismaService`. No `imports`/`exports` touched on `PortfolioAnalysisModule`
 * or `InsurerPerformanceModule` at all — this codebase's universal rule
 * (cross-module reuse is a REPOSITORY export, never a SERVICE one) extended
 * to TWO shared repositories in the SAME consuming module, the #63 pattern
 * applied again.
 *
 *   - AuditModule -> AuditService (one EXPORT row per generate call — the
 *     first real writer of `AuditAction.EXPORT`, wiring live the dormant
 *     Part 10.3 bulk-export anomaly detector for the first time).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 */
@Module({
  imports: [AuditModule],
  controllers: [PlanningExportController],
  providers: [
    PlanningExportService,
    PortfolioAnalysisRepository,
    InsurerPerformanceRepository,
  ],
})
export class PlanningExportModule {}
