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
import { NeedsAssessmentService } from './needs-assessment.service';
import { CreateNeedsAssessmentDto } from './dto/create-needs-assessment.dto';
import { UpdateNeedsAssessmentDto } from './dto/update-needs-assessment.dto';
import { ListNeedsAssessmentsQueryDto } from './dto/list-needs-assessments-query.dto';
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
    return this.assessments.create(dto, user);
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
    return this.assessments.list(query, user);
  }

  @RequirePermissions('needs-assessment.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.get(id, user);
  }

  @RequirePermissions('needs-assessment.create')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNeedsAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assessments.update(id, dto, user);
  }

  @RequirePermissions('needs-assessment.create')
  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.submit(id, user);
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/review')
  review(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.review(id, user);
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.approve(id, user);
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/return')
  returnToDraft(
    @Param('id') id: string,
    @Body() dto: NeedsAssessmentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assessments.returnToDraft(id, dto.reason, user);
  }

  @RequirePermissions('needs-assessment.approve')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: NeedsAssessmentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assessments.reject(id, dto.reason, user);
  }
}
