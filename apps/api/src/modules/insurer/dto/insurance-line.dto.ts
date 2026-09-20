import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Adding to, and correcting, the insurance-line vocabulary.
 *
 * Both names are required on an addition, for the same reason they are on an
 * office-registered insurer: Arabic is this system's primary language, a line name
 * appears on documents a client reads, and a vocabulary entry that exists in one
 * script only renders untranslated mid-sentence on the other language's page.
 *
 * There is no `code` field and never will be. A code is a platform-wide identifier
 * and an office cannot mint one — two offices inventing `PET` for different things
 * would make every report that groups by code wrong.
 */
const NO_CONTROL_CHARACTERS = /^[^\p{C}]+$/u;

/** The general/life split — the one level of this classification that IS
 *  regulatory (the Central Bank of Jordan publishes it), which is why an addition
 *  must declare which half it belongs to rather than being left uncategorised. */
const CATEGORIES = ['GENERAL', 'LIFE'] as const;

export class AddInsuranceLineDto {
  @IsString()
  @Length(2, 120)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameEn must not contain control characters',
  })
  nameEn!: string;

  @IsString()
  @Length(2, 120)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameAr must not contain control characters',
  })
  nameAr!: string;

  @IsEnum(CATEGORIES)
  category!: 'GENERAL' | 'LIFE';
}

/** Correcting an office's own addition. Every field optional; an empty body is a
 *  no-op rather than a 400. A standard line cannot be reached by this route at all —
 *  its id is not an office addition, so it reads as absent. */
export class UpdateInsuranceLineDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameEn must not contain control characters',
  })
  nameEn?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameAr must not contain control characters',
  })
  nameAr?: string;

  @IsOptional()
  @IsEnum(CATEGORIES)
  category?: 'GENERAL' | 'LIFE';
}
