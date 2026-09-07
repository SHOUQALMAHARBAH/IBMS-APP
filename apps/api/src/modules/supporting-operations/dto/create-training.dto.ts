import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 66 — `POST /employees/:id/trainings` (`training.record`).
 * `dueAt` is naturally a FUTURE date when assigning a training (unlike
 * every other date field in this DTO group), so it is NOT run through
 * `parseHistoricalInstant`; `completedAt` — recording a training already
 * done — is. Both parsed in the service; validated here only as non-empty
 * strings. Supplying neither is legal (an assignment with no due date yet,
 * to be completed later via the dedicated complete route). */
export class CreateTrainingDto {
  @IsString()
  @Length(1, 200)
  trainingName!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  dueAt?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  completedAt?: string;
}
