import { IsUUID } from 'class-validator';

/** M04 — `POST /dsr/:id/assign` (`dsr.handle`). Sets or reassigns the DPO
 * handler while the request is still being worked. */
export class AssignDsrDto {
  @IsUUID()
  dpoHandlerUserId!: string;
}
