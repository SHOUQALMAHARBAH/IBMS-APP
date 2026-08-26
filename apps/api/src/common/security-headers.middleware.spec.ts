import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers.middleware';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

interface MockRes {
  res: Response;
  setHeaderMock: Mock;
  statusMock: Mock;
  jsonMock: Mock;
}

function mockRes(): MockRes {
  const setHeaderMock = vi.fn();
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const res = {
    setHeader: setHeaderMock,
    status: statusMock,
    json: jsonMock,
  } as unknown as Response;
  return { res, setHeaderMock, statusMock, jsonMock };
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('securityHeaders (Part 10.2 — mandatory TLS)', () => {
  it('no-ops outside production', () => {
    process.env.NODE_ENV = 'test';
    const req = { headers: {}, secure: false } as unknown as Request;
    const { res, setHeaderMock, statusMock } = mockRes();
    const next = vi.fn();

    securityHeaders()(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(setHeaderMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('sets HSTS and nosniff headers on an HTTPS request and calls next', () => {
      const req = {
        headers: { 'x-forwarded-proto': 'https' },
        secure: false,
      } as unknown as Request;
      const { res, setHeaderMock, statusMock } = mockRes();
      const next = vi.fn();

      securityHeaders()(req, res, next);

      expect(setHeaderMock).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.stringContaining('max-age='),
      );
      expect(setHeaderMock).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(next).toHaveBeenCalledOnce();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('accepts a request Express itself terminated as TLS (req.secure) with no proxy header', () => {
      const req = { headers: {}, secure: true } as unknown as Request;
      const { res, statusMock } = mockRes();
      const next = vi.fn();

      securityHeaders()(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects a plain-HTTP request with 403 instead of processing it', () => {
      const req = {
        headers: { 'x-forwarded-proto': 'http' },
        secure: false,
      } as unknown as Request;
      const { res, statusMock, jsonMock } = mockRes();
      const next = vi.fn();

      securityHeaders()(req, res, next);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403 }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when neither a proxy header nor req.secure indicates HTTPS', () => {
      const req = { headers: {}, secure: false } as unknown as Request;
      const { res, statusMock } = mockRes();
      const next = vi.fn();

      securityHeaders()(req, res, next);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('exempts /health and /health/db from the plain-HTTP rejection (still sets headers) — orchestrator probes hit the app directly, not through the TLS-terminating proxy', () => {
      for (const path of ['/health', '/health/db']) {
        const req = { headers: {}, secure: false, path } as unknown as Request;
        const { res, setHeaderMock, statusMock } = mockRes();
        const next = vi.fn();

        securityHeaders()(req, res, next);

        expect(setHeaderMock).toHaveBeenCalledWith(
          'Strict-Transport-Security',
          expect.stringContaining('max-age='),
        );
        expect(next).toHaveBeenCalledOnce();
        expect(statusMock).not.toHaveBeenCalled();
      }
    });
  });
});
