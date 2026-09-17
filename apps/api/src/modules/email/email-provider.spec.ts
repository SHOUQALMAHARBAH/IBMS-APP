import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Microsoft365EmailProvider } from './microsoft365.provider';
import { GoogleWorkspaceEmailProvider } from './google-workspace.provider';
import { NotConfiguredEmailProvider } from './not-configured.provider';
import type { EmailConfig, EmailOAuthAppConfig } from './email-provider.config';
import type { OutboundMessage } from './email-provider.types';

/**
 * What these tests can and cannot prove.
 *
 * They exercise the adapters against a stubbed `fetch`: token caching, retry
 * and backoff, the difference between a rejected credential and a transient
 * failure, the request shapes, and — the rule that matters — that a failure is
 * NEVER reported as `SENT`.
 *
 * They cannot prove Microsoft or Google accept these payloads, because no real
 * mailbox has been connected on this project. That remains the first task of
 * whoever connects one. See each adapter's own header.
 */

const CONFIG: EmailConfig = {
  microsoft365: null,
  googleWorkspace: null,
  appBaseUrl: 'https://ibms.example',
  timeoutMs: 50,
  maxRetries: 1,
};

const APP: EmailOAuthAppConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://ibms.example/oauth/callback',
};

const MESSAGE: OutboundMessage = {
  to: ['someone@example.test'],
  subject: 'إعادة تعيين كلمة المرور',
  bodyText: 'https://ibms.example/reset-password?token=abc',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Microsoft 365 adapter', () => {
  const provider = () =>
    new Microsoft365EmailProvider(
      CONFIG,
      APP,
      'refresh-token',
      'info@alsalam-insurance.jo',
      'tenant-id',
    );

  it('exchanges the refresh token, then sends from the office mailbox', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('SENT');
    expect(result.fromAddress).toBe('info@alsalam-insurance.jo');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toContain('login.microsoftonline.com/tenant-id');
    expect(tokenInit.body as string).toContain('grant_type=refresh_token');

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    // The mailbox is addressed explicitly rather than via /me, so the From
    // address is the one recorded on the integration row.
    expect(sendUrl).toContain('/users/info%40alsalam-insurance.jo/sendMail');
    const body = JSON.parse(sendInit.body as string) as {
      message: {
        subject: string;
        body: { contentType: string };
        toRecipients: { emailAddress: { address: string } }[];
      };
      saveToSentItems: boolean;
    };
    expect(body.message.subject).toBe('إعادة تعيين كلمة المرور');
    expect(body.message.body.contentType).toBe('Text');
    expect(body.message.toRecipients[0].emailAddress.address).toBe(
      'someone@example.test',
    );
    expect(body.saveToSentItems).toBe(true);
  });

  it('caches the access token across sends rather than re-exchanging', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));

    const p = provider();
    await p.send(MESSAGE, 'corr-1');
    await p.send(MESSAGE, 'corr-2');

    // token + send + send, not token + send + token + send.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('re-exchanges when the cached token is about to expire', async () => {
    fetchMock
      .mockResolvedValueOnce(
        // Already inside the refresh skew window.
        jsonResponse({ access_token: 'access-1', expires_in: 10 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-2', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const p = provider();
    await p.send(MESSAGE, 'corr-1');
    await p.send(MESSAGE, 'corr-2');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reports a rejected credential distinctly from a failed send', async () => {
    // 401 means reconnect the mailbox; a 500 means try again. Collapsing them
    // would tell an administrator to do the wrong thing.
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('CREDENTIAL_REJECTED');
  });

  it('does not retry a rejected credential', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await provider().send(MESSAGE, 'corr-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds on the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('SENT');
  });

  it('reports SEND_FAILED — never SENT — when the retries are exhausted', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValue(new Response(null, { status: 503 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('SEND_FAILED');
    expect(result.detail).toContain('503');
  });

  it('reports SEND_FAILED on a transport error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('SEND_FAILED');
  });

  it('treats a token response without an access token as a rejected credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token_type: 'Bearer' }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('CREDENTIAL_REJECTED');
  });

  it('carries the correlation id on every call', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await provider().send(MESSAGE, 'corr-xyz');

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>)['X-Correlation-Id']).toBe(
        'corr-xyz',
      );
    }
  });

  it('verify proves the credential without sending anything', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ mail: 'info@alsalam-insurance.jo' }),
      );

    const health = await provider().verify('corr-1');

    expect(health.operational).toBe(true);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('sendMail'))).toBe(false);
  });

  it('verify reports not operational rather than throwing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const health = await provider().verify('corr-1');

    expect(health.operational).toBe(false);
    expect(health.fromAddress).toBe('info@alsalam-insurance.jo');
  });
});

describe('Google Workspace adapter', () => {
  const provider = () =>
    new GoogleWorkspaceEmailProvider(
      CONFIG,
      APP,
      'refresh-token',
      'info@alsalam-insurance.jo',
    );

  it('sends a base64url MIME message and returns the provider message id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'gmail-123' }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('SENT');
    expect(result.providerMessageId).toBe('gmail-123');

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const { raw } = JSON.parse(init.body as string) as { raw: string };
    // base64url: Gmail rejects '+' and '/'.
    expect(raw).not.toMatch(/[+/=]/);

    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('From: info@alsalam-insurance.jo');
    expect(mime).toContain('To: someone@example.test');
    expect(mime).toContain('charset="UTF-8"');
  });

  it('encodes an Arabic subject so it survives transport', async () => {
    // The platform's primary language is Arabic; a raw 8-bit subject header is
    // mangled by some relays, so it is RFC 2047 base64-encoded.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'gmail-123' }));

    await provider().send(MESSAGE, 'corr-1');

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const { raw } = JSON.parse(init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString('utf8');

    const subjectLine = mime
      .split('\r\n')
      .find((l) => l.startsWith('Subject:'));
    expect(subjectLine).toMatch(/^Subject: =\?UTF-8\?B\?/);
    const encoded = /=\?UTF-8\?B\?(.+)\?=/.exec(subjectLine ?? '')?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      'إعادة تعيين كلمة المرور',
    );
  });

  it('keeps the Arabic body intact through base64 transfer encoding', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'gmail-123' }));

    await provider().send(
      { ...MESSAGE, bodyText: 'مرحباً، هذا رابط إعادة التعيين' },
      'corr-1',
    );

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const { raw } = JSON.parse(init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    const body = mime.split('\r\n\r\n')[1];
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe(
      'مرحباً، هذا رابط إعادة التعيين',
    );
  });

  it('reports a rejected credential distinctly', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).toBe('CREDENTIAL_REJECTED');
  });

  it('never reports SENT when the send failed', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
      )
      .mockResolvedValue(new Response(null, { status: 500 }));

    const result = await provider().send(MESSAGE, 'corr-1');

    expect(result.outcome).not.toBe('SENT');
  });
});

describe('the null provider', () => {
  it('reports NOT_CONFIGURED and sends nothing', async () => {
    const result = await new NotConfiguredEmailProvider().send();

    expect(result.outcome).toBe('NOT_CONFIGURED');
    expect(result.fromAddress).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never claims to be operational', async () => {
    // There is deliberately no fallback to a shared platform mailbox: sending
    // from an address the recipient does not recognise is the exact failure §6
    // exists to prevent.
    const health = await new NotConfiguredEmailProvider().verify();

    expect(health.operational).toBe(false);
    expect(health.fromAddress).toBeNull();
    expect(health.detail).toContain('has not connected a mailbox');
  });
});
