import { IsIn } from 'class-validator';
import {
  DISPOSAL_METHODS,
  type DisposalMethod,
} from '../disposal-batch.config';

/** M06 — `POST /disposal-batches/:id/execute` (`retention.dispose.approve`).
 * A staff attestation that the external destruction process named by
 * `method` actually happened — this endpoint never performs a live delete
 * itself (`disposal-batch.config.ts`'s header comment). */
export class RecordDisposalExecutionDto {
  @IsIn(DISPOSAL_METHODS, {
    message: `method must be one of: ${DISPOSAL_METHODS.join(', ')}`,
  })
  method!: DisposalMethod;
}
