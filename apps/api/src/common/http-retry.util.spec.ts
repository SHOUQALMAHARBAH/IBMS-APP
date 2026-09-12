import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTextWithRetry } from './http-retry.util';

const OPTIONS = { timeoutMs: 60, maxRetries: 2 };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchTextWithRetry', () => {
  it('returns the body on a first-attempt success', async () => {
    fetchMock.mockResolvedValue(new Response('name,programme\nX,Y'));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).resolves.toBe('name,programme\nX,Y');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 — the endpoint is asking us to wait, not refusing', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response('ok'));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).resolves.toBe('ok');
  });

  it('retries a transport error', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok'));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).resolves.toBe('ok');
  });

  it('does NOT retry a 404 — it will fail identically every time', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).rejects.toThrow('HTTP 404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget, reporting the last failure', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(3); // first + 2 retries
  });

  it('times out instead of hanging forever', async () => {
    // The gap this replaces: a bare fetch() with no timeout meant a stalled
    // connection to a public sanctions endpoint hung the nightly sync
    // indefinitely rather than failing it.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', {
        timeoutMs: 20,
        maxRetries: 0,
      }),
    ).rejects.toThrow('timed out after 20ms');
  });

  it('the timeout also covers the BODY read, not just the headers', async () => {
    // A multi-megabyte CSV can stall halfway through streaming. Clearing the
    // abort timer once headers arrive would leave that stall unbounded — the
    // exact hang this exists to prevent.
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      } as unknown as Response),
    );

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', {
        timeoutMs: 20,
        maxRetries: 0,
      }),
    ).rejects.toThrow('timed out after 20ms');
  });

  it('refuses a body far larger than any real sanctions list', async () => {
    // A redirect to an error page or a hijacked endpoint, not a list.
    fetchMock.mockResolvedValue(
      new Response('x', {
        headers: { 'content-length': String(100 * 1024 * 1024) },
      }),
    );

    await expect(
      fetchTextWithRetry('https://example.test/sdn.csv', OPTIONS),
    ).rejects.toThrow('byte ceiling');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('names the URL in every failure, so a two-source sync says which broke', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      fetchTextWithRetry('https://example.test/consolidated.xml', OPTIONS),
    ).rejects.toThrow('https://example.test/consolidated.xml');
  });
});
