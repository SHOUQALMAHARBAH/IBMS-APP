import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TransportTargetOptions } from 'pino';
import type { Params } from 'nestjs-pino';

/**
 * Builds the nestjs-pino (pino + pino-http) configuration for the API's
 * OPERATIONAL log — request traces, debug output, error stacks. This is not
 * the business audit trail: the immutable `AuditLogEntry`
 * (apps/api/src/modules/audit) stays in Postgres and is the legal/compliance
 * record. The two are deliberately separate channels.
 *
 * Kept as a pure function of an env bag so every branch is unit-testable
 * (logger.options.spec.ts) without booting Nest.
 */

type Env = Record<string, string | undefined>;

/** Health/liveness probes are hit constantly — logging each one buries the
 * signal. They still surface on error (autoLogging only skips 2xx/3xx). */
const IGNORED_REQUEST_PATHS = new Set([
  '/health',
  '/health/db',
  '/favicon.ico',
]);

/** A client-supplied `x-request-id` is only echoed back if it is a short,
 * bounded ASCII token. Anything else (CR/LF, control chars, kilobytes of
 * text) is discarded in favour of a fresh UUID — otherwise `res.setHeader`
 * throws `ERR_INVALID_CHAR` inside pino-http's genReqId and the request
 * 500s, a trivially reachable denial vector. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Redaction paths. Two independent lines of defence, because
 * ibms-brain/meta/lex/sensitive-data-handling.md is "mandatory — no
 * exceptions" on exactly this channel ("A logging pipeline is exactly such
 * an unencrypted, wide-retention, wide-access channel"):
 *
 *   1. the `req`/`res` serializers below emit only method / url / status /
 *      id / remote address / user-agent — request and response BODIES are
 *      never serialized at all, which is the specific failure mode Part 10.6
 *      calls out;
 *   2. this list is still applied, to scrub auth material and known
 *      Highly-Confidential field names should an error object, a future
 *      serializer, or a hand-written `logger.info({ ... })` call ever carry
 *      one.
 *
 * `req.body` / `res.body` are listed too so that even if someone re-adds a
 * body to a serializer later, it lands as `[redacted]`, not plaintext.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
  'res.body',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.mfaChallengeToken',
  '*.secret',
  '*.secretEnc',
  '*.nationalId',
  '*.nationalIdEnc',
  '*.contactPhoneEnc',
  '*.contactEmailEnc',
];

function isTestEnv(env: Env): boolean {
  return (
    env.NODE_ENV === 'test' ||
    env.VITEST === 'true' ||
    env.VITEST_WORKER_ID !== undefined
  );
}

function isProd(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

function resolveLevel(env: Env): string {
  return env.LOG_LEVEL ?? (isProd(env) ? 'info' : 'debug');
}

/**
 * Whether to also write rolling files, not just the console.
 *
 * Always on in production. In dev it is now **on by default** — the point is
 * that `<repo>/logs` mirrors everything the running API prints to the
 * terminal (HTTP traces, Nest `Logger` output, error stacks, and the
 * `console.*` / crash output bridged in `main.ts`). Set `LOG_TO_FILE=false`
 * for the old console-only behaviour. The `npm run dev` / turbo / nest-CLI
 * build output belongs to a separate parent process and is never captured
 * here. Test env never reaches this — `buildLoggerParams` short-circuits.
 */
function fileLoggingEnabled(env: Env): boolean {
  return isProd(env) || env.LOG_TO_FILE !== 'false';
}

/**
 * Directory rolling log files are written to. `LOG_DIR` wins; otherwise walk
 * up from this file to the workspace-root `package.json` (the one that
 * declares `workspaces`) and use `<repo>/logs`, so files land in the same
 * place no matter which workspace directory the process was launched from
 * (Turborepo runs the api with cwd `apps/api`).
 */
export function resolveLogDir(env: Env = process.env): string {
  if (env.LOG_DIR) return env.LOG_DIR;
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = join(dir, 'package.json');
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          workspaces?: unknown;
        };
        if (pkg.workspaces) return join(dir, 'logs');
      }
    } catch {
      // unreadable/!JSON — keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), 'logs');
}

function buildTargets(env: Env, level: string): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];

  if (isProd(env)) {
    // Structured JSON on stdout for the container's log collector.
    targets.push({ target: 'pino/file', level, options: { destination: 1 } });
  } else {
    // Human-readable console for local dev.
    targets.push({
      target: 'pino-pretty',
      level,
      options: {
        singleLine: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    });
  }

  if (fileLoggingEnabled(env)) {
    const logDir = resolveLogDir(env);
    // e.g. logs/api.2026-08-27.1.log — new file per day, keep ~2 weeks.
    targets.push({
      target: 'pino-roll',
      level,
      options: {
        file: join(logDir, 'api'),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        mkdir: true,
        size: '50m',
        limit: { count: 14 },
      },
    });
    // Errors also fan out to their own longer-retained file.
    targets.push({
      target: 'pino-roll',
      level: 'error',
      options: {
        file: join(logDir, 'api-error'),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        mkdir: true,
        limit: { count: 30 },
      },
    });
  }

  return targets;
}

export function buildLoggerParams(env: Env = process.env): Params {
  if (isTestEnv(env)) {
    // vitest boots AppModule directly (apps/api/test/utils/test-app.ts): no
    // console noise, no transport worker threads, no files on disk.
    return { pinoHttp: { enabled: false, level: 'silent' } };
  }

  const level = resolveLevel(env);

  return {
    pinoHttp: {
      level,
      transport: { targets: buildTargets(env, level) },
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          IGNORED_REQUEST_PATHS.has((req.url ?? '').split('?')[0]),
      },
      redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers['x-request-id'];
        const trimmed = typeof incoming === 'string' ? incoming.trim() : '';
        const id = SAFE_REQUEST_ID.test(trimmed) ? trimmed : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      // Correlate every line of a request to the acting user — the id only,
      // never the email (sensitive-data-handling.md: "Log identifiers").
      customProps: (req: IncomingMessage) => {
        const userId = (req as IncomingMessage & { user?: { id?: string } })
          .user?.id;
        return userId ? { userId } : {};
      },
      serializers: {
        // Deliberately minimal: no `headers`, no `body`, ever.
        req(req: IncomingMessage & { id?: string; originalUrl?: string }) {
          return {
            id: req.id,
            method: req.method,
            url: req.originalUrl ?? req.url,
            remoteAddress: req.socket?.remoteAddress,
            userAgent: req.headers?.['user-agent'],
          };
        },
        res(res: ServerResponse) {
          return { statusCode: res.statusCode };
        },
      },
    },
  };
}
