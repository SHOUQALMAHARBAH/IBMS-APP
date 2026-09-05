import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

export class ListProspectsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  salesOwnerUserId?: string;
}
