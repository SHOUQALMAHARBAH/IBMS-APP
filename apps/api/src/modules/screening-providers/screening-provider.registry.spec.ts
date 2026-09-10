import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreeningProviderRegistry } from './screening-provider.registry';
import { BuiltInWatchlistProvider } from './built-in-watchlist.provider';
import { NotConfiguredProvider } from './not-configured.provider';
import { OnPremiseScreeningProvider } from './on-premise.provider';
import { CommercialScreeningProvider } from './commercial.provider';
import {
  DEFAULT_MATCH_THRESHOLDS,
  describeConfig,
  readScreeningConfig,
} from './screening-provider.config';
import { isClear, isUnresolved } from './screening-provider.types';
import type { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';

function makeRegistry(): ScreeningProviderRegistry {
  const entries = {
    hasUsableEntries: vi.fn().mockResolvedValue(true),
    findMatchCandidates: vi
      .fn()
      .mockResolvedValue({ entries: [], truncated: false }),
    findLatestSyncRuns: vi.fn().mockResolvedValue([]),
  } as unknown as WatchlistEntryRepository;
  return new ScreeningProviderRegistry(new BuiltInWatchlistProvider(entries));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider selection is configuration, not a code branch', () => {
  it('defaults to the built-in cache — this deployment DOES have a working provider', () => {
    // Reporting NOT_CONFIGURED here would be as wrong as reporting NO_MATCH
    // from an empty one: the synced OFAC/UN cache is real and works.
    expect(makeRegistry().resolve()).toBeInstanceOf(BuiltInWatchlistProvider);
  });

  it('selects the on-premise engine when configured', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'on_premise');
    vi.stubEnv('SCREENING_BASE_URL', 'http://screening-engine:8000');
    expect(makeRegistry().resolve()).toBeInstanceOf(OnPremiseScreeningProvider);
  });

  it('selects the commercial provider when configured', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'commercial');
    vi.stubEnv('SCREENING_BASE_URL', 'https://provider.example');
    vi.stubEnv('SCREENING_API_KEY', 'not-a-real-key');
    expect(makeRegistry().resolve()).toBeInstanceOf(
      CommercialScreeningProvider,
    );
  });

  it('does NOT silently fall back to the built-in cache when an external provider is misconfigured', async () => {
    // The dangerous failure: an operator believes they are screening against a
    // commercial PEP database and is actually getting a sanctions-only local
    // list, with nothing in the system saying so.
    vi.stubEnv('SCREENING_PROVIDER', 'commercial');
    vi.stubEnv('SCREENING_BASE_URL', 'https://provider.example');
    // no API key

    const provider = makeRegistry().resolve();
    expect(provider).toBeInstanceOf(NotConfiguredProvider);
    expect(provider).not.toBeInstanceOf(BuiltInWatchlistProvider);

    const health = await provider.getProviderHealth();
    expect(health.status).toBe('NOT_CONFIGURED');
    expect(health.detail).toMatch(/SCREENING_API_KEY/);
    expect(health.detail).toMatch(/Compliance review is required/);
  });

  it('names exactly what is missing rather than saying "not configured"', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'on_premise');
    const described = describeConfig(readScreeningConfig());
    expect(described.missing).toEqual(['SCREENING_BASE_URL']);
  });

  it('treats an unrecognised provider name as the built-in rather than crashing', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'wishful-thinking');
    expect(makeRegistry().resolve()).toBeInstanceOf(BuiltInWatchlistProvider);
  });
});

