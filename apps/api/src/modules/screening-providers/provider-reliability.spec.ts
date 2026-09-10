import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnPremiseScreeningProvider } from './on-premise.provider';
import { CommercialScreeningProvider } from './commercial.provider';
import { readScreeningConfig } from './screening-provider.config';
import { isClear } from './screening-provider.types';

const SUBJECT = {
  subjectRef: 's1',
  fullName: 'Ahmad Khalid Al Hashimi',
  entityType: 'individual' as const,
  dateOfBirth: '1980-01-01',
  nationality: 'JO',
  nationalId: '9801012345',
  passportNumber: 'P1234567',
};

function onPremise(over: Record<string, string> = {}) {
  vi.stubEnv('SCREENING_PROVIDER', 'on_premise');
  vi.stubEnv('SCREENING_BASE_URL', 'http://screening-engine:8000');
  vi.stubEnv('SCREENING_MAX_RETRIES', '1');
  vi.stubEnv('SCREENING_TIMEOUT_MS', '50');
  for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
  return new OnPremiseScreeningProvider(readScreeningConfig());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('a provider failure is SCREENING_FAILED, never NO_MATCH', () => {
  // The single most consequential rule in this module. An adapter that
  // returns an empty candidate list on a transport error reads to every
  // downstream consumer as "this customer is clear".

  it('reports a transport error as SCREENING_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-1');
    expect(result.outcome).toBe('SCREENING_FAILED');
    expect(isClear(result.outcome)).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.failureReason).toContain('ECONNREFUSED');
  });

  it('reports a timeout as SCREENING_FAILED, with the timeout named', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-2');
    expect(result.outcome).toBe('SCREENING_FAILED');
    expect(result.failureReason).toMatch(/timed out after 50ms/);
  });

  it('reports a 5xx as SCREENING_FAILED after exhausting retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-3');
    expect(result.outcome).toBe('SCREENING_FAILED');
    // 1 initial + 1 retry (SCREENING_MAX_RETRIES=1).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx — it will fail identically every time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-4');
    expect(result.outcome).toBe('SCREENING_FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('DOES retry a 429 — that one is worth waiting out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ responses: { q1: { results: [] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-5');
    expect(result.outcome).toBe('NO_MATCH');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens a circuit breaker after repeated failures instead of hammering the provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const provider = onPremise({ SCREENING_MAX_RETRIES: '0' });

    for (let i = 0; i < 5; i++) {
      await provider.screenIndividual(SUBJECT, `corr-breaker-${i}`);
    }
    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls.length;

    const result = await provider.screenIndividual(SUBJECT, 'corr-open');
    expect(result.outcome).toBe('SCREENING_FAILED');
    expect(result.failureReason).toMatch(/circuit breaker open/);
    // No further network call was made.
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsBefore);

    const health = await provider.getProviderHealth();
    expect(health.status).toBe('UNAVAILABLE');
  });

  it('carries the correlation id on every attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ responses: { q1: { results: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await onPremise().screenIndividual(SUBJECT, 'corr-trace-me');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Correlation-Id']).toBe(
      'corr-trace-me',
    );
  });
});

describe('multi-attribute screening, and what is withheld', () => {
  it('sends name, DOB, nationality and country', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ responses: { q1: { results: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await onPremise().screenIndividual({ ...SUBJECT, country: 'JO' }, 'corr-6');
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { queries: { q1: { properties: Record<string, string[]> } } };
    const props = body.queries.q1.properties;
    expect(props.name).toContain('Ahmad Khalid Al Hashimi');
    expect(props.birthDate).toEqual(['1980-01-01']);
    expect(props.nationality).toEqual(['JO']);
    expect(props.country).toEqual(['JO']);
  });

  it('WITHHOLDS national ID and passport unless the deployment opts in', async () => {
    // Sending a national ID to a third party is a data-sharing decision with a
    // PDPL basis behind it, not a matching optimisation — even to a local
    // engine.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ responses: { q1: { results: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await onPremise().screenIndividual(SUBJECT, 'corr-7');
    const raw = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(raw).not.toContain('9801012345');
    expect(raw).not.toContain('P1234567');
  });

  it('sends them once opted in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ responses: { q1: { results: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await onPremise({ SCREENING_SEND_IDENTIFIERS: 'true' }).screenIndividual(
      SUBJECT,
      'corr-8',
    );
    const raw = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(raw).toContain('9801012345');
  });
});

