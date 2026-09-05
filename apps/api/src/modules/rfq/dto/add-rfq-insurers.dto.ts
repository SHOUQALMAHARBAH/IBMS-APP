import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** Process 11 — broaden an existing RFQ's insurer shortlist (e.g. after an
 * insurer declines and needs replacing). Ids already on the shortlist are
 * skipped (the `@@unique([rfqId, insurerId])` is the backstop); every id
 * must resolve to a real Insurer (422 otherwise). */
export class AddRfqInsurersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  insurerIds!: string[];
}
