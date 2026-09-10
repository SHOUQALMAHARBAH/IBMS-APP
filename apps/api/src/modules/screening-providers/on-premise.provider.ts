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
 * On-premise screening engine adapter (yente / OpenSanctions).
 *
 * The deployment shape the uploaded requirements describe: a local screening
 * API in the broker's own infrastructure, queried over HTTP, with the dataset
 * ingested on a schedule. Its appeal is that no customer data leaves the
 * broker's network — which matters here, because the subjects are Highly
 * Confidential and a commercial provider is a third-party data share with its
 * own PDPL basis to establish.
 *
 * The base URL is CONFIGURATION (`SCREENING_BASE_URL`), never a literal in
 * business logic — `http://screening-engine:8000` inside compose,
 * something else in a real deployment.
 *
 * ## Response shape
 *
 * Modelled on yente's `POST /match/{dataset}` contract: a `queries` object
 * keyed by an arbitrary query id, each with `schema` and `properties`, and a
 * response whose `responses[queryId].results[]` carry `id`, `caption`,
 * `score`, `schema`, `datasets`, `properties` and `match`. Parsing is
 * defensive: a shape change should degrade to SCREENING_FAILED, never to a
 * confident NO_MATCH.
 */
export class OnPremiseScreeningProvider extends BaseScreeningProvider {
  readonly kind: ScreeningProviderKind = 'on_premise';
  readonly name = 'On-premise screening engine';

  constructor(config: ScreeningProviderConfig) {
    super(config);
  }

  private get dataset(): string {
    // "default" is yente's own catch-all collection.
    return this.config.dataset ?? 'default';
  }

