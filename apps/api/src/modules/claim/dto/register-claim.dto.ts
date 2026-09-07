import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Process 24 — the loss adjuster assigned when the claim is registered. */
export class RegisterClaimAdjusterDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(200)
  firm?: string;
}

/**
 * Process 24 — register a `NOTIFIED` claim with the insurer (recording the
 * insurer's claim reference) and assign the loss adjuster in one step. Drives
 * `Claim.status NOTIFIED → REGISTERED` through the workflow engine.
 */
export class RegisterClaimDto {
  /** The insurer's reference for the registered claim — the acknowledgement
   * artefact of the submission (required, non-empty). */
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(200)
  insurerClaimReference!: string;

  /** Optional broker-internal claim number (`Claim.claimNumber @unique`) —
   * set here if it was not assigned at notification. A value already in use
   * by another claim is a 409. */
  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(100)
  claimNumber?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RegisterClaimAdjusterDto)
  adjuster!: RegisterClaimAdjusterDto;
}
