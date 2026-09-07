import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RfqService } from './rfq.service';
import { TransitionRfqInsurerDto } from './dto/transition-rfq-insurer.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 11-12 — record an insurer's response status on their RFQ
 * submission (viewed / quoted / declined / no response). Separate base path
 * from `rfqs` because a submission is addressed by its own id. The legal
 * move map is enforced by WorkflowTransitionService (A.6). */
@ApiTags('rfq-insurers')
@Controller('rfq-insurers')
export class RfqInsurerController {
  constructor(private readonly rfqs: RfqService) {}

  @RequirePermissions('rfq.insurer.update')
  @Post(':id/transition')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionRfqInsurerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.transitionInsurer(id, dto, user);
  }
}
