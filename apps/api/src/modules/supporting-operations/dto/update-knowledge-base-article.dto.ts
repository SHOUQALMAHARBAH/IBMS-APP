import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  KB_CATEGORIES,
  type KbCategory,
} from '../knowledge-base-article.config';

/** Process 74 — `PATCH /knowledge-base-articles/:id` (`kb.publish`). */
export class UpdateKnowledgeBaseArticleDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 300)
  title?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 300)
  titleAr?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(KB_CATEGORIES)
  category?: KbCategory;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  bodyEn?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  bodyAr?: string;
}
