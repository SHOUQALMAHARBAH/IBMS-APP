import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MONEY_STRING } from '../../../common/dto.util';
import { ENDORSEMENT_CHANGE_TYPES } from '../endorsement.config';

const CHANGE_TYPES = [...ENDORSEMENT_CHANGE_TYPES];

/** The post-amendment coverage. Optional — when omitted the current coverage
 * is carried forward into the new `PolicySchedule` version, which just marks
 * the "as amended by endorsement X from date Y" boundary. */
export class EndorsementTargetCoverageDto {
  @IsDefined()
  @IsObject()
  limits!: Record<string, unknown>;

  @IsDefined()
  @IsObject()
  sumsInsured!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  namedPerils?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  extensions?: string[];
}

/** Process 22 — request a positive/negative mid-term endorsement on an ACTIVE
 * policy. The premium adjustment is the insurer-confirmed figure (unsigned);
 * its sign follows `type`. */
export class CreateEndorsementDto {
  @IsIn(['POSITIVE', 'NEGATIVE'], {
    message: 'type must be POSITIVE or NEGATIVE',
  })
  type!: 'POSITIVE' | 'NEGATIVE';

  @IsIn(CHANGE_TYPES, {
    message: `changeType must be one of: ${CHANGE_TYPES.join(', ')}`,
  })
  changeType!: (typeof CHANGE_TYPES)[number];

  /** The unsigned premium adjustment (fils precision). */
  @Matches(MONEY_STRING, {
    message: 'premiumAmount must be a decimal amount with at most 3 places',
  })
  premiumAmount!: string;

  /** When the amendment takes effect. */
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EndorsementTargetCoverageDto)
  targetCoverage?: EndorsementTargetCoverageDto;
}
