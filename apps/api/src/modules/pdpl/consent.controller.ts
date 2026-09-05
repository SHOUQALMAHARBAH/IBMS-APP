import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { CreateConsentRecordDto } from './dto/create-consent-record.dto';
import { ListConsentRecordsQueryDto } from './dto/list-consent-records-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * M03 (backlog Part D §5.1, Process #52) — Consent Management. Capture a
 * consent decision at a defined touchpoint and withdraw it through a
 * two-step request / confirm flow (`consent.service.ts`'s header). Every
 * route is `consent.manage` (`[SALES_RELATIONSHIP_OFFICER,
 * PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER, DATA_PROTECTION_OFFICER]`) —
 * the global `PermissionsGuard` / `@CurrentUser` cover it.
 */
@ApiTags('pdpl')
@Controller('consent-records')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @RequirePermissions('consent.manage')
  @Post()
  create(
    @Body() dto: CreateConsentRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consent.create(dto, user.id);
  }

  @RequirePermissions('consent.manage')
  @Post(':id/request-withdrawal')
  requestWithdrawal(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consent.requestWithdrawal(id, user.id);
  }

  @RequirePermissions('consent.manage')
  @Post(':id/confirm-withdrawal')
  confirmWithdrawal(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consent.confirmWithdrawal(id, user.id);
  }

  @RequirePermissions('consent.manage')
  @Get()
  list(@Query() query: ListConsentRecordsQueryDto) {
    return this.consent.list(query);
  }

  @RequirePermissions('consent.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.consent.get(id);
  }
}