describe('an unconfigured provider never pretends screening happened', () => {
  it('reports NOT_CONFIGURED, never NO_MATCH', async () => {
    const provider = new NotConfiguredProvider('commercial', [
      'SCREENING_API_KEY',
    ]);
    const result = await provider.screenIndividual(
      { subjectRef: 's1', fullName: 'Anyone At All', entityType: 'individual' },
      'corr-1',
    );
    expect(result.outcome).toBe('NOT_CONFIGURED');
    expect(isClear(result.outcome)).toBe(false);
    expect(isUnresolved(result.outcome)).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('says so for every subject in a batch, not just the first', async () => {
    const provider = new NotConfiguredProvider('commercial', []);
    const results = await provider.screenBatch(
      [
        { subjectRef: 'a', fullName: 'A', entityType: 'individual' },
        { subjectRef: 'b', fullName: 'B', entityType: 'organization' },
      ],
      'corr-2',
    );
    expect(results.map((r) => r.outcome)).toEqual([
      'NOT_CONFIGURED',
      'NOT_CONFIGURED',
    ]);
  });
});

describe('secrets are never exposed', () => {
  it('reports the API key as present without revealing any part of it', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'commercial');
    vi.stubEnv('SCREENING_BASE_URL', 'https://provider.example');
    vi.stubEnv('SCREENING_API_KEY', 'super-secret-key-abc123');

    const described = makeRegistry().describe();
    expect(described.apiKeyConfigured).toBe(true);
    // Not even a masked tail: a suffix still leaks entropy, and no operator
    // task needs it.
    const serialised = JSON.stringify(described);
    expect(serialised).not.toContain('super-secret-key-abc123');
    expect(serialised).not.toContain('abc123');
    expect(serialised).not.toContain('apiKey"');
  });

  it('reports an absent key as absent rather than omitting the field', () => {
    vi.stubEnv('SCREENING_PROVIDER', 'built_in');
    expect(makeRegistry().describe().apiKeyConfigured).toBe(false);
  });
});

describe('match thresholds are configurable, not a hard-coded rule', () => {
  it('uses the documented defaults when nothing is set', () => {
    expect(makeRegistry().thresholds()).toEqual(DEFAULT_MATCH_THRESHOLDS);
  });

  it('honours configured values', () => {
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_HIGH', '0.95');
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_REVIEW', '0.8');
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_LOW', '0.6');
    expect(makeRegistry().thresholds()).toEqual({
      high: 0.95,
      review: 0.8,
      low: 0.6,
    });
  });

  it('falls back to the defaults when the bands are mis-ordered', () => {
    // A typo must not turn banding into nonsense, and must not take screening
    // offline either.
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_HIGH', '0.4');
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_REVIEW', '0.9');
    expect(makeRegistry().thresholds()).toEqual(DEFAULT_MATCH_THRESHOLDS);
  });

  it('ignores an out-of-range value rather than clamping it silently', () => {
    vi.stubEnv('SCREENING_MATCH_THRESHOLD_HIGH', '85');
    // 85 is not a fraction; the reader rejects it and keeps the default.
    expect(readScreeningConfig().thresholds.high).toBe(
      DEFAULT_MATCH_THRESHOLDS.high,
    );
  });
});

describe('identifiers are not sent to a provider by default', () => {
  it('defaults sendIdentifiers to false', () => {
    // Sending a national ID to a third party is a data-sharing decision with a
    // PDPL basis, not a matching optimisation.
    expect(readScreeningConfig().sendIdentifiers).toBe(false);
  });

  it('is opt-in per deployment', () => {
    vi.stubEnv('SCREENING_SEND_IDENTIFIERS', 'true');
    expect(readScreeningConfig().sendIdentifiers).toBe(true);
  });
});

describe('numeric configuration', () => {
  it('honours SCREENING_MAX_RETRIES=0 — "do not retry" is a real instruction', () => {
    // A zero-is-invalid check silently turned this into the default of 2, so a
    // deployment asking for one attempt got three.
    vi.stubEnv('SCREENING_MAX_RETRIES', '0');
    expect(readScreeningConfig().maxRetries).toBe(0);
  });

  it('still rejects a nonsensical timeout of 0', () => {
    vi.stubEnv('SCREENING_TIMEOUT_MS', '0');
    expect(readScreeningConfig().timeoutMs).toBe(10_000);
  });

  it('ignores a non-numeric value rather than producing NaN', () => {
    vi.stubEnv('SCREENING_TIMEOUT_MS', 'soon');
    expect(readScreeningConfig().timeoutMs).toBe(10_000);
  });
});
