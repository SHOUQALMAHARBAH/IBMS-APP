import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CompanyRecordController } from './company-record.controller';
import { CompanyRecordService } from './company-record.service';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — the first and only company-facing surface.
 *
 * ONE ROUTE, and the module exists rather than folding it into `ProviderModule` because the audience
 * is the opposite one: everything in `ProviderModule` is the provider acting ON somebody, and this is
 * a company reading ITSELF. Putting a company-facing read behind the provider's module would make the
 * next reader look for a provider permission on it, and there is none — it is gated on the caller's
 * organization type.
 */
@Module({
  imports: [AuditModule],
  controllers: [CompanyRecordController],
  providers: [CompanyRecordService],
})
export class CompanyModule {}
