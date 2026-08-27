import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './logger.options';

/**
 * Part 10.3 / 10.4 — structured application (operational) logging.
 *
 * Wraps nestjs-pino: a DI-injectable pino `Logger`, automatic HTTP
 * request/response logging (pino-http), JSON output, `LOG_LEVEL`, and
 * daily-rolling files under `<repo>/logs` in production. All configuration —
 * redaction rules, serializers, transports — lives in `./logger.options.ts`.
 *
 * This is NOT the audit trail. The immutable business `AuditLogEntry`
 * (apps/api/src/modules/audit) is the legal/compliance record and stays in
 * Postgres; this channel is for debugging and incident triage and is
 * explicitly scrubbed of request/response bodies and Highly-Confidential
 * field values (ibms-brain/meta/lex/sensitive-data-handling.md).
 */
@Module({
  imports: [LoggerModule.forRoot(buildLoggerParams())],
  exports: [LoggerModule],
})
export class LoggingModule {}
