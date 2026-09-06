import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  KB_CATEGORIES,
  type KbCategory,
} from '../knowledge-base-article.config';

/** `GET /knowledge-base-articles?category=` — optional filter. */
export class ListKnowledgeBaseArticlesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(KB_CATEGORIES)
  category?: KbCategory;
}
