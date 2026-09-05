import { IsUUID } from 'class-validator';

/** Process 42 — `POST /complaints/:id/assign`. Names / changes the responsible
 * employee; from `LOGGED` this also moves the complaint to `ASSIGNED`. */
export class AssignComplaintDto {
  @IsUUID()
  responsibleEmployeeUserId!: string;
}
