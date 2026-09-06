import { Module } from '@nestjs/common';
import { PortfolioAnalysisController } from './portfolio-analysis.controller';
import { PortfolioAnalysisService } from './portfolio-analysis.service';
import { PortfolioAnalysisRepository } from '../../repositories/portfolio-analysis.repository';
import { AuditModule } from '../audit/audit.module';

/**
 * Process 62 (backlog Part C #62, Domain G) — "Portfolio Analysis: a query
 * by line/insurer/client segment/geography." A live, book-wide snapshot —
 * no new model, no migration, no scheduler, no new permission
 * (`portfolio-analysis.view` was already pre-seeded ahead of time). See
 * `ibms-brain/meta/context/portfolio-analysis.md`.
 *
 *   - AuditModule -> AuditService (a best-effort READ row per read).
 *   - The global `PermissionsGuard` / `@CurrentUser` cover the controller.
 */
@Module({
  imports: [AuditModule],
  controllers: [PortfolioAnalysisController],
  providers: [PortfolioAnalysisService, PortfolioAnalysisRepository],
})
export class PortfolioAnalysisModule {}
