import { format } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type LoggerService } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security-headers.middleware';

/**
 * Route the two things that would otherwise bypass pino — stray `console.*`
 * (almost always third-party libraries) and process-level crashes — through
 * the same pipeline as everything else, so the rolling files under
 * `<repo>/logs` really do capture everything this API process prints, not
 * just Nest `Logger` output and HTTP traces.
 *
 * This only touches the API process. The `npm run dev` / turbo / `nest start
 * --watch` compiler output comes from separate parent processes and is left
 * exactly as-is.
 */
function captureStrayProcessOutput(logger: LoggerService): void {
  const asText = (args: unknown[]): string =>
    args.length === 1 && args[0] instanceof Error
      ? (args[0].stack ?? args[0].message)
      : format(...args);

  console.log = (...a: unknown[]): void =>
    void logger.log(asText(a), 'console');
  console.info = (...a: unknown[]): void =>
    void logger.log(asText(a), 'console');
  console.warn = (...a: unknown[]): void =>
    void logger.warn(asText(a), 'console');
  console.error = (...a: unknown[]): void =>
    void logger.error(asText(a), 'console');
  console.debug = (...a: unknown[]): void =>
    void logger.debug?.(asText(a), 'console');

  process.on('unhandledRejection', (reason) => {
    logger.error(asText([reason]), 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error(asText([err]), 'uncaughtException');
    // Match Node's default — an uncaught exception leaves the process in an
    // undefined state — but give pino's transport worker a moment to flush
    // the line above before the process goes away.
    setTimeout(() => process.exit(1), 100).unref();
  });
}

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
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();
  captureStrayProcessOutput(logger);
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
