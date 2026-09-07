import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KnowledgeBaseArticleService } from './knowledge-base-article.service';
import { CreateKnowledgeBaseArticleDto } from './dto/create-knowledge-base-article.dto';
import { UpdateKnowledgeBaseArticleDto } from './dto/update-knowledge-base-article.dto';
import { ListKnowledgeBaseArticlesQueryDto } from './dto/list-knowledge-base-articles-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 74 (backlog Part C #74, Domain H — the last Domain H item).
 * `kb.publish` (already pre-seeded) gates the whole surface.
 */
@ApiTags('supporting-operations')
@Controller('knowledge-base-articles')
export class KnowledgeBaseArticleController {
  constructor(private readonly articles: KnowledgeBaseArticleService) {}

  @RequirePermissions('kb.publish')
  @Post()
  create(
    @Body() dto: CreateKnowledgeBaseArticleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articles.create(dto, user.id);
  }

  @RequirePermissions('kb.publish')
  @Get()
  list(@Query() query: ListKnowledgeBaseArticlesQueryDto) {
    return this.articles.list(query);
  }

  @RequirePermissions('kb.publish')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.articles.get(id);
  }

  @RequirePermissions('kb.publish')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseArticleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articles.update(id, dto, user.id);
  }
}
