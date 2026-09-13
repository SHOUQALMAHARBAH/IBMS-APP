import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { OrganizationResolutionService } from './organization-resolution.service';
import { Public } from '../auth/decorators/public.decorator';

class ResolveOrgQueryDto {
  /** A DNS label: letters, digits and hyphens. Constrained here so a crafted
   * value never reaches the query as free text. */
  @IsString()
  @Length(1, 63)
  @Matches(/^[a-z0-9-]+$/i, {
    message: 'subdomain may contain only letters, digits and hyphens',
  })
  subdomain!: string;
}

/**
 * Part II §4.10 — the office a request belongs to, resolved from the subdomain
 * BEFORE any authentication step.
 *
 * Public by necessity: it runs before there is anyone to authenticate. It
 * returns only what a sign-in screen needs to render — the office's name in
 * both languages — and nothing about its users, its data or its size.
 *
 * There is deliberately no "list all offices" route. §4.10.4 is explicit that
 * an office administrator cannot see that another office even exists, and a
 * listing endpoint would hand that to anyone at all.
 */
@ApiTags('organization')
@Controller('orgs')
export class OrganizationController {
  constructor(private readonly resolution: OrganizationResolutionService) {}

  @Public()
  @Get('resolve')
  resolve(@Query() query: ResolveOrgQueryDto) {
    return this.resolution.resolve(query.subdomain);
  }
}
