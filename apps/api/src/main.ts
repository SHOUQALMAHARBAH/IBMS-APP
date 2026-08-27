import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers.middleware';

// Part 10.2 — mandatory TLS extends to the database connection, not just
// client-server traffic. Fails fast at boot rather than letting a
// misconfigured production DATABASE_URL silently talk to Postgres in
// plaintext. Same NODE_ENV=production gate as securityHeaders() below.
function assertDatabaseTls(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const url = process.env.DATABASE_URL ?? '';
  if (!/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(url)) {
    throw new Error(
      'DATABASE_URL must set sslmode=require (or verify-ca/verify-full) in ' +
        'production — Part 10.2 mandates TLS on all traffic, including the ' +
        'database connection.',
    );
  }
}

async function bootstrap() {
  assertDatabaseTls();
  // bufferLogs: hold startup logs until the pino logger is wired in below,
  // so nothing bypasses the redacted/structured pipeline.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.use(cookieParser());
  app.use(securityHeaders());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // credentials: true is required for the refresh-token cookie to round-trip
  // between web:3000 and api:4000 (cross-port, same-site — see cookies.util.ts).
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
