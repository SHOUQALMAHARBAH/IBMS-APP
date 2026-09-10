import type {
  ProviderHealth,
  ProviderScreeningResult,
  ScreeningProvider,
  ScreeningProviderKind,
  ScreeningSubject,
} from './screening-provider.types';

/**
 * The provider used when a deployment ASKED for an external screening provider
 * and did not supply what it needs.
 *
 * This exists as a real object rather than a null check because the
 * alternative — callers branching on "is a provider configured?" — is exactly
 * how a system ends up returning NO_MATCH for a screening that never happened.
 * Every path goes through a provider; this one is honest about being unable to
 * answer.
 *
 * It never fails and never throws. It reports `NOT_CONFIGURED`, which callers
 * must treat as "compliance review required before this workflow proceeds" —
 * never as clear.
 */
export class NotConfiguredProvider implements ScreeningProvider {
  readonly kind: ScreeningProviderKind;
  readonly name: string;

  constructor(
    kind: ScreeningProviderKind,
    /** Exactly which settings are missing, so the health view and the config
     * screen can say what to supply instead of "not configured". */
    private readonly missing: readonly string[],
  ) {
    this.kind = kind;
    this.name = `${kind} (not configured)`;
  }

  private result(correlationId: string): ProviderScreeningResult {
    return {
      outcome: 'NOT_CONFIGURED',
      candidates: [],
      provider: this.kind,
      providerName: this.name,
      correlationId,
      failureReason:
        this.missing.length > 0
          ? `Automated screening provider is not configured. Missing: ${this.missing.join(', ')}.`
          : 'Automated screening provider is not configured.',
      durationMs: 0,
    };
  }

  screenIndividual(
    _subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return Promise.resolve(this.result(correlationId));
  }

  screenOrganization(
    _subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult> {
    return Promise.resolve(this.result(correlationId));
  }

  screenBatch(
    subjects: readonly ScreeningSubject[],
    correlationId: string,
  ): Promise<ProviderScreeningResult[]> {
    return Promise.resolve(subjects.map(() => this.result(correlationId)));
  }

  getProviderHealth(): Promise<ProviderHealth> {
    return Promise.resolve({
      provider: this.kind,
      providerName: this.name,
      status: 'NOT_CONFIGURED',
      detail:
        this.missing.length > 0
          ? `Missing configuration: ${this.missing.join(', ')}. Compliance review is required before the applicable workflow can proceed.`
          : 'No automated screening provider is configured. Compliance review is required before the applicable workflow can proceed.',
      checkedAt: new Date().toISOString(),
    });
  }
}
