import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ConflictOfInterestRegisterService } from './conflict-of-interest-register.service';
import { DeclareConflictOfInterestDto } from './dto/declare-conflict-of-interest.dto';

/**
 * THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER — decision 36.
 *
 * ## THE POST HAS NO `@RequirePermissions`, AND THAT IS THE DECISION
 *
 * Authentication still applies — the global guard covers every route — so this is never anonymous.
 * What it has no permission code for is the act itself: the discloser is the SUBJECT, which is the
 * same reasoning that leaves `AccessRecertificationItem`'s maker permission empty, where no
 * permission exists or can.
 *
 * A code would be a checkbox an office could uncheck, and unchecking it would leave the person who
 * HAS the conflict as the one person unable to say so. The precedents for an ungated authenticated
 * route in this codebase are `/company/registry-record` and `/settings/security`.
 *
 * ## THE GET IS GATED, ON A CODE THAT IS A TEMPLATE DEFAULT RATHER THAN A LOCK
 *
 * `conflict-of-interest.register.read` ships to the manager role, which is the office's to change
 * (decision 80). Reading other people's declared conflicts is a real capability and is the half that
 * needs a grant.
 */
@ApiTags('conflict-of-interest')
@Controller('conflict-of-interest')
export class ConflictOfInterestController {
  constructor(private readonly register: ConflictOfInterestRegisterService) {}

  @Post('disclosures')
  declare(
    @Body() dto: DeclareConflictOfInterestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.declare(dto.disclosure, user);
  }

  @RequirePermissions('conflict-of-interest.register.read')
  @Get('disclosures')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.register.list(user);
  }
}
