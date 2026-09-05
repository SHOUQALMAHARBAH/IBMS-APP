import { IsUUID } from 'class-validator';

/** Process 41 — `POST /service-requests/:id/assign`. Sets / changes the
 * handler while the request is still `open` or `in_progress`. */
export class AssignServiceRequestDto {
  @IsUUID()
  assignedToUserId!: string;
}
