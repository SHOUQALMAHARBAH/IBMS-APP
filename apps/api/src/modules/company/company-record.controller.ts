import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompanyRecordService } from './company-record.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — an insurance company reads its own registry record.
 *
 * ## NO `@RequirePermissions`, AND THAT IS THE DECISION RATHER THAN AN OMISSION
 *
 * Authentication still applies — the global guard covers every route — so this is never anonymous.
 * What it has no permission code for is the question it answers: "show me MY OWN organization's
 * registry record". That is identity, not capability.
 *
 * A code would be a checkbox a company administrator could uncheck to blind their own company to its
 * own record. Nobody administers that separately, and this module has already refused to declare
 * three codes on that exact ground. The precedent in this codebase is `/settings/security`, which is
 * deliberately ungated because every role must be able to reach it.
 *
 * The authorization that DOES apply is the caller's ORGANIZATION TYPE, checked in the service where
 * the row is loaded. It cannot be a guard: `PermissionsGuard` runs before the handler and has no
 * resource, the same constraint that decided role scope in item (h) and item (j)'s third layer.
 *
 * ## THERE IS NO `:id`
 *
 * The organization is read from the authenticated caller, never from the path or a query. So the
 * route cannot be asked about another company at all — the safest form of a tenancy boundary is one
 * with no parameter to tamper with.
 */
@ApiTags('company')
@Controller('company')
export class CompanyRecordController {
  constructor(private readonly record: CompanyRecordService) {}

  @Get('registry-record')
  ownRecord(@CurrentUser() user: AuthenticatedUser) {
    return this.record.ownRecord({
      id: user.id,
      organizationId: user.organizationId,
    });
  }
}
