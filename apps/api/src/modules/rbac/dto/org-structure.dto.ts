import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Part II §4.2.2 — the two org-structure lookups an administrator has to be
 * able to fill before the provisioning form can be completed at all.
 *
 * Both models are bilingual everywhere else in this system (`nameAr` sits
 * beside `name` on `Branch` and `Department` alike), so both are accepted
 * here; Arabic is optional only because a brand-new office may not have
 * settled its Arabic wording yet, not because the UI treats it as secondary.
 */
export class CreateOrgUnitDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameAr?: string;
}

/**
 * Rename an existing department or branch.
 *
 * Both names optional and at least one required: renaming only the Arabic label is a real edit, and
 * a PATCH that demanded both would force a person to retype the half they were not changing.
 */
export class RenameOrgUnitDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameAr?: string;
}
