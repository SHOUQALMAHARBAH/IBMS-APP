import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 65 — `POST /planning-export` body (`planning-export.generate`).
 * `periodLabel` scopes the `market` (insurer performance) section only —
 * `portfolio` is always the current-state book, no period concept. Omitted
 * resolves to the previous UTC calendar month, the #60/#61 default. */
export class GeneratePlanningExportDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;
}
