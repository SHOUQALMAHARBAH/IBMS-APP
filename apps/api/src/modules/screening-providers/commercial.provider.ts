import { BaseScreeningProvider } from './base-screening-provider';
import type {
  MatchedAttribute,
  ProviderCandidate,
  ProviderHealth,
  ProviderScreeningResult,
  ScreeningListType,
  ScreeningProviderKind,
  ScreeningSubject,
} from './screening-provider.types';
import type { ScreeningProviderConfig } from './screening-provider.config';

/**
 * Commercial screening provider adapter (Dow Jones / Refinitiv /
 * ComplyAdvantage).
 *
 * ## Read this before assuming it works
 *
 * This adapter is **written against a documented-but-unverified request and
 * response shape**, because no commercial provider credentials exist for this
 * project. It has never made a real call. What it demonstrably provides is the
 * SEAM: connecting a real provider is an edit to this one file plus
 * configuration, not a change to `ScreeningService`, the case queue, the
 * scheduler, the audit trail or the UI.
 *
 * Every commercial provider differs in its exact field names, so the request
 * builder and response parser below are the two places a real integration will
 * need adjusting. They are deliberately small and isolated for that reason.
 *
 * ## What it will NOT do
 *
 * It will not fabricate a result. With no credentials configured the registry
 * never constructs this class at all — it returns `NotConfiguredProvider`
 * instead, so the system reports NOT_CONFIGURED rather than inventing a clear
 * screening.
 *
 * ## Credentials
 *
 * The API key comes from `SCREENING_API_KEY` in the environment, is sent only
 * as an `Authorization` header, and is never logged, never echoed by an API,
 * and never written to the database.
 */
export class CommercialScreeningProvider extends BaseScreeningProvider {
  readonly kind: ScreeningProviderKind = 'commercial';
  readonly name = 'Commercial screening provider';

  constructor(config: ScreeningProviderConfig) {
    super(config);
  }

