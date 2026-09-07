import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

export class ListCustomersQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(CustomerStatus))
  status?: CustomerStatus;
}
