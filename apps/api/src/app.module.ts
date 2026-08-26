import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SecurityModule } from './modules/security/security.module';
import { SlaModule } from './modules/sla/sla.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { LeadModule } from './modules/lead/lead.module';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
