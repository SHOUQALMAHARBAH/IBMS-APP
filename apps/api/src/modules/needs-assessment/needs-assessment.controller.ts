import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CombinedDutyAct } from '@ibms/db';
import { combinedDutyActView } from '../../common/duty-segregation.view';
import { NeedsAssessmentService } from './needs-assessment.service';
import { CreateNeedsAssessmentDto } from './dto/create-needs-assessment.dto';
import { UpdateNeedsAssessmentDto } from './dto/update-needs-assessment.dto';
import { ListNeedsAssessmentsQueryDto } from './dto/list-needs-assessments-query.dto';
import { CombinedDutyDeclarationDto } from '../../common/dto/combined-duty-declaration.dto';
import { NeedsAssessmentDecisionDto } from './dto/needs-assessment-decision.dto';
import {
  COVERAGE_LINES,
  NEEDS_ASSESSMENT_QUESTIONS,
} from './needs-assessment.config';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 5 — Needs Assessment. See needs-assessment.service.ts for the
 * status chain and the maker/checker rule. Frontend:
 * apps/web/app/(app)/needs-assessments/ (intake questionnaire + list +
 * detail/review screen). */

/**
 * The wire shape of an assessment: the row, with BOTH combined-duty acts PROJECTED.
 *
 * This module has no view layer — the service returns the Prisma model — so without this the acts would
 * reach the wire RAW, carrying `actedAt` / `grantingRoleNames` / `multipleGrantingRoles` where every
 * projecting pair sends `at` / `roles` / `hatAmbiguous`. That is § 1.80 exactly, and it is invisible to a
 * typecheck and to a mocked Playwright test; the proof against the real producer lives in
 * `duty-segregation-combined.e2e-spec.ts`.
 *
 * TWO acts, projected SEPARATELY and never merged. `NeedsAssessment` is the only one of the fifteen
 * carrying two pairs, and a single field would say "somebody doubled up here" without saying whether it
 * was the REVIEW or the APPROVAL — which is the distinction the two database columns exist to keep.
 *
 * Promise-taking, so each handler stays a one-line delegation.
 */
async function onWire<
  T extends {
    reviewerCombinedDutyAct: CombinedDutyAct | null;
    approverCombinedDutyAct: CombinedDutyAct | null;
  },
>(pending: Promise<T>) {
  return project(await pending);
}

async function onWireMany<
  T extends {
    reviewerCombinedDutyAct: CombinedDutyAct | null;
    approverCombinedDutyAct: CombinedDutyAct | null;
  },
>(pending: Promise<T[]>) {
  return (await pending).map(project);
}

function project<
  T extends {
    reviewerCombinedDutyAct: CombinedDutyAct | null;
    approverCombinedDutyAct: CombinedDutyAct | null;
  },
>(row: T) {
  return {
    ...row,
    reviewerCombinedDutyAct: combinedDutyActView(row.reviewerCombinedDutyAct),
    approverCombinedDutyAct: combinedDutyActView(row.approverCombinedDutyAct),
  };
}

@ApiTags('needs-assessments')
@Controller('needs-assessments')
export class NeedsAssessmentController {
  constructor(private readonly assessments: NeedsAssessmentService) {}

  @RequirePermissions('needs-assessment.create')
  @Post()
  create(
    @Body() dto: CreateNeedsAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.create(dto, user));
  }

  /** The static question set + canonical coverage lines the intake form
   * renders. Declared before `:id` so "questionnaire" is never parsed as an
   * id. */
  @RequirePermissions('needs-assessment.read')
  @Get('questionnaire')
  questionnaire() {
    return {
      questions: NEEDS_ASSESSMENT_QUESTIONS,
      coverageLines: COVERAGE_LINES,
    };
  }

  @RequirePermissions('needs-assessment.read')
  @Get()
  list(
    @Query() query: ListNeedsAssessmentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWireMany(this.assessments.list(query, user));
  }

  @RequirePermissions('needs-assessment.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return onWire(this.assessments.get(id, user));
  }

  @RequirePermissions('needs-assessment.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNeedsAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.update(id, dto, user));
  }

  @RequirePermissions('needs-assessment.create')
  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return onWire(this.assessments.submit(id, user));
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: CombinedDutyDeclarationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.review(id, dto, user));
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: CombinedDutyDeclarationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.approve(id, dto, user));
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/return')
  returnToDraft(
    @Param('id') id: string,
    @Body() dto: NeedsAssessmentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.returnToDraft(id, dto.reason, user));
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: NeedsAssessmentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.assessments.reject(id, dto, user));
  }
}
