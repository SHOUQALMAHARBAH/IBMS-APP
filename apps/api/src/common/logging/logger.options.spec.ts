import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  buildLoggerParams,
  resolveLogDir,
  REDACT_PATHS,
} from './logger.options';

/** Just the slice of the pino-http options this suite exercises. */
interface TestPinoHttp {
  enabled?: boolean;
  level: string;
  transport?: {
    targets: Array<{
      target: string;
      level?: string;
      options: { file?: string; frequency?: string };
    }>;
  };
  autoLogging: { ignore: (req: { url?: string }) => boolean };
  redact: { paths: string[]; censor: string };
  genReqId: (
    req: { headers: Record<string, unknown> },
    res: { setHeader: (name: string, value: string) => void },
  ) => string;
  customProps: (req: {
    user?: { id?: string; email?: string };
  }) => Record<string, unknown>;
  serializers: {
    req: (req: Record<string, unknown>) => Record<string, unknown>;
    res: (res: Record<string, unknown>) => Record<string, unknown>;
  };
}

const pinoHttp = (env: Record<string, string | undefined>): TestPinoHttp =>
  buildLoggerParams(env).pinoHttp as unknown as TestPinoHttp;

// A non-test env bag: buildLoggerParams() would otherwise short-circuit to
// the silent config, since the suite itself runs under vitest.
const PROD = { NODE_ENV: 'production', LOG_DIR: '/var/tmp/ibms-logs' };
const DEV = { LOG_DIR: '/var/tmp/ibms-logs' };

describe('logger.options', () => {
  it('is disabled + silent under vitest / NODE_ENV=test, with no transport', () => {
    for (const env of [
      { NODE_ENV: 'test' },
      { VITEST: 'true' },
      { VITEST_WORKER_ID: '3' },
    ]) {
      const cfg = pinoHttp(env);
      expect(cfg.enabled).toBe(false);
      expect(cfg.level).toBe('silent');
      expect(cfg.transport).toBeUndefined();
    }
  });

  it('level: info in prod, debug otherwise, LOG_LEVEL always wins', () => {
    expect(pinoHttp(PROD).level).toBe('info');
    expect(pinoHttp(DEV).level).toBe('debug');
    expect(pinoHttp({ ...DEV, LOG_LEVEL: 'warn' }).level).toBe('warn');
    expect(pinoHttp({ ...PROD, LOG_LEVEL: 'trace' }).level).toBe('trace');
  });

  it('redacts auth material and Highly-Confidential field names, and any body', () => {
    const { paths, censor } = pinoHttp(PROD).redact;
    expect(censor).toBe('[redacted]');
    expect(paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'res.body',
        '*.password',
        '*.nationalId',
        '*.nationalIdEnc',
        '*.accessToken',
        '*.refreshToken',
      ]),
    );
    // guard against the exported list drifting silently
    expect(REDACT_PATHS).toContain('req.body');
  });

  it('req serializer emits only id/method/url/addr/ua — never headers or body', () => {
    const out = pinoHttp(PROD).serializers.req({
      id: 'req-1',
      method: 'POST',
      url: '/customers',
      originalUrl: '/customers',
      headers: { authorization: 'Bearer secret', 'user-agent': 'UA/1' },
      socket: { remoteAddress: '10.0.0.5' },
      body: { nationalId: '9901012345' },
    });

    expect(out).toEqual({
      id: 'req-1',
      method: 'POST',
      url: '/customers',
      remoteAddress: '10.0.0.5',
      userAgent: 'UA/1',
    });
    expect(out).not.toHaveProperty('headers');
    expect(out).not.toHaveProperty('body');
  });

  it('res serializer emits only the status code', () => {
    expect(
      pinoHttp(PROD).serializers.res({ statusCode: 201, foo: 'bar' }),
    ).toEqual({ statusCode: 201 });
  });

  it('genReqId reuses an inbound x-request-id and echoes it back on the response', () => {
    const setHeader = vi.fn();
    const reused = pinoHttp(PROD).genReqId(
      { headers: { 'x-request-id': 'trace-abc' } },
      { setHeader },
    );
    expect(reused).toBe('trace-abc');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'trace-abc');

    const generated = pinoHttp(PROD).genReqId({ headers: {} }, { setHeader });
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
  });

  it('genReqId discards an unsafe inbound x-request-id (CRLF / control chars / over-long) and generates a fresh UUID', () => {
    const setHeader = vi.fn();
    for (const bad of [
      'a\r\nX-Injected: 1',
      'has spaces',
      'x'.repeat(200),
      'semi;colon',
      '',
    ]) {
      const id = pinoHttp(PROD).genReqId(
        { headers: { 'x-request-id': bad } },
        { setHeader },
      );
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
      // whatever reached setHeader is the safe generated id, never the input
      expect(setHeader).toHaveBeenLastCalledWith('x-request-id', id);
    }
  });

  it('customProps attaches the acting user id only (no email) when authenticated', () => {
    const cp = pinoHttp(PROD).customProps;
    expect(cp({ user: { id: 'user-9', email: 'a@b.co' } })).toEqual({
      userId: 'user-9',
    });
    expect(cp({})).toEqual({});
  });

  it('autoLogging ignores health/liveness probe paths', () => {
    const { ignore } = pinoHttp(PROD).autoLogging;
    expect(ignore({ url: '/health' })).toBe(true);
    expect(ignore({ url: '/health/db' })).toBe(true);
    expect(ignore({ url: '/customers?status=ACTIVE' })).toBe(false);
  });

  it('adds daily-rolling api + error-only file targets under LOG_DIR when file logging is on', () => {
    const targets = pinoHttp(PROD).transport?.targets ?? [];
    const rolls = targets.filter((t) => t.target === 'pino-roll');
    expect(rolls).toHaveLength(2);
    // pino-roll appends the date/count/extension at runtime; `file` is the
    // base. Compare through join() so the check is path-separator agnostic.
    expect(rolls.map((t) => String(t.options.file)).sort()).toEqual(
      [join(PROD.LOG_DIR, 'api'), join(PROD.LOG_DIR, 'api-error')].sort(),
    );
    expect(rolls.every((t) => t.options.frequency === 'daily')).toBe(true);
    expect(rolls.some((t) => t.level === 'error')).toBe(true);
    // prod also keeps JSON on stdout
    expect(targets.some((t) => t.target === 'pino/file')).toBe(true);
  });

  it('writes no files in dev unless LOG_TO_FILE=true — just the pretty console', () => {
    const devTargets = pinoHttp(DEV).transport?.targets ?? [];
    expect(devTargets.some((t) => t.target === 'pino-roll')).toBe(false);
    expect(devTargets.some((t) => t.target === 'pino-pretty')).toBe(true);

    const devWithFiles =
      pinoHttp({ ...DEV, LOG_TO_FILE: 'true' }).transport?.targets ?? [];
    expect(devWithFiles.filter((t) => t.target === 'pino-roll')).toHaveLength(
      2,
    );
    expect(devWithFiles.some((t) => t.target === 'pino-pretty')).toBe(true);
  });

  it('resolveLogDir honours LOG_DIR, else resolves to <repo>/logs', () => {
    expect(resolveLogDir({ LOG_DIR: '/custom/logs' })).toBe('/custom/logs');
    expect(resolveLogDir({})).toMatch(/[\\/]logs$/);
  });
});
