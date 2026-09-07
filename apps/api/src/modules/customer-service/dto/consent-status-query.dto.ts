import { IsUUID } from 'class-validator';

/** Process 44 — `GET /communications/consent-status`. A single required
 * `customerId` (a malformed id is a 400 here, not a downstream 404). */
export class ConsentStatusQueryDto {
  @IsUUID()
  customerId!: string;
}
