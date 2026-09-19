import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import {
  CreateEmployeeDto,
  RevealEmployeeFieldDto,
  UpdateEmployeeDto,
} from './dto/create-employee.dto';
import { CreateTrainingDto } from './dto/create-training.dto';
import { UpdateDeprovisioningChecklistDto } from './dto/update-deprovisioning-checklist.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 66 (backlog Part C #66, Domain H — opens Domain H). `employee.
 * manage` (System Security Administrator / Branch-Department Manager)
 * gates the employee record + training surface; `deprovisioning.execute`
 * (System Security Administrator ONLY, narrower) gates termination and the
 * checklist it opens — terminating an employee IS the "employment-status
 * change" the checklist's own schema doc comment names as its trigger, so
 * it sits behind the same permission as executing the checklist itself,
 * not the broader record-management permissions.
 */
@ApiTags('supporting-operations')
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @RequirePermissions('employee.create')
  @Post()
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.create(dto, user.id);
  }

  @RequirePermissions('employee.read')
  @Get()
  list() {
    return this.employees.list();
  }

  @RequirePermissions('employee.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.get(id, user.id);
  }

  /**
   * Its OWN permission, not the record-management one.
   *
   * Part 10.2 classifies a national ID Highly Confidential. The field is
   * encrypted at rest, every reveal needs a >=10-character justification, and
   * every reveal writes an audited READ flagged `isSensitiveDataAccess` — all of
   * which already worked. The gate was the part that did not distinguish
   * "correct this person's hire date" from "read their national identity
   * number", so the administrator and the Manager both had it by default and
   * neither does now.
   *
   * The route gate IS the field gate here, because `RevealEmployeeFieldDto`
   * accepts only `nationalId`. The customer counterpart is enforced per field
   * instead, because that endpoint also reveals a phone number.
   */
  @RequirePermissions('employee.national-id.reveal')
  @Post(':id/reveal-field')
  revealField(
    @Param('id') id: string,
    @Body() dto: RevealEmployeeFieldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.revealField(id, dto, user);
  }

  /** New in Phase 3: there was no way to correct an employee record at all, so
   *  the unified User/Employee screen had nothing to submit to. `employee.update`
   *  and this route arrive together. */
  @RequirePermissions('employee.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.update(id, dto, user.id);
  }

  @RequirePermissions('training.record')
  @Post(':id/trainings')
  recordTraining(
    @Param('id') id: string,
    @Body() dto: CreateTrainingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.recordTraining(id, dto, user.id);
  }

  @RequirePermissions('training.record')
  @Patch(':id/trainings/:trainingId/complete')
  completeTraining(
    @Param('id') id: string,
    @Param('trainingId') trainingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.completeTraining(id, trainingId, user.id);
  }

  @RequirePermissions('deprovisioning.execute')
  @Post(':id/terminate')
  terminate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.terminate(id, user.id);
  }

  @RequirePermissions('deprovisioning.execute')
  @Patch(':id/deprovisioning-checklist')
  updateChecklist(
    @Param('id') id: string,
    @Body() dto: UpdateDeprovisioningChecklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.updateChecklist(id, dto, user.id);
  }

  @RequirePermissions('deprovisioning.execute')
  @Post(':id/deprovisioning-checklist/complete')
  completeChecklist(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.completeChecklist(id, user.id);
  }
}
