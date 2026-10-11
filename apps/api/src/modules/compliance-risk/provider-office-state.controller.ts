import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProviderOfficeStateService } from './provider-office-state.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * MODULE 0 ITEM (j) — the provider dashboard.
 *
 * ONE route, ONE code, and no filters.
 *
 * No query parameters, deliberately: a filter on this route would be a way to ask targeted
 * questions about a named competitor, and the dashboard's job is the platform-wide picture. A reader
 * who wants one office can look at the row. If filtering is ever wanted, it is a decision about
 * what a provider may ask, not a convenience.
 */
@ApiTags('provider')
@Controller('provider/offices')
export class ProviderOfficeStateController {
  constructor(private readonly offices: ProviderOfficeStateService) {}

  @RequirePermissions('provider.office-state.read')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.offices.list(user.id);
  }
}
