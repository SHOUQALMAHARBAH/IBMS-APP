import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  KB_CATEGORIES,
  type KbCategory,
} from '../knowledge-base-article.config';

/** Process 74 — `POST /knowledge-base-articles` (`kb.publish`). Creation IS
 * publishing — `publishedAt` defaults at the DB level, never accepted here.
 * `titleAr`/`bodyEn`/`bodyAr` are all optional — an article may exist in
 * English only, Arabic only, or both. */
export class CreateKnowledgeBaseArticleDto {
  @IsString()
  @Length(1, 300)
  title!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 300)
  titleAr?: string;

  @IsIn(KB_CATEGORIES, {
    message: `category must be one of: ${KB_CATEGORIES.join(', ')}`,
  })
  category!: KbCategory;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  bodyEn?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  bodyAr?: string;
}