describe('provider responses are parsed defensively', () => {
  it('classifies a sanctions dataset as SANCTIONS and a PEP one as PEP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            responses: {
              q1: {
                results: [
                  {
                    id: 'ofac-1',
                    caption: 'AHMAD AL HASHIMI',
                    schema: 'Person',
                    score: 0.91,
                    datasets: ['us_ofac_sdn'],
                    properties: { topics: ['sanction'] },
                  },
                  {
                    id: 'pep-1',
                    caption: 'SOME MINISTER',
                    schema: 'Person',
                    score: 0.72,
                    datasets: ['wd_peps'],
                    // A real OpenSanctions PEP entity carries this topic. It
                    // is the AUTHORITATIVE signal — the provider stating what
                    // the entity is, rather than us inferring from a name.
                    properties: {
                      topics: ['role.pep'],
                      position: ['Minister of Something'],
                    },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-9');
    expect(result.outcome).toBe('POTENTIAL_MATCH');
    expect(result.candidates.map((c) => c.listType)).toEqual([
      'SANCTIONS',
      'PEP',
    ]);
    expect(result.candidates[1].pepPosition).toBe('Minister of Something');
  });

  it('does NOT guess PEP for an unrecognised dataset — it reports WATCHLIST', async () => {
    // Calling something a PEP hit when the data does not say so is fabricating
    // a determination with real consequences for the customer.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            responses: {
              q1: {
                results: [
                  {
                    id: 'x-1',
                    caption: 'SOMEBODY',
                    schema: 'Person',
                    score: 0.8,
                    datasets: ['some_internal_list'],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-10');
    expect(result.candidates[0].listType).toBe('WATCHLIST');
  });

  it('drops a malformed result rather than inventing fields for it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            responses: { q1: { results: [{ score: 0.9 }, null] } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-11');
    expect(result.candidates).toEqual([]);
    expect(result.outcome).toBe('NO_MATCH');
  });

  it('reports a shape change as SCREENING_FAILED, not as a confident NO_MATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>gateway</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    const result = await onPremise().screenIndividual(SUBJECT, 'corr-12');
    expect(result.outcome).toBe('SCREENING_FAILED');
  });
});

describe('commercial adapter — credential handling and score normalisation', () => {
  function commercial() {
    vi.stubEnv('SCREENING_PROVIDER', 'commercial');
    vi.stubEnv('SCREENING_BASE_URL', 'https://provider.example');
    vi.stubEnv('SCREENING_API_KEY', 'super-secret-key');
    vi.stubEnv('SCREENING_MAX_RETRIES', '0');
    return new CommercialScreeningProvider(readScreeningConfig());
  }

  it('sends the key as a header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await commercial().screenIndividual(SUBJECT, 'corr-13');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A key in a query string lands in access logs, proxies and history.
    expect(url).not.toContain('super-secret-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer super-secret-key',
    );
  });

  it('never puts the key in a failure reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const result = await commercial().screenIndividual(SUBJECT, 'corr-14');
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });

  it('normalises a 0-100 score so 92 does not sail past a 0.9 threshold', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { id: 'c1', name: 'A PERSON', category: 'SANCTIONS', score: 92 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const result = await commercial().screenIndividual(SUBJECT, 'corr-15');
    expect(result.candidates[0].score).toBeCloseTo(0.92, 5);
  });

  it('defaults a missing score to the middle rather than 0 or 1', async () => {
    // 0 would never match; 1 would always match. Both are confident claims the
    // provider did not make.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ id: 'c2', name: 'B PERSON', category: 'PEP' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const result = await commercial().screenIndividual(SUBJECT, 'corr-16');
    expect(result.candidates[0].score).toBe(0.5);
    expect(result.candidates[0].listType).toBe('PEP');
  });
});

describe('REGRESSION: SCREENING_MAX_RETRIES must mean what it says', () => {
  // `envInt` rejected 0, so an explicit "do not retry" silently became the
  // default of 2 — a deployment asking for one attempt got three. Verified
  // here by counting ACTUAL fetch calls, not by reading the parsed config.

  async function attemptsFor(retries: string | undefined): Promise<number> {
    vi.stubEnv('SCREENING_PROVIDER', 'on_premise');
    vi.stubEnv('SCREENING_BASE_URL', 'http://engine:8000');
    vi.stubEnv('SCREENING_TIMEOUT_MS', '50');
    if (retries !== undefined) vi.stubEnv('SCREENING_MAX_RETRIES', retries);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OnPremiseScreeningProvider(readScreeningConfig());
    const result = await provider.screenIndividual(SUBJECT, 'corr-retry');
    // Whatever the count, a failure is never a clear result.
    expect(result.outcome).toBe('SCREENING_FAILED');
    return fetchMock.mock.calls.length;
  }

  it('0 retries means exactly ONE attempt', async () => {
    expect(await attemptsFor('0')).toBe(1);
  });

  it('1 retry means two attempts', async () => {
    expect(await attemptsFor('1')).toBe(2);
  });

  it('2 retries means three attempts', async () => {
    expect(await attemptsFor('2')).toBe(3);
  });

  it('an unset value uses the documented default of 2 retries', async () => {
    expect(await attemptsFor(undefined)).toBe(3);
  });

  it('a NEGATIVE value falls back to the default rather than meaning "never try"', async () => {
    // -1 attempts is not a coherent instruction; the default is the safe read.
    expect(await attemptsFor('-1')).toBe(3);
  });

  it('a non-numeric value falls back to the default', async () => {
    expect(await attemptsFor('lots')).toBe(3);
  });

  it('an empty value falls back to the default', async () => {
    expect(await attemptsFor('')).toBe(3);
  });
});