  screenIndividual(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'individual');
  }

  screenOrganization(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'organization');
  }

  private async screen(
    subject: ScreeningSubject,
    correlationId: string,
    entityType: 'individual' | 'organization',
  ): Promise<ProviderScreeningResult> {
    const startedAt = Date.now();

    if (this.breakerIsOpen()) {
      return this.failed(
        correlationId,
        'circuit breaker open after repeated provider failures',
        startedAt,
      );
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.config.baseUrl!.replace(/\/$/, '')}/screening/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Header only. Never a query parameter — those land in access
            // logs, proxies and browser history.
            Authorization: `Bearer ${this.config.apiKey ?? ''}`,
            ...(this.config.tenantId
              ? { 'X-Tenant-Id': this.config.tenantId }
              : {}),
          },
          body: JSON.stringify(this.requestBody(subject, entityType)),
        },
        correlationId,
      );

      const body = (await response.json()) as CommercialSearchResponse;
      this.recordSuccess();

      const candidates = (body?.results ?? [])
        .map((r) => this.toCandidate(r, entityType))
        .filter((c): c is ProviderCandidate => c !== null);

      return {
        outcome: candidates.length > 0 ? 'POTENTIAL_MATCH' : 'NO_MATCH',
        candidates,
        provider: this.kind,
        providerName: this.name,
        datasetVersion: body?.datasetVersion ?? null,
        correlationId,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      this.recordFailure();
      // The message may embed a status code but never a header or body, so no
      // credential can reach a log through this path.
      return this.failed(correlationId, (err as Error).message, startedAt);
    }
  }

  /**
   * One of the two provider-specific spots. Sends the attributes that let a
   * matcher discriminate; withholds the identifiers unless the deployment has
   * explicitly opted in, because sending a national ID to a third party is a
   * data-sharing decision with a PDPL basis, not a tuning knob.
   */
  private requestBody(
    subject: ScreeningSubject,
    entityType: 'individual' | 'organization',
  ): Record<string, unknown> {
    return {
      entityType,
      name: subject.fullName,
      aliases: subject.aliases ?? [],
      dateOfBirth: subject.dateOfBirth ?? undefined,
      nationality: subject.nationality ?? undefined,
      country: subject.country ?? undefined,
      ...(this.config.sendIdentifiers
        ? {
            nationalId: subject.nationalId ?? undefined,
            passportNumber: subject.passportNumber ?? undefined,
          }
        : {}),
      // Ask for both categories explicitly. PEP is a first-class request here,
      // not something inferred from a sanctions response.
      categories: ['SANCTIONS', 'PEP', 'WATCHLIST'],
      ...(this.config.dataset ? { dataset: this.config.dataset } : {}),
    };
  }

  /** The other provider-specific spot. */
  private toCandidate(
    result: CommercialResult,
    entityType: 'individual' | 'organization',
  ): ProviderCandidate | null {
    if (!result?.id || !result?.name) return null;
    return {
      providerEntityId: result.id,
      entityName: result.name,
      entityType: result.entityType ?? entityType,
      listType: normaliseListType(result.category),
      score:
        typeof result.score === 'number' && Number.isFinite(result.score)
          ? // Providers differ on 0..1 vs 0..100; normalise rather than let a
            // 92 sail past a 0.9 threshold as if it were certainty.
            result.score > 1
            ? Math.min(1, result.score / 100)
            : Math.max(0, result.score)
          : 0.5,
      matchedAttributes: (result.matchedFields ?? ['name']).filter(
        (f): f is MatchedAttribute =>
          [
            'name',
            'alias',
            'dateOfBirth',
            'nationality',
            'nationalId',
            'passport',
            'country',
          ].includes(f),
      ),
      sourceList: result.sourceList ?? 'commercial provider',
      remarks: result.remarks ?? null,
      pepPosition: result.pepPosition ?? null,
    };
  }

  async getProviderHealth(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const common = {
      provider: this.kind,
      providerName: this.name,
      checkedAt,
    };

    if (this.breakerIsOpen()) {
      return {
        ...common,
        status: 'UNAVAILABLE',
        detail:
          'Circuit breaker is open after repeated failures. Screening reports SCREENING_FAILED, not NO_MATCH, while it recovers.',
      };
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.config.baseUrl!.replace(/\/$/, '')}/health`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.config.apiKey ?? ''}` },
        },
        `health-${Date.now()}`,
      );
      const body = (await response.json().catch(() => ({}))) as {
        datasetVersion?: string;
        updatedAt?: string;
      };
      this.recordSuccess();
      return {
        ...common,
        status: 'HEALTHY',
        // The base URL is deployment configuration, not a secret. The key is
        // never included.
        detail: `Provider reachable at ${this.config.baseUrl}.`,
        datasetVersion: body.datasetVersion ?? null,
        datasetUpdatedAt: body.updatedAt ?? null,
      };
    } catch (err) {
      this.recordFailure();
      return {
        ...common,
        status: 'UNAVAILABLE',
        detail: `Provider unreachable: ${(err as Error).message}`,
      };
    }
  }
}

interface CommercialResult {
  id?: string;
  name?: string;
  entityType?: 'individual' | 'organization';
  category?: string;
  score?: number;
  matchedFields?: string[];
  sourceList?: string;
  remarks?: string | null;
  pepPosition?: string | null;
}

interface CommercialSearchResponse {
  results?: CommercialResult[];
  datasetVersion?: string;
}

/** An unrecognised category becomes WATCHLIST, never PEP. Guessing that a
 * result is a PEP hit is fabricating a determination with real consequences
 * for the customer. */
function normaliseListType(category: string | undefined): ScreeningListType {
  const value = (category ?? '').toUpperCase();
  if (value.includes('SANCTION')) return 'SANCTIONS';
  if (value === 'PEP' || value.includes('POLITICALLY')) return 'PEP';
  return 'WATCHLIST';
}
