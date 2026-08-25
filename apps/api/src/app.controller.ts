import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

// The `@Api*Response` schemas below are the contract `test/contract.contract-spec.ts`
// validates actual responses against — keep them in sync with what these handlers return.
const statusOkSchema = {
  type: 'object' as const,
  properties: { status: { type: 'string' as const, enum: ['ok'] } },
  required: ['status'],
};

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOkResponse({ description: 'API process is up.', schema: statusOkSchema })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/db')
  @ApiOkResponse({
    description: 'API can reach the database.',
    schema: statusOkSchema,
  })
  @ApiServiceUnavailableResponse({ description: 'Database is unreachable.' })
  async getHealthDb(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    }
  }
}
