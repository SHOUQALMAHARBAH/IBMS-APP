import { Logger } from '@nestjs/common';
import type {
  CapabilityState,
  ProviderHealth,
  ProviderScreeningResult,
  ScreeningProvider,
  ScreeningProviderKind,
  ScreeningSubject,
} from './screening-provider.types';
import type { ScreeningProviderConfig } from './screening-provider.config';

/**
 * Shared reliability behaviour for every HTTP-backed provider: timeout, retry
 * with backoff, a circuit breaker, and the rule that a failure is reported as
 * `SCREENING_FAILED` and never as `NO_MATCH`.
 *
 * It lives in a base class rather than each adapter because every one of these
 * is a place where an adapter written in a hurry silently returns "nothing
 * found" for a transport error — which reads to every downstream consumer as
 * "this customer is clear".
 */
export abstract class BaseScreeningProvider implements ScreeningProvider {
  abstract readonly kind: ScreeningProviderKind;
  abstract readonly name: string;

  protected readonly logger = new Logger(this.constructor.name);

  /** Consecutive failures before the breaker opens. */
  private static readonly BREAKER_THRESHOLD = 5;
  /** How long the breaker stays open before a single probe is allowed. */
  private static readonly BREAKER_COOLDOWN_MS = 60_000;

  private consecutiveFailures = 0;
  private breakerOpenedAt: number | null = null;

  constructor(protected readonly config: ScreeningProviderConfig) {}

  abstract screenIndividual(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult>;

  abstract screenOrganization(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult>;

  abstract getProviderHealth(): Promise<ProviderHealth>;

  /** Every adapter must declare what it can do — there is no sensible default,
   * and a wrong default here would be a claim about coverage. */
  abstract capabilities(operational?: boolean): CapabilityState[];

  /**
   * Default batch: sequential fan-out.
   *
   * Sequential rather than `Promise.all` on purpose — a provider is a rate-
   * limited external dependency, and firing a whole re-screening batch at it
   * concurrently is how a deployment gets itself throttled or blocked. A
   * provider with a native batch endpoint should override this.
   */
  async screenBatch(
    subjects: readonly ScreeningSubject[],
    correlationId: string,
  ): Promise<ProviderScreeningResult[]> {
    const results: ProviderScreeningResult[] = [];
    for (const subject of subjects) {
      results.push(
        subject.entityType === 'organization'
          ? await this.screenOrganization(subject, correlationId)
          : await this.screenIndividual(subject, correlationId),
      );
    }
    return results;
  }

  /** True while the breaker is open — the provider has failed repeatedly and
   * is given time to recover instead of being hammered. */
  protected breakerIsOpen(): boolean {
    if (this.breakerOpenedAt === null) return false;
    if (
      Date.now() - this.breakerOpenedAt >=
      BaseScreeningProvider.BREAKER_COOLDOWN_MS
    ) {
      // Half-open: allow one probe through. If it fails, `recordFailure`
      // re-opens the breaker.
      this.breakerOpenedAt = null;
      return false;
    }
    return true;
  }

  protected recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.breakerOpenedAt = null;
  }

  protected recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= BaseScreeningProvider.BREAKER_THRESHOLD) {
      this.breakerOpenedAt = Date.now();
      this.logger.error(
        `${this.name}: circuit breaker OPEN after ${this.consecutiveFailures} consecutive failures. Screening will report SCREENING_FAILED (never NO_MATCH) until it recovers.`,
      );
    }
  }

  /**
   * One HTTP call with a timeout and bounded retry.
   *
   * Retries only what is worth retrying: a timeout, a transport error, or a
   * 5xx/429. A 4xx is a request or credential problem that will fail
   * identically on every attempt, and retrying it just delays the report and
   * hammers the provider.
   *
   * Every attempt carries the correlation id, so one screening can be traced
   * across this app's logs and the provider's.
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    correlationId: string,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            ...(init.headers ?? {}),
            'X-Correlation-Id': correlationId,
          },
        });
        if (response.ok) return response;

        if (response.status < 500 && response.status !== 429) {
          // Not retryable — a bad request or a rejected credential.
          throw new Error(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError =
          (err as Error).name === 'AbortError'
            ? new Error(`timed out after ${this.config.timeoutMs}ms`)
            : (err as Error);
        // A non-retryable status was thrown above; stop immediately.
        if (/^HTTP [4]\d\d$/.test(lastError.message)) break;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.config.maxRetries) {
        // Exponential backoff with jitter — a fleet of workers retrying in
        // lockstep is a self-inflicted denial of service on the provider.
        const backoff = 2 ** attempt * 250 + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    throw lastError ?? new Error('screening request failed');
  }

  /** The failure shape, in one place so no adapter can accidentally report a
   * transport error as an empty result set. */
  protected failed(
    correlationId: string,
    reason: string,
    startedAt: number,
  ): ProviderScreeningResult {
    return {
      outcome: 'SCREENING_FAILED',
      candidates: [],
      provider: this.kind,
      providerName: this.name,
      correlationId,
      // Redacted by construction: adapters pass an error message, never a
      // request body or a header.
      failureReason: reason,
      durationMs: Date.now() - startedAt,
    };
  }
}
