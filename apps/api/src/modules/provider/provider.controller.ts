import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OfficeRegistrationService } from './office-registration.service';
import { RegisterBrokerageOfficeDto } from './dto/register-brokerage-office.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * MODULE 0-ب ITEM (d) — the provider's registration surface.
 *
 * The ORGANIZATION is passed to the service alongside the actor, because item (j)'s third layer is
 * a check on the caller's organization TYPE and the service is where that is decided. A guard could
 * not: `PermissionsGuard` runs before the handler and has no resource, which is the same constraint
 * that decided role scope in item (h).
 */
@ApiTags('provider')
@Controller('provider/brokerage-offices')
export class ProviderOfficeRegistrationController {
  constructor(private readonly registration: OfficeRegistrationService) {}

  @RequirePermissions('provider.office.register')
  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterBrokerageOfficeDto,
  ) {
    return this.registration.registerBrokerageOffice(
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }
}
