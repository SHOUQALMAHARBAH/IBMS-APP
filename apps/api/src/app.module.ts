import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SecurityModule } from './modules/security/security.module';
import { SlaModule } from './modules/sla/sla.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { LeadModule } from './modules/lead/lead.module';
import { ProspectModule } from './modules/prospect/prospect.module';
import { CustomerModule } from './modules/customer/customer.module';
import { RiskProfileModule } from './modules/risk-profile/risk-profile.module';
import { NeedsAssessmentModule } from './modules/needs-assessment/needs-assessment.module';
import { InsuranceProgramModule } from './modules/insurance-program/insurance-program.module';
import { CrossSellModule } from './modules/cross-sell/cross-sell.module';

@Module({
  imports: [
    // In Docker/CI, real env vars are already in process.env and these files
    // simply won't exist — ConfigModule does not error when they're missing.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Enables @Cron() discovery anywhere in the app (see
    // rbac/services/access-recertification.scheduler.ts) — registered once,
    // globally, here.
    ScheduleModule.forRoot(),
    // Part 10.3/10.4 — structured operational logging (pino). First so the
    // injectable Logger + HTTP request logging cover every module below.
    // Distinct from AuditModule's immutable AuditLogEntry (the compliance
    // trail); see common/logging/logging.module.ts.
    LoggingModule,
    PrismaModule,
    AuditModule,
    // Depends on AuditModule's global AuditService for the TRANSITION audit
    // row every transition() call writes.
    WorkflowModule,
    AuthModule,
    // Depends on AuthModule's exported UserRepository (system service
    // account lookup for escalation-sweep audit rows) — imported after it.
    SlaModule,
    // Imported after AuthModule — see rbac.module.ts's PermissionsGuard
    // comment for why global-guard execution order depends on this.
    RbacModule,
    SecurityModule,
    // Part C backlog #1 (Lead Management) — the first business (non-
    // infrastructure) module. Depends on WorkflowModule (Lead's status
    // transitions) and RbacModule's PermissionsGuard (lead.create/
    // lead.list.read/lead.transition) already being registered above.
    LeadModule,
    // Part C backlog #2 (Prospect Management) — depends on LeadModule's
    // exported LeadRepository (reads the source Lead before converting it)
    // and WorkflowModule (the Lead's CONVERTED_TO_PROSPECT transition).
    ProspectModule,
    // Part C backlog #3-4 (Customer Acquisition/Onboarding) — depends on
    // ProspectModule's exported ProspectRepository (validates an optional
    // prospectId link), SecurityModule (field encryption/masking, its first
    // real consumer), and WorkflowModule/SlaModule (KYCRecord/Customer
    // status transitions, the two new kyc_*_review SLA timers).
    CustomerModule,
    // Part C backlog #5 (Needs Assessment) — depends on CustomerModule's
    // exported CustomerRepository (a Risk Profile inherits its Customer's
    // visibility). RiskProfileModule is the minimal parent-record home
    // Process 6 (the asset survey) will build on; NeedsAssessmentModule
    // carries the questionnaire + review/approval gate and reuses
    // WorkflowModule for the NeedsAssessment status chain.
    RiskProfileModule,
    NeedsAssessmentModule,
    // Part C backlog #7 (Product Recommendation / Program Design) — assembles
    // an InsuranceProgram from an APPROVED NeedsAssessment's coverage list +
    // the parent RiskProfile's asset survey. Depends on NeedsAssessmentModule
    // /RiskProfileModule/CustomerModule's exported repositories and reuses
    // WorkflowModule for the InsuranceProgram status chain.
    InsuranceProgramModule,
    // Part C backlog #8 (Cross-Selling) — a nightly job + on-demand scan
    // flags each benchmark insurance line a customer holds no in-force
    // policy for, as a CrossSellOpportunity a Sales Officer then converts or
    // dismisses. Depends on CustomerModule (visibility) and AuthModule (the
    // scheduler's system-account lookup); reuses WorkflowModule for the
    // OPEN -> CONVERTED | DISMISSED status chain.
    CrossSellModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
