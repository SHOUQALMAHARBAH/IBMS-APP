import { IsIn, IsString, Length } from 'class-validator';

/** Part 10.6 justified drill-down — SensitiveFieldRevealService.reveal()
 * enforces the minimum-length reason itself; the `@Length` here just fails
 * fast at the DTO boundary with a clearer 400 before that service is ever
 * called. */
export class RevealFieldDto {
  @IsIn(['nationalId', 'contactPhone', 'contactEmail'] as const)
  field!: 'nationalId' | 'contactPhone' | 'contactEmail';

  @IsString()
  @Length(10, 1000)
  reason!: string;
}
