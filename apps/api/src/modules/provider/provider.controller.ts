import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OfficeRegistrationService } from './office-registration.service';
import { InsuranceCompanyRegistrationService } from './insurance-company-registration.service';
import { RegisterBrokerageOfficeDto } from './dto/register-brokerage-office.dto';
import { InviteOfficeAdministratorDto } from './dto/invite-office-administrator.dto';
import { OfficeAdministratorInvitationService } from './office-administrator-invitation.service';
import { RegisterInsuranceCompanyDto } from './dto/register-insurance-company.dto';
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
  constructor(
    private readonly registration: OfficeRegistrationService,
    private readonly invitations: OfficeAdministratorInvitationService,
  ) {}

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

  /**
   * MODULE 0-ب ITEM (f), BROKERAGE HALF — the office's FIRST account.
   *
   * A sub-path of the office rather than its own controller, which is the opposite of how item (e)
   * was shaped and for a stated reason: registering an insurance company is a DIFFERENT KIND of act
   * on a different entity, so it earned its own path. This is an act ON an office that already
   * exists, addressed by that office's id — the same resource, one step later in its life.
   *
   * `ParseUUIDPipe` so a malformed id is a 400 naming the parameter rather than a 404 that reads as
   * "no such office".
   */
  @RequirePermissions('provider.office.administrator.invite')
  @Post(':officeId/administrator')
  inviteAdministrator(
    @CurrentUser() user: AuthenticatedUser,
    @Param('officeId', ParseUUIDPipe) officeId: string,
    @Body() dto: InviteOfficeAdministratorDto,
  ) {
    return this.invitations.invite(
      { id: user.id, organizationId: user.organizationId },
      officeId,
      dto,
    );
  }
}

/**
 * MODULE 0-ب ITEM (e) — the OTHER kind of tenant.
 *
 * Its own controller and its own path, not a `?type=` on the office one. A brokerage office and an
 * insurance company are different legal entities licensed under different instruments, their forms
 * share perhaps half their fields, and a single route taking a discriminator would have to branch on
 * it in every refusal — which is how one branch quietly stops being checked.
 */
@ApiTags('provider')
@Controller('provider/insurance-companies')
export class ProviderInsurerRegistrationController {
  constructor(
    private readonly registration: InsuranceCompanyRegistrationService,
  ) {}

  @RequirePermissions('provider.insurer.register')
  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterInsuranceCompanyDto,
  ) {
    return this.registration.registerInsuranceCompany(
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }
}
