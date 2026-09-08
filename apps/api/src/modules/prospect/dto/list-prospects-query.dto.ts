import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

export class ListProspectsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  salesOwnerUserId?: string;

  /** Part F item #6 — bilingual full-text search over companyName +
   * contactPerson. See ListCustomersQueryDto.search's own comment on why
   * `emptyStringToUndefined` is load-bearing here, not cosmetic. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;
}
