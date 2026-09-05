import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  ASSET_TYPES,
  MAX_FLEET_VEHICLE_COUNT,
  MAX_INDEMNITY_PERIOD_MONTHS,
  MIN_INDEMNITY_PERIOD_MONTHS,
  MONEY_STRING,
  type AssetType,
} from '../risk-profile.config';

/**
 * Keeps the two asset shapes from being mixed. A `vehicle` asset is sized by
 * `fleetVehicleCount` only — motor Sum Insured is set per-vehicle at
 * placement, not in the survey. Every other type needs at least a
 * `declaredValue` or an `annualGrossProfit` to contribute anything to the
 * Sum Insured, must not carry a `fleetVehicleCount`, and may only set
 * `indemnityPeriodMonths` alongside an `annualGrossProfit` (the indemnity
 * period is the Business Interruption window — meaningless without the BI
 * basis). `@IsOptional()` alone can't express any of this, so a value the
 * other shape should never send would otherwise sail through and be
 * persisted. Same pattern as CustomerTypeFieldCoherence.
 */
@ValidatorConstraint({ name: 'assetFieldCoherence' })
class AssetFieldCoherence implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAssetDto;
    const hasDeclared = dto.declaredValue != null;
    const hasProfit = dto.annualGrossProfit != null;
    const hasPeriod = dto.indemnityPeriodMonths != null;
    const hasFleet = dto.fleetVehicleCount != null;

    if (dto.assetType === 'vehicle') {
      return hasFleet && !hasDeclared && !hasProfit && !hasPeriod;
    }
    if (hasFleet) return false;
    if (hasPeriod && !hasProfit) return false;
    return hasDeclared || hasProfit;
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as CreateAssetDto;
    return dto.assetType === 'vehicle'
      ? 'a vehicle asset takes only fleetVehicleCount (plus an optional description)'
      : 'a non-vehicle asset needs declaredValue and/or annualGrossProfit, must not carry fleetVehicleCount, and may only set indemnityPeriodMonths together with annualGrossProfit';
  }
}

/**
 * Process 6 — one line of the detailed risk survey (Part 3.2:
 * building/equipment/stock/annual profit/fleet). Used for both `POST
 * /risk-profiles/:id/assets` and `PATCH /risk-profiles/:id/assets/:assetId`
 * — PATCH replaces the asset's survey fields wholesale (send the complete
 * body), which keeps the coherence rule above checkable without a
 * partial-update special case.
 */
export class CreateAssetDto {
  @IsIn(ASSET_TYPES as readonly string[])
  @Validate(AssetFieldCoherence)
  assetType!: AssetType;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 500)
  description?: string;

  /** Insured value basis for a property/asset line (Part 3.2). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message:
      'declaredValue must be a decimal string with at most 3 decimal places (fils precision), e.g. "125000.500"',
  })
  declaredValue?: string;

  /** Annual gross profit — the Business Interruption indemnity basis (Part 3.2). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message:
      'annualGrossProfit must be a decimal string with at most 3 decimal places (fils precision), e.g. "480000.000"',
  })
  annualGrossProfit?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_INDEMNITY_PERIOD_MONTHS)
  @Max(MAX_INDEMNITY_PERIOD_MONTHS)
  indemnityPeriodMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_FLEET_VEHICLE_COUNT)
  fleetVehicleCount?: number;
}
