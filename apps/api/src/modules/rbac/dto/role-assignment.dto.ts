import { RoleName } from '@ibms/db';
import { IsEnum } from 'class-validator';

/** Backlog A.2 — grant a single role to an existing user. */
export class RoleAssignmentDto {
  @IsEnum(RoleName)
  role!: RoleName;
}