  screenIndividual(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'Person');
  }

  screenOrganization(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return this.screen(subject, correlationId, 'Organization');
  }

  private async screen(
    subject: ScreeningSubject,
    correlationId: string,
    schema: 'Person' | 'Organization',
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
        `${this.config.baseUrl!.replace(/\/$/, '')}/match/${encodeURIComponent(this.dataset)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queries: { q1: { schema, properties: this.properties(subject) } },
          }),
        },
        correlationId,
      );

      const body = (await response.json()) as YenteMatchResponse;
      const results = body?.responses?.q1?.results ?? [];
      this.recordSuccess();

      const candidates = results
        .map((r) => this.toCandidate(r))
        .filter((c): c is ProviderCandidate => c !== null);

      return {
        outcome: candidates.length > 0 ? 'POTENTIAL_MATCH' : 'NO_MATCH',
        candidates,
        provider: this.kind,
        providerName: this.name,
        datasetVersion: this.dataset,
        correlationId,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      this.recordFailure();
      // A transport failure is SCREENING_FAILED. Never NO_MATCH — the
      // difference is the whole reason this adapter has a base class.
      return this.failed(correlationId, (err as Error).message, startedAt);
    }
  }

  /**
   * The attributes sent to the engine.
   *
   * Multi-attribute by design: name alone manufactures false positives, and
   * date of birth plus nationality are what let a matcher discriminate between
   * two people who share a common name.
   *
   * National ID and passport are sent ONLY when the deployment has opted in
   * (`SCREENING_SEND_IDENTIFIERS`). Even to a local engine that is a
   * data-minimisation decision, not a matching optimisation.
   */
  private properties(subject: ScreeningSubject): Record<string, string[]> {
    const props: Record<string, string[]> = {
      name: [subject.fullName, ...(subject.aliases ?? [])].filter(Boolean),
    };
    if (subject.dateOfBirth) props.birthDate = [subject.dateOfBirth];
    if (subject.nationality) props.nationality = [subject.nationality];
    if (subject.country) props.country = [subject.country];
    if (this.config.sendIdentifiers) {
      if (subject.nationalId) props.idNumber = [subject.nationalId];
      if (subject.passportNumber)
        props.passportNumber = [subject.passportNumber];
    }
    return props;
  }

  private toCandidate(result: YenteResult): ProviderCandidate | null {
    if (!result?.id || !result?.caption) return null;
    const datasets = Array.isArray(result.datasets) ? result.datasets : [];

    return {
      providerEntityId: result.id,
      entityName: result.caption,
      entityType:
        result.schema === 'Company' || result.schema === 'Organization'
          ? 'organization'
          : result.schema === 'Person'
            ? 'individual'
            : 'unknown',
      listType: listTypeFor(result, datasets),
      // Provider-native score, clamped. A provider that stops returning one
      // must not silently become "0" (never matches) or "1" (always matches).
      score:
        typeof result.score === 'number' && Number.isFinite(result.score)
          ? Math.min(1, Math.max(0, result.score))
          : 0.5,
      matchedAttributes: matchedAttributesFrom(result),
      sourceList: datasets.join(', ') || 'on-premise dataset',
      remarks: null,
      pepPosition: pepPositionFrom(result),
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
      // yente exposes readiness plus dataset metadata on its root document.
      const response = await this.fetchWithRetry(
        `${this.config.baseUrl!.replace(/\/$/, '')}/readyz`,
        { method: 'GET' },
        `health-${Date.now()}`,
      );
      const text = await response.text();
      this.recordSuccess();
      return {
        ...common,
        status: 'HEALTHY',
        detail:
          `Screening engine reachable at ${this.config.baseUrl} (dataset "${this.dataset}"). ${text.slice(0, 80)}`.trim(),
        datasetVersion: this.dataset,
      };
    } catch (err) {
      this.recordFailure();
      return {
        ...common,
        status: 'UNAVAILABLE',
        detail: `Screening engine unreachable at ${this.config.baseUrl}: ${(err as Error).message}`,
      };
    }
  }
}

// --- response shapes (defensive: everything optional) ----------------------

interface YenteResult {
  id?: string;
  caption?: string;
  schema?: string;
  score?: number;
  datasets?: string[];
  match?: boolean;
  properties?: Record<string, unknown>;
}

interface YenteMatchResponse {
  responses?: Record<string, { results?: YenteResult[] }>;
}

/**
 * Which list a result came from.
 *
 * `properties.topics` is AUTHORITATIVE where present — OpenSanctions tags an
 * entity `sanction` or `role.pep` explicitly, and that is the provider's own
 * statement rather than our inference.
 *
 * The dataset-name check below it is a HEURISTIC and is written as one. It
 * exists because a real dataset name is often unambiguous to a human while
 * containing none of the obvious words: `us_ofac_sdn` and `eu_fsf` are both
 * sanctions lists and neither contains "sanction". Substring-matching for that
 * word alone silently reported OFAC hits as a generic WATCHLIST, which
 * understates a sanctions match — the direction that matters.
 *
 * An unrecognised dataset is WATCHLIST. Never PEP: calling somebody
 * politically exposed when the data does not say so is fabricating a
 * determination with real consequences for that person.
 */
const SANCTIONS_DATASET_MARKERS = [
  'sanction',
  'ofac',
  'sdn',
  'fsf', // EU Financial Sanctions Files
  'consolidated',
  'sectoral',
  'debarment',
];
const PEP_DATASET_MARKERS = ['pep', 'politician', 'peps'];

function listTypeFor(
  result: YenteResult,
  datasets: string[],
): ScreeningListType {
  const topics = Array.isArray(
    (result.properties as { topics?: unknown })?.topics,
  )
    ? (result.properties as { topics: unknown[] }).topics.filter(
        (t): t is string => typeof t === 'string',
      )
    : [];

  // Provider's own classification wins.
  const topicText = topics.join(' ').toLowerCase();
  if (topicText.includes('sanction')) return 'SANCTIONS';
  if (topicText.includes('pep') || topicText.includes('role.pep')) return 'PEP';

  const datasetText = datasets.join(' ').toLowerCase();
  if (SANCTIONS_DATASET_MARKERS.some((m) => datasetText.includes(m))) {
    return 'SANCTIONS';
  }
  if (PEP_DATASET_MARKERS.some((m) => datasetText.includes(m))) return 'PEP';
  return 'WATCHLIST';
}

function matchedAttributesFrom(result: YenteResult): MatchedAttribute[] {
  const props = result.properties ?? {};
  const matched: MatchedAttribute[] = ['name'];
  if (props.birthDate) matched.push('dateOfBirth');
  if (props.nationality) matched.push('nationality');
  if (props.idNumber) matched.push('nationalId');
  if (props.passportNumber) matched.push('passport');
  if (props.country) matched.push('country');
  return matched;
}

function pepPositionFrom(result: YenteResult): string | null {
  const props = result.properties ?? {};
  const position = props.position;
  if (Array.isArray(position) && typeof position[0] === 'string') {
    return position[0];
  }
  return null;
}
