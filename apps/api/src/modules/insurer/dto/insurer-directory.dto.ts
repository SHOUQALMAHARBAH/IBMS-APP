import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Searching the cross-office directory.
 *
 * Plain containment on the company name in either script. The fuzzy,
 * transliteration-aware match belongs with the registration matcher, which has to answer
 * a harder question ("is this the same company as one of these?") than a person typing a
 * few letters into a search box.
 *
 * No filter by line, by structure, or by anything else yet: the directory is a lead list
 * an office scans, and every additional filter is a place where a wrong default could
 * hide a company that does write the cover somebody needs.
 */
export class ListInsurerDirectoryQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
