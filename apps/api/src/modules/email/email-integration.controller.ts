import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationEmailIntegrationService } from './organization-email-integration.service';
import {
  AuthorizeUrlQueryDto,
  ConnectEmailIntegrationDto,
} from './dto/connect-email-integration.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { RequireRoles } from '../auth/decorators/require-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Part I §6 — an office connects its OWN corporate mailbox.
 *
 * Everything here is scoped to the caller's Organization by the tenant
 * extension, and the row is governed by an RLS policy as well, so one office
 * cannot see or touch another's mailbox even through a crafted request.
 *
 * No route on this controller ever returns the refresh token, encrypted or
 * otherwise. `status` returns the address, the provider and the health; that is
 * all an administrator needs and all they get.
 */
@ApiTags('email')
@Controller('admin/email-integration')
export class EmailIntegrationController {
  constructor(
    private readonly integrations: OrganizationEmailIntegrationService,
  ) {}

  @RequirePermissions('email.integration.read')
  @Get()
  status() {
    return this.integrations.status();
  }

  /** Where to send the administrator to grant consent. Returns `state` for the
   * caller to store and compare on the way back — an authorization code
   * accepted without that check can be replayed from another site. */
  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('email.integration.manage')
  @Get('authorize-url')
  authorizeUrl(@Query() query: AuthorizeUrlQueryDto) {
    return this.integrations.authorizeUrl(query.provider);
  }

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('email.integration.manage')
  @Post('connect')
  connect(
    @Body() dto: ConnectEmailIntegrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrations.connect(dto, user.id);
  }

  /** Checks the stored credential against the provider without sending
   * anything to anybody. */
  @RequirePermissions('email.integration.read')
  @Post('verify')
  verify(@CurrentUser() user: AuthenticatedUser) {
    return this.integrations.verify(user.id);
  }

  /** Sends a real message, to the office's own connected mailbox — proving
   * end-to-end delivery without mailing anyone who did not ask to be part of a
   * configuration test. */
  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('email.integration.manage')
  @Post('test')
  sendTest(@CurrentUser() user: AuthenticatedUser) {
    return this.integrations.sendTest(user.id);
  }

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('email.integration.manage')
  @Post('revoke')
  revoke(@CurrentUser() user: AuthenticatedUser) {
    return this.integrations.revoke(user.id);
  }
}
