import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { securityHeaders } from '../../src/common/security-headers.middleware';

/**
 * Mirrors src/main.ts's bootstrap (cookie parsing + global ValidationPipe) —
 * e2e/contract tests build the Nest app directly from AppModule and never
 * run main.ts, so anything registered there has to be repeated here or the
 * test environment silently diverges from production behavior.
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  // No-ops here (NODE_ENV isn't 'production' under vitest) — registered
  // anyway so a test that sets NODE_ENV=production mid-run gets the real
  // behavior instead of a silent gap.
  app.use(securityHeaders());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
