import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import {
  CreateEmployeeDto,
  RevealEmployeeFieldDto,
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
 * not the broader `employee.manage`.
 */
@ApiTags('supporting-operations')
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @RequirePermissions('employee.manage')
  @Post()
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.create(dto, user.id);
  }

  @RequirePermissions('employee.manage')
  @Get()
  list() {
    return this.employees.list();
  }

  @RequirePermissions('employee.manage')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.get(id, user.id);
  }

  @RequirePermissions('employee.manage')
  @Post(':id/reveal-field')
  revealField(
    @Param('id') id: string,
    @Body() dto: RevealEmployeeFieldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.revealField(id, dto, user);
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
